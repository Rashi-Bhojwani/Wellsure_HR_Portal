import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildRoster, planMonth, type MonthPlan } from "@shared/attendance/simulator";
import { PEEPS_LEAVE_TYPE_CODES } from "@shared/constants/peepsLeave";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { recomputeWorld, diffWorld, formatMismatches, runReplay } from "../../attendance/__tests__/simulator/replay";
import { createWorld, existingHolidays, manualEntriesOf, type SimWorld } from "../../attendance/__tests__/simulator/world";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { writeLedgerEntry } from "../../leave/ledger";
import { CYCLE, buildRunWorld, calculateAgain, calculateRun, lockCycle, teardownRunWorld, type RunWorld } from "../../payroll/__tests__/runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "../../payroll/__tests__/salaryTestHelpers";
import { clearPeepsSettings, setSetting } from "./peepsTestKit";

// Peeps Stage 4, phase 4: attendance, leave and payroll come out exactly the same with the Peeps features unset, on and off. Attendance, leave
// and payroll only reach Peeps through the leaveRules hooks (the four new leave types' rules, and the two settings that name them on calendars) and
// the attendance display; so the states are: UNSET (no Peeps settings, the four types Not set), ON (both naming settings on, every new type's
// rules approved and in force) and OFF (both settings explicitly off, the rules approved but not in force until a date far ahead). In each state
// the same three pieces of work run: Session A's golden month replay (40 employees, August 2026, every scenario, compared field by field with what
// each scenario says, via the simulator's own replay and diff), a PL and LOP leave through the API, and a payroll calculation of the same run.

type State = "UNSET" | "ON" | "OFF";
/** A stored row without its own id, links to rows remade by each calculation, and timestamps: what is left is the result. */
const VOLATILE = /^(id|runItemId|calcVersion|createdAt|updatedAt|computedAt|calculatedAt|recomputedAt|lockedAt)$/;
const stable = (row: object) => JSON.stringify(Object.entries(row).filter(([k]) => !VOLATILE.test(k)).sort(([x], [y]) => x.localeCompare(y)));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const RULES = {
  MEDICAL: { paid: true, entitlement: { kind: "CAP", period: "PER_CALENDAR_YEAR", days: "5" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT"], gender: { kind: "ANY" } }, units: "FULL_DAY", counting: "CALENDAR_DAYS", document: { required: true, whenMoreThanDays: 1 }, approvalRoute: "HR_ONLY", yearEnd: null },
  BEREAVEMENT: { paid: true, entitlement: { kind: "CAP", period: "PER_REQUEST", days: "3" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT", "CONTRACT"], gender: { kind: "ANY" } }, units: "HALF_DAY", counting: "WORKING_DAYS", document: { required: false, whenMoreThanDays: 0 }, approvalRoute: "MANAGER_OR_HR", yearEnd: null },
  WEDDING: { paid: false, entitlement: { kind: "GRANTED_BALANCE" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT"], gender: { kind: "ANY" } }, units: "FULL_DAY", counting: "WORKING_DAYS", document: { required: false, whenMoreThanDays: 0 }, approvalRoute: "MANAGER_OR_HR", yearEnd: { carryForward: "LAPSE", encashment: "NONE" } },
  MENSTRUAL: { paid: true, entitlement: { kind: "CAP", period: "PER_CALENDAR_YEAR", days: "12" }, eligibility: { minServiceDays: 0, employmentTypes: ["PERMANENT"], gender: { kind: "ONLY", values: ["FEMALE"] } }, units: "FULL_DAY", counting: "WORKING_DAYS", document: { required: false, whenMoreThanDays: 0 }, approvalRoute: "MANAGER_OR_HR", yearEnd: null },
} as const;

describe("attendance, leave and payroll are unchanged with Peeps unset, on and off", () => {
  let org: TestOrgMasters;
  let director: Awaited<ReturnType<typeof createFullTestEmployee>>;
  let director2: Awaited<ReturnType<typeof createFullTestEmployee>>;
  let hrAdmin: Awaited<ReturnType<typeof createFullTestEmployee>>;
  let manager: Awaited<ReturnType<typeof createFullTestEmployee>>;
  const tok: Record<string, string> = {};
  const leavers: string[] = [];
  const typeId: Record<string, string> = {};
  let plan: MonthPlan;
  let world: SimWorld;
  let pay: RunWorld;
  let runId = "";
  const results = {} as Record<State, { attendance: string; leave: string; payroll: string }>;
  let monday: Date;

  const post = (who: string, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who]!)).send(body);
  const get = (who: string, path: string) => request(app).get(path).set(...authHeader(tok[who]!));

  async function resetNewTypes() {
    const ids = PEEPS_LEAVE_TYPE_CODES.map((c) => typeId[c]!);
    const versions = await prisma.leaveRuleVersion.findMany({ where: { leaveTypeId: { in: ids } }, select: { id: true } });
    await purgeAppendOnly("AuditLog", { entityId: { in: versions.map((v) => v.id) } });
    await deleteWithDependents("LeaveRuleVersion", versions.map((v) => v.id));
    await prisma.leavePolicy.deleteMany({ where: { leaveTypeId: { in: ids } } });
    await prisma.leaveType.updateMany({ where: { code: { in: [...PEEPS_LEAVE_TYPE_CODES] } }, data: { isActive: false, isPaid: false, allowHalfDay: false } });
  }

  async function enter(state: State) {
    await clearPeepsSettings();
    await resetNewTypes();
    if (state === "UNSET") return;
    const on = state === "ON";
    const d1 = { employeeId: director.employeeId, userId: director.userId }, d2 = { employeeId: director2.employeeId, userId: director2.userId };
    await setSetting("leave.calendarShowsType", { showType: on }, d1, d2);
    await setSetting("leave.showSensitiveTypes", { show: on }, d1, d2);
    const effectiveFrom = on ? iso(businessToday()) : "2099-01-01";
    for (const code of PEEPS_LEAVE_TYPE_CODES) {
      const prepared = await post("hrAdmin", `/api/leave-rules/${code}/versions`, { rules: RULES[code], note: "DEMO regression" });
      expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
      const approved = await post("director", `/api/leave-rules/${code}/versions/${prepared.body.version}/approve`, { effectiveFrom });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    }
  }

  /** The stored attendance of the golden world, recomputed in this state, and the scenarios' own check of it. */
  async function attendance(): Promise<string> {
    await recomputeWorld(world);
    expect(formatMismatches(await diffWorld(world, plan))).toBe("no differences");
    const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: { in: [...world.employeeId.values()] } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }] });
    return JSON.stringify(rows.map(stable));
  }

  /** A new employee with the same history in every state applies for PL and LOP; the manager approves; what each side sees is recorded. */
  async function leave(state: State): Promise<string> {
    const person = await createFullTestEmployee(org, { managerId: manager.employeeId });
    leavers.push(person.employeeId);
    tok[state] = await loginAs(person.employeeCode);
    const year = monday.getUTCFullYear();
    await writeLedgerEntry(prisma, { employeeId: person.employeeId, leaveTypeId: typeId.PL!, leaveYear: year, entryDate: new Date(Date.UTC(year, 0, 1)), entryType: "GRANT", days: 5 });
    const out: unknown[] = [];
    for (const [code, from, to, part] of [["PL", monday, addCalendarDays(monday, 2), "FULL"], ["LOP", addCalendarDays(monday, 4), addCalendarDays(monday, 7), "FIRST_HALF"]] as const) {
      const applied = await post(state, "/api/leave/requests", { leaveTypeId: typeId[code], fromDate: iso(from), toDate: iso(to), fromDayPart: "FULL", toDayPart: part, reason: "DEMO regression leave" });
      expect(applied.status, JSON.stringify(applied.body)).toBe(201);
      const approved = await post("manager", `/api/leave/requests/${applied.body.id}/approve`, {});
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const seen = (await get("manager", `/api/leave/requests/${applied.body.id}`)).body;
      out.push([code, String(applied.body.totalDays), seen.status, seen.leaveTypeCode, seen.leaveTypeName, String(seen.totalDays), seen.reason]);
    }
    const ledger = await prisma.leaveLedger.findMany({ where: { employeeId: person.employeeId }, orderBy: [{ entryDate: "asc" }, { createdAt: "asc" }] });
    out.push(ledger.map((l) => [l.entryType, String(l.days), iso(l.entryDate), l.leaveTypeId === typeId.PL ? "PL" : l.leaveTypeId === typeId.LOP ? "LOP" : "other"]));
    // The original types' balances; the four new types join the list once their rules are approved (that is the feature, not a change).
    const balances = (await get(state, "/api/leave/balances")).body as { balances: Array<{ code: string }> };
    const newTypesListed = balances.balances.filter((x) => (PEEPS_LEAVE_TYPE_CODES as readonly string[]).includes(x.code)).map((x) => x.code).sort();
    expect(newTypesListed).toEqual(state === "UNSET" ? [] : [...PEEPS_LEAVE_TYPE_CODES].sort()); // approving a version switches the type on
    out.push(JSON.stringify(balances.balances.filter((x) => !newTypesListed.includes(x.code))));
    const calendar = (await get("manager", `/api/leave/calendar?fromDate=${iso(monday)}&toDate=${iso(addCalendarDays(monday, 7))}`)).body;
    out.push(JSON.stringify(calendar).includes(person.employeeId) ? JSON.stringify(calendar).replace(/.*?(\{[^{}]*?"employeeId":"[^"]*"[^{}]*\})/g, (m, row: string) => (row.includes(person.employeeId) ? row.replaceAll(person.employeeId, "<me>").replace(/"(employeeName|employeeCode|name|code)":"[^"]*",?/g, "") : "")) : "absent");
    return JSON.stringify(out);
  }

  /** The same payroll run, calculated again in this state: every item and line. */
  async function payroll(): Promise<string> {
    if (!runId) runId = await calculateRun(pay);
    else await calculateAgain(pay, runId);
    const items = await prisma.payrollRunItem.findMany({ where: { runId, employeeId: { in: pay.staff.map((s) => s.employeeId) } }, include: { lines: true }, orderBy: { employeeId: "asc" } });
    return JSON.stringify(items.map(({ lines, ...item }) => [stable(item), lines.map(stable).sort()]));
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    for (const key of ["leave.approve", "leave.view"]) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.userPermissionOverride.create({ data: { userId: manager.userId, permissionId: perm.id, effect: "GRANT", reason: "test: manager approves their team", createdByUserId: director.userId } });
    }
    for (const [k, p] of Object.entries({ director, director2, hrAdmin, manager })) tok[k] = await loginAs(p.employeeCode);
    for (const t of await prisma.leaveType.findMany({ where: { code: { in: [...PEEPS_LEAVE_TYPE_CODES, "PL", "LOP"] } } })) typeId[t.code] = t.id;
    let d = addCalendarDays(businessToday(), 21);
    while (d.getUTCDay() !== 1) d = addCalendarDays(d, 1);
    monday = d;

    const roster = buildRoster({ seed: 20260801, month: "2026-08", employees: 40, existingHolidays: await existingHolidays("2026-08") });
    plan = planMonth(roster);
    world = await createWorld(roster, `pr${Date.now().toString(36).slice(-4)}`, manualEntriesOf(plan));
    const replay = await runReplay(world, plan);
    expect(formatMismatches(replay.mismatches)).toBe("no differences");

    pay = await buildRunWorld(["full", "lop", "joiner"]);
    for (const n of ["full", "lop", "joiner"]) await giveSalary(pay, pay.named[n]!.employeeId, "600000", FIRST_SALARY_DAY);
    await prisma.employee.update({ where: { id: pay.named.joiner!.employeeId }, data: { dateOfJoining: new Date("2026-08-11T00:00:00Z") } });
    await lockCycle(pay.named.full!.employeeId, CYCLE.start, CYCLE.end);
    await lockCycle(pay.named.lop!.employeeId, CYCLE.start, CYCLE.end, { "2026-08-10": { lop: "1" }, "2026-08-11": { lop: "0.5" } });
    await lockCycle(pay.named.joiner!.employeeId, "2026-08-11", CYCLE.end);
  }, 600_000);

  afterAll(async () => {
    await clearPeepsSettings();
    if (Object.keys(typeId).length) await resetNewTypes();
    if (pay) await teardownRunWorld(pay);
    await world?.cleanup();
    for (const e of leavers) await cleanupFullTestEmployee(e);
    for (const p of [manager, hrAdmin, director2, director]) if (p) await cleanupFullTestEmployee(p.employeeId);
    if (org) await cleanupEmployeeTestOrgMasters(org);
  }, 600_000);

  for (const state of ["UNSET", "ON", "OFF"] as const) {
    it(`${state}: the golden month replays without a difference, and leave and payroll run`, async () => {
      await enter(state);
      results[state] = { attendance: await attendance(), leave: await leave(state), payroll: await payroll() };
      const gross = (JSON.parse(results[state].payroll) as [string, string[]][]).map(([item]) => Number((JSON.parse(item) as [string, unknown][]).find(([k]) => k === "gross")![1]));
      expect(gross.filter((g) => g > 0).length).toBe(3); // real figures for all three, not held people
    }, 600_000);
  }

  it("every result is identical across the three states", () => {
    for (const part of ["attendance", "leave", "payroll"] as const) {
      expect(JSON.parse(results.ON[part]), `${part}: on`).toEqual(JSON.parse(results.UNSET[part]));
      expect(JSON.parse(results.OFF[part]), `${part}: off`).toEqual(JSON.parse(results.UNSET[part]));
    }
  });

  it("the comparison can fail: a changed day shows as a difference", async () => {
    const row = await prisma.dailyAttendance.findFirstOrThrow({ where: { employeeId: { in: [...world.employeeId.values()] }, status: "P" } });
    await prisma.dailyAttendance.update({ where: { id: row.id }, data: { status: "A", isLocked: true } });
    try {
      expect(await diffWorld(world, plan)).not.toEqual([]);
    } finally {
      await prisma.dailyAttendance.update({ where: { id: row.id }, data: { status: row.status, isLocked: row.isLocked } });
    }
  });
});
