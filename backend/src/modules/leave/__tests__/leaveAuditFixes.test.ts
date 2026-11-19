import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { runMonthlyPlAccrual } from "../accrual";
import { creditCompOff } from "../compOff";
import { NotConfiguredEncashmentRateProvider, setEncashmentRateProvider } from "../encashmentRate";
import { writeLedgerEntry } from "../ledger";
import { commitYearEndRun, previewYearEnd, yearEndSplit } from "../yearEnd";

// Audit fix (2026-11-18, docs/plans/AUDIT_FIXES.md items 2 to 4). Made-up people and leave types with made-up names, so nothing depends on "PL" or "COF".
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const D = (n: number | string) => new Prisma.Decimal(n);

describe("year end: the split is what the policy says (pure)", () => {
  it("carries at most the cap; the rest is encashed when encashment is on, lapses when off; no limit carries everything", () => {
    const split = (b: number, rule: string | null, cap: number | null, enc: boolean | null) => {
      const r = yearEndSplit(D(b), { carryForwardRule: rule, carryForwardCapDays: cap === null ? null : D(cap), yearEndEncashment: enc });
      return [r.carried.toNumber(), r.encashed.toNumber(), r.lapsed.toNumber()];
    };
    expect(split(10, "CAPPED", 0, true)).toEqual([0, 10, 0]); // spec §5.2: encash all, reset
    expect(split(10, "CAPPED", 4, true)).toEqual([4, 6, 0]);
    expect(split(10, "CAPPED", 4, false)).toEqual([4, 0, 6]);
    expect(split(3, "CAPPED", 4, true)).toEqual([3, 0, 0]);
    expect(split(10, "UNLIMITED", null, true)).toEqual([10, 0, 0]);
    expect(split(0, "CAPPED", 0, true)).toEqual([0, 0, 0]);
  });
});

describe("leave type roles, year end and leave type limits over the database", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const u: Record<string, string> = {};
  const typeIds: string[] = [];
  const proposalIds: string[] = [];
  const yearEndRunIds: string[] = [];
  let seeded: Array<{ key: string; value: Prisma.JsonValue; reason: string; proposedByUserId: string; confirmedByUserId: string }> = [];
  let earnId = "";
  let compId = "";
  let wfhId = "";
  let rhId = "";
  const meta = () => ({ actorUserId: u.d1! });
  const call = (who: string, m: "get" | "post" | "put", path: string, body?: object) => request(app)[m](path).set(...authHeader(t[who]!)).send(body);
  const setRole = async (key: string, value: string) => {
    const p = await call("d1", "post", `/api/behaviours/${key}/proposals`, { value, reason: "TEST" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    proposalIds.push(p.body.id);
    expect((await call("d2", "post", `/api/behaviours/proposals/${p.body.id}/confirm`)).status).toBe(200);
  };

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-11-20"));
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["mgr", "MANAGER"], ["dev", DEVELOPER_ROLE_CODE], ["emp", undefined]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      u[k] = x.userId;
      t[k] = await loginAs(x.employeeCode);
    }
    const tag = Date.now().toString(36).toUpperCase().slice(-5);
    const type = async (code: string, name: string, policy: Record<string, unknown>) => {
      const lt = await prisma.leaveType.create({ data: { code: `${code}${tag}`, name: `${name} ${tag}`, isPaid: true, allowHalfDay: true, policy: { create: policy } } });
      typeIds.push(lt.id);
      return lt.id;
    };
    earnId = await type("EARN", "Annual leave", { accrualEnabled: true, accrualDaysPerMonth: 1, eligibilityMode: "DAYS", eligibilityValue: 0 });
    compId = await type("TOIL", "Time off in lieu", { compOffMinHoursWorked: 4, compOffExpiryDays: 30 });
    wfhId = await type("HOME", "Remote day", { wfhMonthlyLimit: 2, wfhYearlyLimit: 3, skipBalanceCheck: true });
    rhId = await type("OPTH", "Optional holiday", { rhYearlyQuota: 1, skipBalanceCheck: true });
    // The seeded roles (development data) are taken away for the Not set checks and put back afterwards.
    const rows = await prisma.behaviourProposal.findMany({ where: { key: { in: ["leave.earnedLeaveType", "leave.compOffType"] } }, include: { confirmation: true } });
    seeded = rows.filter((r) => r.confirmation).map((r) => ({ key: r.key, value: r.value, reason: r.reason, proposedByUserId: r.proposedByUserId, confirmedByUserId: r.confirmation!.confirmedByUserId }));
    await deleteWithDependents("BehaviourProposal", rows.map((r) => r.id));
  }, 120_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    setEncashmentRateProvider(new NotConfiguredEncashmentRateProvider());
    await deleteWithDependents("YearEndRun", yearEndRunIds);
    await deleteWithDependents("BehaviourProposal", proposalIds);
    for (const s of seeded) {
      const p = await prisma.behaviourProposal.create({ data: { key: s.key, value: s.value as Prisma.InputJsonValue, reason: s.reason, proposedByUserId: s.proposedByUserId } });
      await prisma.behaviourConfirmation.create({ data: { proposalId: p.id, confirmedByUserId: s.confirmedByUserId } });
    }
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: ids } } });
    for (const id of ids) await cleanupFullTestEmployee(id);
    await deleteWithDependents("LeaveType", typeIds);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("roles Not set: the monthly accrual, the year end and a comp-off grant are refused, naming the setting; nothing is skipped silently", async () => {
    await expect(runMonthlyPlAccrual(d("2026-11-01"))).rejects.toMatchObject({ status: 409, code: "SETTING_NOT_SET", message: "Earned / paid leave type is not set. Choose it in settings (Default behaviours)." });
    await expect(previewYearEnd(2026, meta())).rejects.toMatchObject({ code: "SETTING_NOT_SET", message: expect.stringContaining("Earned / paid leave type is not set") });
    await expect(creditCompOff({ employeeId: e.emp!, earnedDate: d("2026-11-15"), hoursWorked: 8, source: "MANUAL_GRANT" })).rejects.toMatchObject({ code: "SETTING_NOT_SET", message: "Comp-off leave type is not set. Choose it in settings (Default behaviours)." });
  });

  it("only directors set the roles (HR, a manager, an employee and the Developer get 403); an unknown type and the same type for both roles are refused", async () => {
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await call(who, "post", "/api/behaviours/leave.earnedLeaveType/proposals", { value: earnId, reason: "test" })).status, who).toBe(403);
      expect((await call(who, "post", "/api/behaviours/leave.compOffType/proposals", { value: compId, reason: "test" })).status, who).toBe(403);
    }
    expect((await call("d1", "post", "/api/behaviours/leave.earnedLeaveType/proposals", { value: "no-such-type", reason: "test" })).body.error.code).toBe("UNKNOWN_LEAVE_TYPE");
    await setRole("leave.earnedLeaveType", earnId);
    expect((await call("d1", "post", "/api/behaviours/leave.compOffType/proposals", { value: earnId, reason: "test" })).body.error.code).toBe("SAME_LEAVE_TYPE_ROLE");
    await setRole("leave.compOffType", compId);
  });

  it("with freely named types in the roles: the accrual credits the earned type, a comp-off grant credits the comp-off type", async () => {
    await prisma.employee.update({ where: { id: e.emp! }, data: { dateOfJoining: d("2025-01-01") } });
    await runMonthlyPlAccrual(d("2026-10-01"));
    expect((await prisma.leaveLedger.aggregate({ _sum: { days: true }, where: { employeeId: e.emp!, leaveTypeId: earnId } }))._sum.days?.toString()).toBe("1");
    await creditCompOff({ employeeId: e.emp!, earnedDate: d("2026-11-15"), hoursWorked: 8, source: "MANUAL_GRANT" });
    expect(await prisma.leaveLedger.count({ where: { employeeId: e.emp!, leaveTypeId: compId, entryType: "GRANT" } })).toBe(1);
    // Audit #7: a blank minimum hours or expiry is refused, naming it (never 4 hours / 60 days).
    await prisma.leavePolicy.update({ where: { leaveTypeId: compId }, data: { compOffMinHoursWorked: null, compOffExpiryDays: null } });
    await expect(creditCompOff({ employeeId: e.emp!, earnedDate: d("2026-11-16"), hoursWorked: 8, source: "MANUAL_GRANT" })).rejects.toMatchObject({ code: "SETTING_NOT_SET", message: expect.stringContaining("the minimum hours worked to earn it and the expiry in days are not set") });
    await prisma.leavePolicy.update({ where: { leaveTypeId: compId }, data: { compOffMinHoursWorked: 4, compOffExpiryDays: 30 } });
    // Audit #6: a blank days-per-month on the earned type is refused (never 1.0).
    await prisma.leavePolicy.update({ where: { leaveTypeId: earnId }, data: { accrualDaysPerMonth: null } });
    await expect(runMonthlyPlAccrual(d("2026-11-01"))).rejects.toMatchObject({ code: "SETTING_NOT_SET", message: expect.stringContaining("days earned per month is not set") });
    await prisma.leavePolicy.update({ where: { leaveTypeId: earnId }, data: { accrualDaysPerMonth: 1 } });
  });

  it("year end refuses while the earned type's carry-forward cap or year-end encashment is Not set, and never cashes out everything", async () => {
    await writeLedgerEntry(prisma, { employeeId: e.mgr!, leaveTypeId: earnId, leaveYear: 2026, entryDate: d("2026-06-01"), entryType: "ACCRUAL", days: 9 });
    const refused = previewYearEnd(2026, meta());
    await expect(refused).rejects.toMatchObject({ code: "SETTING_NOT_SET" });
    await expect(previewYearEnd(2026, meta())).rejects.toThrow(/carry-forward cap is not set.*year-end encashment is not set/);
    expect(await prisma.yearEndRun.count({ where: { leaveYear: 2026, status: "PREVIEW", previewedByUserId: u.d1! } })).toBe(0);
  });

  // The Developer no longer holds leave.policy.manage (final merge 2026-11-19); its 403 on every policy route is in developerLeavePolicy.test.ts.
  it("the leave policy screen's year-end fields: HR with leave.policy.manage sets them; an employee and a manager are refused; CAPPED needs the number", async () => {
    for (const who of ["emp", "mgr"]) expect((await call(who, "put", `/api/leave/types/${earnId}/policy`, { carryForwardRule: "UNLIMITED" })).status, who).toBe(403);
    expect((await call("hr", "put", `/api/leave/types/${earnId}/policy`, { carryForwardRule: "CAPPED" })).body.error.code).toBe("VALIDATION_ERROR");
    const ok = await call("hr", "put", `/api/leave/types/${earnId}/policy`, { carryForwardRule: "CAPPED", carryForwardCapDays: 4, yearEndEncashment: true });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({ carryForwardRule: "CAPPED", carryForwardCapDays: 4, yearEndEncashment: true });
  });

  it("set: at most the cap is carried, the rest encashed at the one leave-day value; with encashment off the rest lapses", async () => {
    setEncashmentRateProvider({ getDailyRate: async () => ({ amount: D(500), source: "TEST", isFinal: true }), amountFor: async (_e, _d, days) => ({ amount: days.times(500), source: "TEST", isFinal: true }) });
    const run = await previewYearEnd(2026, meta());
    yearEndRunIds.push(run.id);
    const item = run.items.find((i: { employeeId: string }) => i.employeeId === e.mgr)!;
    expect([item.closingPlBalance, item.carriedForwardDays, item.encashedDays, item.lapsedDays, item.encashedAmount]).toEqual([10, 4, 6, 0, 3000]); // 9 entered + 1 from the accrual above
    await commitYearEndRun(run.id, meta(), { confirmText: "COMMIT YEAR END" });
    const entries = await prisma.leaveLedger.findMany({ where: { employeeId: e.mgr!, leaveTypeId: earnId, referenceType: "YEAR_END_RUN" } });
    expect(entries.map((x) => [x.entryType, x.days.toString()])).toEqual([["ENCASHMENT", "-6"]]);
    expect((await prisma.leaveLedger.aggregate({ _sum: { days: true }, where: { employeeId: e.mgr!, leaveTypeId: earnId } }))._sum.days?.toString()).toBe("4"); // carried

    await call("hr", "put", `/api/leave/types/${earnId}/policy`, { carryForwardCapDays: 1, yearEndEncashment: false });
    await writeLedgerEntry(prisma, { employeeId: e.hr!, leaveTypeId: earnId, leaveYear: 2027, entryDate: d("2027-03-01"), entryType: "ACCRUAL", days: 3 });
    const next = await previewYearEnd(2027, meta());
    yearEndRunIds.push(next.id);
    const hrItem = next.items.find((i: { employeeId: string }) => i.employeeId === e.hr)!;
    expect([hrItem.carriedForwardDays, hrItem.encashedDays, hrItem.lapsedDays, hrItem.encashedAmount]).toEqual([1, 0, 3, 0]); // 1 carried from 2026 (the accrual) + 3 entered; cap 1
    await commitYearEndRun(next.id, meta(), { confirmText: "COMMIT YEAR END" });
    const lapse = await prisma.leaveLedger.findMany({ where: { employeeId: e.hr!, leaveTypeId: earnId, referenceType: "YEAR_END_RUN" } });
    expect(lapse.map((x) => [x.entryType, x.days.toString()])).toEqual([["LAPSE", "-3"]]);
  });

  it("year end with the leave-day value Not set is refused before anything is written", async () => {
    setEncashmentRateProvider(new NotConfiguredEncashmentRateProvider());
    await call("hr", "put", `/api/leave/types/${earnId}/policy`, { carryForwardCapDays: 0, yearEndEncashment: true });
    await writeLedgerEntry(prisma, { employeeId: e.emp!, leaveTypeId: earnId, leaveYear: 2028, entryDate: d("2028-02-01"), entryType: "ACCRUAL", days: 2 });
    await expect(previewYearEnd(2028, meta())).rejects.toMatchObject({ code: "SETTING_NOT_SET", message: expect.stringContaining("Leave encashment amount is not set") });
    expect(await prisma.yearEndRun.count({ where: { leaveYear: 2028 } })).toBe(0);
  });

  it("work from home limits and the restricted-holiday quota are enforced on apply; empty means no limit", async () => {
    const apply = (typeId: string, from: string, to: string) => call("emp", "post", "/api/leave/requests", { leaveTypeId: typeId, fromDate: from, toDate: to, fromDayPart: "FULL", toDayPart: "FULL", reason: "test" });
    expect((await apply(wfhId, "2026-12-01", "2026-12-02")).status).toBe(201); // 2 of 2 this month
    const month = await apply(wfhId, "2026-12-03", "2026-12-03");
    expect([month.status, month.body.error.code]).toEqual([409, "LEAVE_TYPE_LIMIT"]);
    expect(month.body.error.message).toMatch(/at most 2 days a month \(2026-12\)/);
    expect((await apply(wfhId, "2026-11-23", "2026-11-23")).status).toBe(201); // November: 1, the year now 3 of 3
    const year = await apply(wfhId, "2026-11-24", "2026-11-24");
    expect(year.body.error.message).toMatch(/at most 3 days a year \(2026\)/);
    expect((await apply(rhId, "2026-12-10", "2026-12-10")).status).toBe(201);
    expect((await apply(rhId, "2026-12-11", "2026-12-11")).body.error.code).toBe("LEAVE_TYPE_LIMIT");
    await call("hr", "put", `/api/leave/types/${rhId}/policy`, { rhYearlyQuota: null }); // empty: no limit
    expect((await apply(rhId, "2026-12-11", "2026-12-11")).status).toBe(201);
  });
});
