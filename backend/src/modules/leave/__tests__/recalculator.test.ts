import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { writeLedgerEntry } from "../ledger";
import * as recalculatorService from "../recalculator";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  cleanupMinimalTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  createMinimalTestEmployee,
  loginAs,
  utcDate,
  type TestOrgMasters,
} from "./leaveTestHelpers";

// Leave Recalculator (spec §5.4) — previewRecalculation/commitRecalculation
// take an explicit employeeIds array (unlike Year End's org-wide sweep),
// so these tests are naturally isolated to their own fixture employees.
describe("Leave Recalculator", () => {
  let plTypeId: string;
  let actorOrg: TestOrgMasters;
  let actorEmployeeId: string;
  let META: { actorUserId: string; ipAddress: null; userAgent: null };
  const employeeIds: string[] = [];

  beforeAll(async () => {
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;
    actorOrg = await createEmployeeTestOrgMasters();
    const actor = await createLoginableTestEmployee(actorOrg, { roleCode: "HR_ADMIN" });
    actorEmployeeId = actor.employeeId;
    META = { actorUserId: actor.userId, ipAddress: null, userAgent: null };
  });

  afterAll(async () => {
    await cleanupLoginableTestEmployee(actorEmployeeId);
    await cleanupEmployeeTestOrgMasters(actorOrg);
  });

  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("preview proposes CREDIT for a missing eligible month and REVERSE for a wrongly-credited one, in one dry run", async () => {
    // DOJ 1 June -> 90-day eligibility lands 30 Aug -> first credit 1 Sep.
    const doj = utcDate("2026-06-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);

    // A bad import-era ACCRUAL row dated BEFORE this employee even joined
    // — clearly wrong, simulating exactly the kind of mistake the
    // Recalculator exists to fix.
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: utcDate("2026-05-01"), accrualMonth: utcDate("2026-05-01"), entryType: "ACCRUAL", days: 1 });

    const results = await recalculatorService.previewRecalculation([employeeId], "2026-05-01", META);
    expect(results).toHaveLength(1);
    const actions = results[0]!.actions;

    const reverse = actions.find((a) => a.type === "REVERSE");
    expect(reverse).toBeDefined();
    expect(reverse!.accrualMonth).toBe("2026-05-01");
    expect(reverse!.days).toBe(1);

    const credit = actions.find((a) => a.type === "CREDIT");
    expect(credit).toBeDefined();
    expect(credit!.accrualMonth).toBe("2026-09-01");
    expect(credit!.days).toBe(1);
  });

  it("preview is a true dry run — no ledger rows written", async () => {
    const doj = utcDate("2026-06-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: utcDate("2026-05-01"), accrualMonth: utcDate("2026-05-01"), entryType: "ACCRUAL", days: 1 });

    await recalculatorService.previewRecalculation([employeeId], "2026-05-01", META);

    const rows = await prisma.leaveLedger.findMany({ where: { employeeId } });
    expect(rows).toHaveLength(1); // only the original fixture row — nothing added
  });

  it("commit requires the typed confirmation text", async () => {
    const doj = utcDate("2026-06-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);

    await expect(recalculatorService.commitRecalculation([employeeId], "2026-05-01", META, {})).rejects.toMatchObject({ status: 400, code: "CONFIRMATION_REQUIRED" });
  });

  it("commit applies CREDIT/REVERSE, and a second preview afterwards is empty — idempotent, not double-reversed", async () => {
    const doj = utcDate("2026-06-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: utcDate("2026-05-01"), accrualMonth: utcDate("2026-05-01"), entryType: "ACCRUAL", days: 1 });

    const committed = await recalculatorService.commitRecalculation([employeeId], "2026-05-01", META, { confirmText: "APPLY RECALCULATION" });
    expect(committed[0]!.actions.length).toBeGreaterThan(0);

    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plTypeId }, orderBy: { entryDate: "asc" } });
    // Original ACCRUAL (May) + REVERSAL (May, dated today per the same
    // "reversal happens when it happens" convention cancelLeaveRequest
    // uses, not backdated) + new ACCRUAL (Sep).
    const reversal = rows.find((r) => r.entryType === "REVERSAL");
    expect(reversal).toBeDefined();
    expect(reversal!.days.toNumber()).toBe(-1);
    expect(rows.filter((r) => r.entryType === "ACCRUAL")).toHaveLength(2);

    // Net effect: the wrongly-credited May day is reversed and a
    // legitimately-earned Sep day takes its place — same total, right reason.
    const totalBalance = rows.reduce((sum, r) => sum + r.days.toNumber(), 0);
    expect(totalBalance).toBe(1);

    // Re-running preview must find nothing left to fix — the whole point
    // of the recalculator.ts module comment's "commit re-diffs fresh"
    // design is that repeated runs converge, never double-apply.
    const second = await recalculatorService.previewRecalculation([employeeId], "2026-05-01", META);
    expect(second[0]!.actions).toHaveLength(0);

    // And committing again writes nothing further.
    const secondCommit = await recalculatorService.commitRecalculation([employeeId], "2026-05-01", META, { confirmText: "APPLY RECALCULATION" });
    expect(secondCommit[0]!.actions).toHaveLength(0);
    const rowsAfter = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plTypeId } });
    expect(rowsAfter).toHaveLength(3); // unchanged from before the second commit
  });

  it("404s for an employee that doesn't exist", async () => {
    await expect(recalculatorService.previewRecalculation(["not-a-real-id"], "2026-01-01", META)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  describe("route wiring (leave.recalculate)", () => {
    let org: TestOrgMasters;
    let managerToken: string;
    let plainToken: string;
    let targetEmployeeId: string;
    const routeTestEmployeeIds: string[] = [];

    beforeAll(async () => {
      org = await createEmployeeTestOrgMasters();
      const manager = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
      routeTestEmployeeIds.push(manager.employeeId);
      managerToken = await loginAs(manager.employeeCode);
      const plain = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
      routeTestEmployeeIds.push(plain.employeeId);
      plainToken = await loginAs(plain.employeeCode);
      const target = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
      routeTestEmployeeIds.push(target.employeeId);
      targetEmployeeId = target.employeeId;
    });

    afterAll(async () => {
      for (const id of [...routeTestEmployeeIds].reverse()) await cleanupLoginableTestEmployee(id);
      await cleanupEmployeeTestOrgMasters(org);
    });

    it("blocks a caller without leave.recalculate", async () => {
      const res = await request(app)
        .post("/api/leave/recalculate/preview")
        .set(...authHeader(plainToken))
        .send({ employeeIds: [targetEmployeeId], fromDate: "2026-01-01" });
      expect(res.status).toBe(403);
    });

    it("lets an HR_ADMIN preview", async () => {
      const res = await request(app)
        .post("/api/leave/recalculate/preview")
        .set(...authHeader(managerToken))
        .send({ employeeIds: [targetEmployeeId], fromDate: "2026-01-01" });
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });
});
