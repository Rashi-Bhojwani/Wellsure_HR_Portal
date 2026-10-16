import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import {
  cancelScheduledSalary,
  closeHistoryOnLeaving,
  latestSalaries,
  salariesOn,
  salaryHistory,
  salaryOn,
  salarySegments,
  setPayrollLockCheck,
  writeBackdatedSalaryChange,
  writeSalaryChange,
  type SalaryWrite,
} from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// The salary timeline: the same family as job, name and bank history, with the one difference that money is never amended. Dates in the past are fixed
// (always started, whatever the clock says); dates in the future are relative to today.

const d = (s: string) => new Date(s);
const data = (annual = "1200000", over: Partial<SalaryWrite> = {}): SalaryWrite => ({
  reason: "REVISION",
  annualCtc: annual,
  monthlyCtc: "100000",
  structureKey: "TEST_STRUCTURE",
  structureVersion: 1,
  structureHash: "structure-hash-1",
  roundingPin: { key: "LINE_ROUNDING", version: 1, valueHash: "x" },
  revisionId: null,
  note: "",
  lines: [
    { componentCode: "BASIC", componentVersion: 1, componentType: "EARNING", amount: "40000", sortOrder: 0 },
    { componentCode: "SPECIAL", componentVersion: 1, componentType: "EARNING", amount: "60000", sortOrder: 1 },
  ],
  ...over,
});

describe("the salary timeline", () => {
  let org: TestOrgMasters;
  let actor: { employeeId: string; userId: string };
  const made: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    actor = await createFullTestEmployee(org);
    made.push(actor.employeeId);
  });
  afterEach(() => setPayrollLockCheck(null));
  afterAll(async () => {
    for (const id of made) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  async function person() {
    const p = await createFullTestEmployee(org);
    made.push(p.employeeId);
    return p;
  }
  const write = (employeeId: string, day: string, over?: Partial<SalaryWrite>, annual?: string) => prisma.$transaction((tx) => writeSalaryChange(tx, employeeId, d(day), data(annual, over), { createdByUserId: actor.userId }));
  const rejects = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error & { code?: string }) => e)) as (Error & { code?: string }) | null;

  it("a first salary starts on or after the joining date, never before", async () => {
    const p = await person();
    expect((await rejects(write(p.employeeId, "2023-12-31")))?.code).toBe("SALARY_BEFORE_JOINING");
    const { plan, after } = await write(p.employeeId, "2024-01-01", { reason: "JOINING" });
    expect(plan).toBe("first");
    expect(after.lines.map((l) => l.componentCode)).toEqual(["BASIC", "SPECIAL"]);
    expect(await salaryOn(p.employeeId, d("2023-12-31"))).toBeNull();
    expect((await salaryOn(p.employeeId, d("2024-01-01")))?.id).toBe(after.id);
  });

  it("a revision closes the one before on its own day, and the readers answer for each day", async () => {
    const p = await person();
    await write(p.employeeId, "2025-04-01", { reason: "JOINING" }, "1200000");
    await write(p.employeeId, "2026-04-16", {}, "1500000");
    expect((await salaryOn(p.employeeId, d("2026-04-15")))?.annualCtc.toString()).toBe("1200000");
    expect((await salaryOn(p.employeeId, d("2026-04-16")))?.annualCtc.toString()).toBe("1500000");
    const history = await salaryHistory(p.employeeId);
    expect(history.map((r) => [r.effectiveFrom.toISOString().slice(0, 10), r.effectiveTo?.toISOString().slice(0, 10) ?? null])).toEqual([
      ["2026-04-16", null],
      ["2025-04-01", "2026-04-16"],
    ]);
    // A change on the 16th gives two segments in April, split on the day.
    const segments = await salarySegments(p.employeeId, d("2026-04-01"), d("2026-04-30"));
    expect(segments.map((s) => [s.from.toISOString().slice(0, 10), s.to.toISOString().slice(0, 10), s.row.annualCtc.toString()])).toEqual([
      ["2026-04-01", "2026-04-15", "1200000"],
      ["2026-04-16", "2026-04-30", "1500000"],
    ]);
    expect((await salariesOn([p.employeeId], d("2026-05-01"))).get(p.employeeId)?.annualCtc.toString()).toBe("1500000");
    expect((await latestSalaries([p.employeeId])).get(p.employeeId)?.annualCtc.toString()).toBe("1500000");
  });

  it("refuses a change dated the same day as the latest row (money is never amended) and one dated before it", async () => {
    const p = await person();
    await write(p.employeeId, "2025-04-01", { reason: "JOINING" });
    expect((await rejects(write(p.employeeId, "2025-04-01")))?.code).toBe("SALARY_SAME_DAY");
    await write(p.employeeId, "2026-01-01");
    expect((await rejects(write(p.employeeId, "2025-09-01")))?.code).toBe("HISTORY_BEFORE_LATEST");
    expect(await prisma.employeeSalary.count({ where: { employeeId: p.employeeId } })).toBe(2);
  });

  it("a scheduled salary can be cancelled and the one before reopens; a started one cannot", async () => {
    const p = await person();
    await write(p.employeeId, "2025-04-01", { reason: "JOINING" });
    const future = addCalendarDays(businessToday(), 30).toISOString().slice(0, 10);
    const { after: scheduled } = await write(p.employeeId, future);
    expect((await salaryOn(p.employeeId, businessToday()))?.annualCtc.toString()).toBe("1200000"); // not in force yet
    expect((await rejects(write(p.employeeId, "2025-06-01")))?.code).toBe("HISTORY_SCHEDULED_EXISTS");
    const { removed, reopened } = await prisma.$transaction((tx) => cancelScheduledSalary(tx, p.employeeId, scheduled.id));
    expect(removed.id).toBe(scheduled.id);
    expect(reopened.effectiveTo).toBeNull();
    expect(await prisma.employeeSalaryLine.count({ where: { salaryId: scheduled.id } })).toBe(0); // its breakup went with it
    const started = (await salaryHistory(p.employeeId))[0]!;
    expect((await rejects(prisma.$transaction((tx) => cancelScheduledSalary(tx, p.employeeId, started.id))))?.code).toMatch(/HISTORY_IN_FORCE|HISTORY_ONLY_ROW/);
  });

  it("the database itself refuses overlap, a row that ends before it starts, two open rows, a zero CTC, and any change to the money", async () => {
    const p = await person();
    const { after } = await write(p.employeeId, "2025-04-01", { reason: "JOINING" });
    const raw = (sql: string) => prisma.$executeRawUnsafe(sql);
    const insert = (from: string, to: string | null, extra = "") =>
      raw(
        `INSERT INTO employee_salaries (id, employee_id, effective_from, effective_to, reason, annual_ctc, monthly_ctc, structure_key, structure_version, structure_hash, rounding_pin, created_by_user_id${extra ? ", " + extra.split("=")[0] : ""})
         VALUES ('raw-${Math.random().toString(36).slice(2)}', '${p.employeeId}', '${from}', ${to ? `'${to}'` : "NULL"}, 'REVISION', ${extra.startsWith("annual") ? "0" : "1"}, 1, 'S', 1, 'h', '{}', 'u'${extra ? ", 1" : ""})`,
      );
    await expect(insert("2025-06-01", "2025-07-01")).rejects.toThrow(/employee_salaries_no_overlap/); // inside the open row
    await expect(insert("2024-01-01", "2024-01-01")).rejects.toThrow(/employee_salaries_dates_ordered/); // ends where it starts
    await expect(insert("2024-02-01", "2024-01-01")).rejects.toThrow(/employee_salaries_dates_ordered/); // runs backwards
    await expect(insert("2022-01-01", null)).rejects.toThrow(/employee_salaries_one_open|employee_salaries_no_overlap/); // a second open row
    await expect(raw(`UPDATE employee_salaries SET annual_ctc = 1 WHERE id = '${after.id}'`)).rejects.toThrow(/SALARY_ROW_IMMUTABLE/);
    await expect(raw(`UPDATE employee_salaries SET structure_key = 'OTHER' WHERE id = '${after.id}'`)).rejects.toThrow(/SALARY_ROW_IMMUTABLE/);
    await expect(raw(`UPDATE employee_salaries SET effective_from = '2025-03-01' WHERE id = '${after.id}'`)).rejects.toThrow(/SALARY_ROW_IMMUTABLE/);
    await expect(raw(`UPDATE employee_salary_lines SET amount = 1 WHERE salary_id = '${after.id}'`)).rejects.toThrow(/SALARY_ROW_IMMUTABLE/);
    await expect(raw(`DELETE FROM employee_salary_lines WHERE salary_id = '${after.id}'`)).rejects.toThrow(/SALARY_ROW_IMMUTABLE/); // its parent has started
    await expect(raw(`DELETE FROM employee_salaries WHERE id = '${after.id}'`)).rejects.toThrow(/SALARY_ROW_IMMUTABLE/); // it has started
    await expect(raw(`UPDATE employee_salaries SET annual_ctc = annual_ctc, effective_to = '2025-12-01' WHERE id = '${after.id}'`)).resolves.toBeDefined(); // closing it is allowed
    expect((await prisma.employeeSalary.findUniqueOrThrow({ where: { id: after.id } })).effectiveTo?.toISOString().slice(0, 10)).toBe("2025-12-01");
    await expect(raw(`INSERT INTO employee_salary_lines (id, salary_id, component_code, component_version, component_type, amount, sort_order) VALUES ('l1', '${after.id}', 'X', 1, 'BONUS', 1, 9)`)).rejects.toThrow(/employee_salary_lines_type/);
    await expect(raw(`INSERT INTO employee_salary_lines (id, salary_id, component_code, component_version, component_type, amount, sort_order) VALUES ('l2', '${after.id}', 'X', 1, 'EARNING', -1, 9)`)).rejects.toThrow(/employee_salary_lines_amount_not_negative/);
  });

  it("leaving ends the salary the day after the last working day, drops a scheduled one, and refuses to hide one already in force", async () => {
    const p = await person();
    await write(p.employeeId, "2025-04-01", { reason: "JOINING" });
    const future = addCalendarDays(businessToday(), 60).toISOString().slice(0, 10);
    await write(p.employeeId, future);
    const last = addCalendarDays(businessToday(), 10);
    const { removedScheduled } = await prisma.$transaction((tx) => closeHistoryOnLeaving(tx, p.employeeId, last));
    void removedScheduled;
    const rows = await salaryHistory(p.employeeId);
    expect(rows).toHaveLength(1); // the scheduled one is gone
    expect(rows[0]!.effectiveTo?.toISOString().slice(0, 10)).toBe(addCalendarDays(last, 1).toISOString().slice(0, 10));
    expect(await salaryOn(p.employeeId, last)).not.toBeNull(); // in force on the last working day
    expect(await salaryOn(p.employeeId, addCalendarDays(last, 1))).toBeNull();
    // A salary already in force after the day they left is a history rewrite.
    const q = await person();
    await write(q.employeeId, "2025-04-01", { reason: "JOINING" });
    await write(q.employeeId, "2026-01-01");
    expect((await rejects(prisma.$transaction((tx) => closeHistoryOnLeaving(tx, q.employeeId, d("2025-12-01")))))?.code).toBe("HISTORY_AFTER_LEAVING");
  });

  it("the payroll lock refuses a salary dated inside a finalised period; only the one named bypass writes there", async () => {
    const p = await person();
    await write(p.employeeId, "2025-04-01", { reason: "JOINING" });
    setPayrollLockCheck(async (day) => (day <= d("2025-12-31") ? { locked: true, period: "to Dec 2025" } : { locked: false }));
    const refused = await rejects(write(p.employeeId, "2025-10-01"));
    expect(refused?.code).toBe("PAYROLL_LOCKED");
    expect(await prisma.employeeSalary.count({ where: { employeeId: p.employeeId } })).toBe(1);
    const { after } = await prisma.$transaction((tx) => writeBackdatedSalaryChange(tx, p.employeeId, d("2025-10-01"), data("1300000"), { createdByUserId: actor.userId }));
    expect(after.effectiveFrom.toISOString().slice(0, 10)).toBe("2025-10-01"); // the true date is on the timeline
    // The bypass skips only the lock: every other rule of the timeline still holds.
    expect((await rejects(prisma.$transaction((tx) => writeBackdatedSalaryChange(tx, p.employeeId, d("2025-10-01"), data("1400000"), { createdByUserId: actor.userId }))))?.code).toBe("SALARY_SAME_DAY");
    expect((await rejects(prisma.$transaction((tx) => writeBackdatedSalaryChange(tx, p.employeeId, d("2025-06-01"), data("1400000"), { createdByUserId: actor.userId }))))?.code).toBe("HISTORY_BEFORE_LATEST");
  });
});
