import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { monthsOf } from "../tax/form16";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// P7-7 (docs/plans/P7_7_FORM16.md): the challan register, quarterly data and Form 16 data (DRAFT until confirmed). Made-up figures and numbers only.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const CLOSED = "2025-26"; // ended before the suite's earliest possible "today"
const paise = (s: string) => {
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};

describe("P7-7 — months of a year", () => {
  it("April to March", () => {
    expect(monthsOf("2025-26")).toEqual(["2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03"]);
  });
});

describe("P7-7 — over the routes", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const challanIds: string[] = [];
  const partAIds: string[] = [];
  const t = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/tax${path}`).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 180_000);

  afterAll(async () => {
    await deleteWithDependents("TdsChallan", challanIds);
    await deleteWithDependents("Form16PartAFile", partAIds);
    await deleteWithDependents("PayrollApproval", (await prisma.payrollApproval.findMany({ where: { subject: "FORM16_CONFIRM", makerUserId: { in: [p.d1!.userId, p.d2!.userId] } }, select: { id: true } })).map((a) => a.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("HR, the Developer role and an employee are refused the directors' routes; the Developer is refused their own Form 16 route too", async () => {
    for (const who of ["hr", "dev", "emp"]) {
      expect((await t(who, "get", `/challans?fy=${CLOSED}`)).status, who).toBe(403);
      expect((await t(who, "get", `/form16?fy=${CLOSED}`)).status, who).toBe(403);
      expect((await t(who, "get", `/quarterly?fy=${CLOSED}&quarter=1`)).status, who).toBe(403);
    }
    expect((await t("dev", "get", `/me/form16?fy=${CLOSED}`)).status).toBe(403);
    expect((await request(app).get(`/api/tax/challans?fy=${CLOSED}`)).status).toBe(401);
  });

  it("a challan is sealed, shown by its last digits, and confirmed only by a different director retyping it exactly; the reconciliation counts confirmed deposits only", async () => {
    const a = await t("d1", "post", "/challans", { fy: "2019-20", month: "2019-07", depositedOn: "2019-08-07", amount: "1500.50", bsrCode: "0001234", serial: "98765" });
    const b = await t("d1", "post", "/challans", { fy: "2019-20", month: "2019-07", depositedOn: "2019-08-08", amount: "99.50", bsrCode: "0001234", serial: "11111" });
    challanIds.push(a.body.id, b.body.id);
    expect((await t("d1", "post", "/challans", { fy: "2019-20", month: "2020-07", depositedOn: "2019-08-07", amount: "1", bsrCode: "0001234", serial: "1" })).status).toBe(400); // not in the year
    const row = await prisma.tdsChallan.findUniqueOrThrow({ where: { id: a.body.id } });
    expect(JSON.stringify(row.serial)).not.toContain("98765");
    expect((await t("d1", "post", `/challans/${a.body.id}/confirm`, { amount: "1500.50", serial: "98765" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await t("d2", "post", `/challans/${a.body.id}/confirm`, { amount: "1500.50", serial: "98766" })).body.error.code).toBe("RETYPE_MISMATCH");
    expect((await t("d2", "post", `/challans/${a.body.id}/confirm`, { amount: "1500.5", serial: "98765" })).status).toBe(200);
    await expect(prisma.tdsChallanConfirmation.create({ data: { challanId: b.body.id, confirmedByUserId: p.d1!.userId } })).rejects.toThrow(/TDS_CHALLAN_SAME_PERSON/);
    const reg = await t("d1", "get", "/challans?fy=2019-20"); // a year no other test uses
    expect(reg.body.challans.find((c: { id: string }) => c.id === a.body.id)).toMatchObject({ serial: "…765", bsr: "…234", confirmed: true });
    const july = reg.body.reconciliation.find((r: { month: string }) => r.month === "2019-07");
    expect(paise(july.deposited)).toBe(paise("1500.50")); // the confirmed one counts, the unconfirmed one does not
    expect(paise(july.difference)).toBe(paise(july.deducted) - paise(july.deposited));
    await expect(prisma.tdsChallan.update({ where: { id: a.body.id }, data: { amount: "1" } })).rejects.toThrow(/TDS_CHALLAN_IMMUTABLE/);
  });

  it("Form 16 data exists only after the year ends; it stays DRAFT for the person until the year's data and the tax year are confirmed; a different director confirms", async () => {
    const thisYear = `${new Date().getUTCFullYear() + 1}-${String((new Date().getUTCFullYear() + 2) % 100).padStart(2, "0")}`;
    expect((await t("emp", "get", `/me/form16?fy=${thisYear}`)).body.error.code).toBe("YEAR_NOT_CLOSED");
    const mine = await t("emp", "get", `/me/form16?fy=${CLOSED}`);
    expect(mine.status).toBe(200);
    expect(mine.body).toMatchObject({ draft: true });
    expect(mine.body.partA).toMatch(/not made here/);
    const year = await t("d1", "get", `/form16?fy=${CLOSED}`);
    expect(year.body.state).not.toBe("CONFIRMED");
    expect((await t("d1", "post", `/form16/${CLOSED}/confirm`, { fingerprint: year.body.fingerprint })).status).toBe(200);
    expect((await t("d1", "post", `/form16/${CLOSED}/decision`, { fingerprint: year.body.fingerprint, decision: "APPROVE" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await t("d2", "post", `/form16/${CLOSED}/decision`, { fingerprint: year.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await t("d1", "get", `/form16?fy=${CLOSED}`)).body.state).toBe("CONFIRMED");
    // The tax year itself is not confirmed in this test: the person's Form 16 stays a draft.
    expect((await t("emp", "get", `/me/form16?fy=${CLOSED}`)).body.draft).toBe(true);
  });

  it("ST-25: a director uploads a person's Part A (a PDF, nothing read from it); only that person and directors download it; every step is audited", async () => {
    const pdf = Buffer.from("%PDF-1.4\n% made-up test file\n%%EOF\n");
    const up = (who: string, file: Buffer, name = "part-a.pdf") => request(app).post(`/api/tax/form16/${CLOSED}/people/${p.emp!.employeeId}/part-a`).set(...authHeader(tok[who]!)).attach("file", file, name);
    for (const who of ["hr", "dev", "emp"]) expect((await up(who, pdf)).status, who).toBe(403);
    expect((await up("d1", Buffer.from("not a pdf"), "x.pdf")).status).toBe(400);
    expect((await t("emp", "get", `/me/form16/part-a?fy=${CLOSED}`)).status).toBe(404); // nothing uploaded yet
    const ok = await up("d1", pdf);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    partAIds.push(ok.body.id);
    const mine = await request(app).get(`/api/tax/me/form16/part-a?fy=${CLOSED}`).set(...authHeader(tok.emp!)).buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on("data", (x: Buffer) => c.push(x)); res.on("end", () => cb(null, Buffer.concat(c))); });
    expect(mine.status).toBe(200);
    expect((mine.body as Buffer).equals(pdf)).toBe(true);
    // Another person has none of their own and cannot reach this one: there is no person id on the own route, and the directors' route refuses them.
    expect((await t("hr", "get", `/me/form16/part-a?fy=${CLOSED}`)).status).toBe(404);
    expect((await t("hr", "get", `/form16/${CLOSED}/people/${p.emp!.employeeId}/part-a`)).status).toBe(403);
    expect((await t("dev", "get", `/me/form16/part-a?fy=${CLOSED}`)).status).toBe(403);
    expect((await t("d2", "get", `/form16/${CLOSED}/part-a`)).body.files.map((f: { employeeId: string }) => f.employeeId)).toContain(p.emp!.employeeId);
    await expect(prisma.form16PartAFile.update({ where: { id: ok.body.id }, data: { fileName: "x" } })).rejects.toThrow(/FORM16_PART_A_APPEND_ONLY/);
    const audits = await prisma.auditLog.findMany({ where: { entityId: p.emp!.employeeId, action: { startsWith: "payroll.form16.part_a" } } });
    expect(audits.map((x) => x.action).sort()).toEqual(["payroll.form16.part_a_downloaded", "payroll.form16.part_a_uploaded"]);
  });

  it("quarterly data is in our own layout and says the official format is not built", async () => {
    const q = await t("d1", "get", `/quarterly?fy=${CLOSED}&quarter=2`);
    expect(q.body.months).toEqual(["2025-07", "2025-08", "2025-09"]);
    expect(q.body.note).toMatch(/not built/);
    expect(JSON.stringify(q.body)).not.toMatch(/98765/);
  });
});
