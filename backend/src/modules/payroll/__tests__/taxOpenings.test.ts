import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { canonicalDecimal } from "../money";
import { confirmedOpeningFor, openingsConfirmed } from "../tax/openings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-3 (docs/plans/A3_OPENING_FIGURES.md): opening figures. Made-up figures only. A year far ahead is used so no other test's year is touched.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const FY = "2039-40";

/** Independent model: paise as BigInt, from the decimal strings, summed. */
const paise = (s: string) => {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
};
const rupees = (p: bigint) => `${p / 100n}.${String(p % 100n).padStart(2, "0")}`;

describe("A-3 — opening figures", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);
  const view = async () => (await call("d1", "get", `/api/tax/openings?fy=${FY}`)).body;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.mgr = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.emp = await createFullTestEmployee(org);
    p.other = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
  }, 180_000);

  afterAll(async () => {
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("PayrollApproval", (await prisma.payrollApproval.findMany({ where: { subject: "TAX_OPENING", subjectId: FY }, select: { id: true } })).map((a) => a.id));
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("HR, a manager, an employee and the Developer role are refused every route; no sign-in is refused", async () => {
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await call(who, "get", `/api/tax/openings?fy=${FY}`)).status, who).toBe(403);
      expect((await call(who, "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "GO_LIVE", taxable: "1", tds: "0", sourceNote: "made up" })).status, who).toBe(403);
      expect((await call(who, "post", "/api/tax/openings/confirm", { year: FY, fingerprint: "x".repeat(64) })).status, who).toBe(403);
    }
    expect((await request(app).get(`/api/tax/openings?fy=${FY}`)).status).toBe(401);
  });

  it("nothing is preloaded; entering needs a source note and exact figures; the database refuses a change or a delete", async () => {
    expect((await view()).rows).toEqual([]);
    expect((await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "GO_LIVE", taxable: "100", tds: "0", sourceNote: "" })).status).toBe(400);
    expect((await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "GO_LIVE", taxable: "-5", tds: "0", sourceNote: "made-up figure" })).status).toBe(400);
    expect((await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "GO_LIVE", taxable: "1,000", tds: "0", sourceNote: "made-up figure" })).status).toBe(400);
    const ok = await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "GO_LIVE", taxable: "120000.50", tds: "4100.25", sourceNote: "made-up figure for a test" });
    expect(ok.status).toBe(200);
    await expect(prisma.taxOpening.updateMany({ where: { employeeId: p.emp!.employeeId }, data: { sourceNote: "rewritten" } })).rejects.toThrow(/TAX_OPENING_APPEND_ONLY/);
    await expect(prisma.taxOpening.deleteMany({ where: { employeeId: p.emp!.employeeId } })).rejects.toThrow(/TAX_OPENING_APPEND_ONLY/);
  });

  it("a different director must confirm; only confirmed figures count; any later entry voids the confirmation", async () => {
    await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "PREVIOUS_EMPLOYER", taxable: "30000", tds: "900.75", sourceNote: "made-up declaration" });
    expect(await openingsConfirmed(FY)).toBe(false);
    expect((await confirmedOpeningFor(p.emp!.employeeId, FY)).taxable.isZero()).toBe(true);
    const v = await view();
    expect((await call("d1", "post", "/api/tax/openings/confirm", { year: FY, fingerprint: v.fingerprint })).status).toBe(200);
    const self = await call("d1", "post", `/api/tax/openings/${FY}/decision`, { fingerprint: v.fingerprint, decision: "APPROVE" });
    expect(self.status).toBe(403);
    expect(self.body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.other!.employeeId, kind: "GO_LIVE", taxable: "1", tds: "0", sourceNote: "made up" })).body.error.code).toBe("WAITING_FOR_DECISION");
    expect((await call("d2", "post", `/api/tax/openings/${FY}/decision`, { fingerprint: v.fingerprint, decision: "APPROVE" })).status).toBe(200);
    expect(await openingsConfirmed(FY)).toBe(true);
    const mine = await confirmedOpeningFor(p.emp!.employeeId, FY);
    expect(rupees(paise(canonicalDecimal(mine.taxable)))).toBe(rupees(paise("120000.50") + paise("30000")));
    expect(rupees(paise(canonicalDecimal(mine.tds)))).toBe(rupees(paise("4100.25") + paise("900.75")));
    expect((await view()).state).toBe("CONFIRMED");
    // The confirmation is bound to the figures themselves: a row written behind the service's back (no void) is still not confirmed.
    const sneaked = await prisma.taxOpening.create({ data: { employeeId: p.other!.employeeId, financialYear: FY, kind: "GO_LIVE", taxable: "1", tds: "0", sourceNote: "written directly", enteredByUserId: p.d1!.userId } });
    expect(await openingsConfirmed(FY)).toBe(false);
    await deleteWithDependents("TaxOpening", [sneaked.id]);
    expect(await openingsConfirmed(FY)).toBe(true);
    // A clear after confirmation voids it.
    await call("d1", "post", "/api/tax/openings", { year: FY, employeeId: p.emp!.employeeId, kind: "PREVIOUS_EMPLOYER", clear: true, sourceNote: "entered in error" });
    expect(await openingsConfirmed(FY)).toBe(false);
    expect((await view()).rows).toHaveLength(1);
  });

  it("the import previews every row with its problem and applies exactly the previewed rows, from the same file", async () => {
    const csv = Buffer.from(
      ["Employee number,Kind,Taxable pay,Tax deducted,Source note", `${p.other!.employeeCode},GO_LIVE,5000.10,10.05,made-up file row`, "NOBODY,GO_LIVE,1,1,made up", `${p.other!.employeeCode},SOMETHING,1,1,made up`, `${p.other!.employeeCode},GO_LIVE,1,1,made up twice`].join("\n"),
    );
    const prev = await request(app).post("/api/tax/openings/import/preview").set(...authHeader(tok.d1!)).field("fy", FY).attach("file", csv, "openings.csv");
    expect(prev.status).toBe(200);
    expect(prev.body.valid).toBe(1);
    expect(prev.body.rows.map((r: { problem: string | null }) => r.problem === null)).toEqual([true, false, false, false]);
    const other = Buffer.from(`Employee number,Kind,Taxable pay,Tax deducted,Source note\n${p.other!.employeeCode},GO_LIVE,9,9,made up\n`);
    const wrong = await request(app).post("/api/tax/openings/import/apply").set(...authHeader(tok.d1!)).field("fy", FY).field("fingerprint", prev.body.fingerprint).field("reason", "test import").attach("file", other, "openings.csv");
    expect(wrong.body.error.code).toBe("PREVIEW_STALE");
    const ok = await request(app).post("/api/tax/openings/import/apply").set(...authHeader(tok.d1!)).field("fy", FY).field("fingerprint", prev.body.fingerprint).field("reason", "test import").attach("file", csv, "openings.csv");
    expect(ok.body.written).toBe(1);
    const row = (await view()).rows.find((r: { employeeId: string }) => r.employeeId === p.other!.employeeId);
    expect([paise(row.taxable), paise(row.tds)]).toEqual([paise("5000.10"), paise("10.05")]);
  });

  it("the sums agree with an independent paise model over random figures", async () => {
    let seed = 11;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    for (let i = 0; i < 300; i += 1) {
      const a = `${rnd(10_000_000)}.${String(rnd(100)).padStart(2, "0")}`;
      const b = `${rnd(10_000_000)}.${String(rnd(100)).padStart(2, "0")}`;
      const { dec } = await import("../money");
      expect(canonicalDecimal(dec(a).plus(dec(b)))).toBe(canonicalDecimal(dec(rupees(paise(a) + paise(b)))));
    }
  });
});
