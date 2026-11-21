import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { BEHAVIOURS } from "../../behaviours/service";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// FIX-M8 (independent audit 2026-11-20, finding M8): "Lateness waivers (which cancel a pay cut) are decided by HR alone." A director setting "lateness waivers need
// a director's confirmation" (default ON): HR's approval is HR_APPROVED and a director confirms it. The end-to-end flow (and that nothing changes until the director
// confirms) is in lateness.test.ts and latenessQueue.test.ts; this file pins the default and the database rules.
describe("FIX-M8: a lateness waiver HR approves waits for a director", () => {
  let org: TestOrgMasters;
  let emp: { employeeId: string; userId: string }, hr: { userId: string }, mgr: { userId: string }, d: { userId: string };
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    emp = await createFullTestEmployee(org);
    hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    mgr = await createFullTestEmployee(org);
    d = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
  });
  afterAll(async () => {
    for (const p of [emp, hr, mgr, d] as Array<{ employeeId?: string }>) if (p.employeeId) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the setting exists and is on by default", () => {
    expect(BEHAVIOURS["lateness.waiverNeedsDirector"].defaultValue).toBe(true);
  });

  it("the database keeps HR_APPROVED open and refuses a confirmation by the HR approver; a different person confirms", async () => {
    const w = await prisma.lateWaiver.create({ data: { employeeId: emp.employeeId, date: new Date("2026-10-20T00:00:00Z"), reason: "test", requestedByUserId: mgr.userId } });
    await prisma.lateWaiver.update({ where: { id: w.id }, data: { status: "HR_APPROVED", hrApprovedByUserId: hr.userId, hrApprovedAt: new Date() } });
    await expect(prisma.lateWaiver.create({ data: { employeeId: emp.employeeId, date: new Date("2026-10-20T00:00:00Z"), reason: "again", requestedByUserId: mgr.userId } })).rejects.toThrow(); // still the one open request
    await expect(prisma.lateWaiver.update({ where: { id: w.id }, data: { status: "APPROVED", decidedByUserId: hr.userId, decidedAt: new Date() } })).rejects.toThrow(/confirmer_not_hr_approver/);
    await prisma.lateWaiver.update({ where: { id: w.id }, data: { status: "APPROVED", decidedByUserId: d.userId, decidedAt: new Date() } });
    await expect(prisma.lateWaiver.update({ where: { id: w.id }, data: { status: "REJECTED", decisionNote: "changed" } })).rejects.toThrow(/LATE_WAIVER_DECIDED/);
  });
});
