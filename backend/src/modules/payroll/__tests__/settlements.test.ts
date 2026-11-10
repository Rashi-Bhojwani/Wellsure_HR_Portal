import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// P7-6 (docs/plans/P7_6_SETTLEMENTS.md): a full and final settlement, prepared and confirmed; nothing is paid. Made-up figures only.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const paise = (s: string) => {
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};

describe("P7-6 — settlements", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let separationId = "";
  let ownSeparationId = "";
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/settlements${path}`).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.leaver = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    separationId = (await prisma.separation.create({ data: { employeeId: p.leaver.employeeId, lastWorkingDate: d("2031-05-31"), reason: "test", initiatedByUserId: p.hr.userId } })).id;
    ownSeparationId = (await prisma.separation.create({ data: { employeeId: p.d1.employeeId, lastWorkingDate: d("2031-05-31"), reason: "test", initiatedByUserId: p.hr.userId } })).id;
    await prisma.payrollAdjustment.create({ data: { employeeId: p.leaver.employeeId, componentCode: "TEST_ANY", direction: "EARNING", amount: "1234.56", reason: "made-up arrears", source: "MANUAL", sourceRef: `fnf-test-${p.leaver.employeeId}`, createdByUserId: p.d1.userId } });
    await prisma.payrollAdjustment.create({ data: { employeeId: p.leaver.employeeId, componentCode: "TEST_ANY_DED", direction: "DEDUCTION", amount: "34.56", reason: "made-up recovery", source: "MANUAL", sourceRef: `fnf-test-ded-${p.leaver.employeeId}`, createdByUserId: p.d1.userId } });
    const pl = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    for (const [date, days] of [["2031-01-01", "1"], ["2031-02-01", "1"], ["2031-06-01", "1"]] as const) {
      await prisma.leaveLedger.create({ data: { employeeId: p.leaver.employeeId, leaveTypeId: pl.id, leaveYear: 2031, entryDate: d(date), accrualMonth: d(date), entryType: "ACCRUAL", days, referenceType: "ACCRUAL_JOB" } });
    }
  }, 180_000);

  afterAll(async () => {
    await deleteWithDependents("PayrollApproval", (await prisma.payrollApproval.findMany({ where: { subject: "FNF_SETTLEMENT", makerUserId: { in: [p.d1!.userId, p.d2!.userId] } }, select: { id: true } })).map((a) => a.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("HR, the Developer role and an employee are refused; no sign-in is refused", async () => {
    for (const who of ["hr", "dev", "leaver"]) {
      expect((await call(who, "get", "")).status, who).toBe(403);
      expect((await call(who, "post", "", { separationId, directorLines: [] })).status, who).toBe(403);
    }
    expect((await request(app).get("/api/settlements")).status).toBe(401);
  });

  it("the automatic lines come from their sources; director lines need a source; the total is exact; nobody prepares their own", async () => {
    expect((await call("d1", "post", "", { separationId: ownSeparationId, directorLines: [] })).body.error.code).toBe("OWN_SETTLEMENT");
    expect((await call("d1", "post", "", { separationId, directorLines: [{ label: "Gratuity", amount: "100", source: "" }] })).status).toBe(400);
    const made = await call("d1", "post", "", { separationId, directorLines: [{ label: "Notice recovery", amount: "-200.10", source: "made-up: the separation's notice shortfall" }] });
    expect(made.status).toBe(201);
    const lines = made.body.lines as Array<{ kind: string; amount: string | null; days?: string }>;
    expect(lines.filter((l) => l.kind === "PENDING_ADJUSTMENT").map((l) => l.amount).sort()).toEqual(["-34.56", "1234.56"]);
    expect(lines.find((l) => l.kind === "LEAVE_BALANCE")).toMatchObject({ amount: null, days: "2" }); // only entries up to the last working day
    const independent = lines.filter((l) => l.amount !== null).reduce((s, l) => s + paise(l.amount!), 0n);
    expect(paise(made.body.total)).toBe(independent);
    expect(independent).toBe(paise("1234.56") - paise("34.56") - paise("200.10"));
    expect(made.body).toMatchObject({ state: "PREPARED", payable: true, recoverOutsidePayroll: null });
    await expect(prisma.fnfSettlement.update({ where: { id: made.body.id }, data: { total: "1" } })).rejects.toThrow(/FNF_SETTLEMENT_IMMUTABLE/);
  });

  it("a different director confirms; the preparer cannot; a confirmed settlement says nothing has been paid; a negative one is to recover outside payroll", async () => {
    const list = await call("d1", "get", "");
    const s = list.body.separations.find((x: { separationId: string }) => x.separationId === separationId).settlement;
    expect((await call("d1", "post", `/${s.id}/confirm`, { fingerprint: s.fingerprint })).status).toBe(200);
    expect((await call("d1", "post", `/${s.id}/decision`, { fingerprint: s.fingerprint, decision: "APPROVE" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await call("d2", "post", `/${s.id}/decision`, { fingerprint: s.fingerprint, decision: "APPROVE" })).status).toBe(200);
    const after = (await call("d2", "get", "")).body.separations.find((x: { separationId: string }) => x.separationId === separationId).settlement;
    expect(after.state).toBe("CONFIRMED");
    expect(after.payment).toMatch(/nothing has been paid/);
    const neg = await call("d2", "post", "", { separationId, directorLines: [{ label: "Recovery", amount: "-5000", source: "made-up recovery" }] });
    expect(neg.body).toMatchObject({ payable: false });
    expect(paise(neg.body.recoverOutsidePayroll)).toBe(paise("5000") - paise("1234.56") + paise("34.56"));
  });
});
