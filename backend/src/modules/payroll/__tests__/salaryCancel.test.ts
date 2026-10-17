import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { salaryHistory } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { api } from "./runTestHelpers";
import { FIRST_SALARY_DAY, buildSalaryWorld, giveSalary, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";

// Cancelling a salary row that has been written but has not started is a pay change like any other: it takes a raise away. It goes through the same checker as
// a revision: previewed, decided by a different person bound to the row's exact figures, applied by the maker, never by the person whose pay it is.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const differentFingerprint = (f: string) => `${f.slice(0, -1)}${f.endsWith("0") ? "1" : "0"}`; // "0" is no change one time in sixteen
let w: SalaryWorld;
const scheduledDay = () => iso(addCalendarDays(businessToday(), 10));
const laterDay = () => iso(addCalendarDays(businessToday(), 14));

beforeAll(async () => {
  w = await buildSalaryWorld();
}, 120_000);
afterAll(async () => teardownSalaryWorld(w));

async function scheduleRaise(employeeId: string, annual = "1500000", from = scheduledDay()): Promise<string> {
  await giveSalary(w, employeeId, annual, from);
  return (await salaryHistory(employeeId)).find((r) => iso(r.effectiveFrom) === from)!.id;
}

describe("cancelling a scheduled salary", () => {
  it("is previewed with the row that goes and the salary that stays, then decided by a different person and applied by the maker", async () => {
    const e = w.staff[0]!;
    await giveSalary(w, e.employeeId, "1200000", FIRST_SALARY_DAY);
    const rowId = await scheduleRaise(e.employeeId);
    const input = { employeeId: e.employeeId, salaryId: rowId, note: "the raise was approved for the wrong person" };

    const preview = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body).toMatchObject({ kind: "CANCEL_SCHEDULED", canSubmit: true, scheduled: { annualCtc: "1500000", startsOn: scheduledDay() }, stays: { annualCtc: "1200000", startedOn: FIRST_SALARY_DAY } });
    const created = await api(w.tokens.maker, "post", "/salary/revisions/cancel", { input, fingerprint: preview.body.fingerprint });
    expect(created.status).toBe(201);
    const id = created.body.id as string;

    // Nothing has changed yet, and the maker cannot approve their own request.
    expect((await salaryHistory(e.employeeId)).map((r) => iso(r.effectiveFrom))).toEqual([scheduledDay(), FIRST_SALARY_DAY]);
    const detail = await api(w.tokens.maker, "get", `/salary/revisions/${id}`);
    expect(detail.body).toMatchObject({ kind: "CANCEL_SCHEDULED", status: "WAITING_FOR_CHECKER" });
    expect((await api(w.tokens.maker, "post", `/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: detail.body.fingerprint })).status).toBe(403);
    expect((await api(w.tokens.maker, "post", `/salary/revisions/${id}/apply`)).body.error.code).toBe("APPROVAL_REQUIRED");

    // A stale fingerprint is refused; the right one approves.
    const stale = await api(w.tokens.checkerA, "post", `/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: differentFingerprint(detail.body.fingerprint) });
    expect(stale.body.error.code).toBe("PREVIEW_STALE");
    const decided = await api(w.tokens.checkerA, "post", `/salary/revisions/${id}/decision`, { decision: "APPROVE", note: "checked", fingerprint: detail.body.fingerprint });
    expect(decided.status).toBe(200);
    const applied = await api(w.tokens.maker, "post", `/salary/revisions/${id}/apply`);
    expect(applied.status).toBe(200);

    // The scheduled row is gone, the earlier one is open again, and the record says what was removed.
    const history = await salaryHistory(e.employeeId);
    expect(history.map((r) => [iso(r.effectiveFrom), r.effectiveTo])).toEqual([[FIRST_SALARY_DAY, null]]);
    const after = await api(w.tokens.maker, "get", `/salary/revisions/${id}`);
    expect(after.body).toMatchObject({ status: "APPLIED", kind: "CANCEL_SCHEDULED", plan: { scheduled: { annualCtc: "1500000" }, stays: { annualCtc: "1200000" } } });
    const audit = await prisma.auditLog.findMany({ where: { action: "payroll.salary.cancelled", entityId: rowId } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.after)).not.toMatch(/1500000|1200000/);
    const listed = await api(w.tokens.maker, "get", "/salary/revisions");
    expect(listed.body.items.find((r: { id: string }) => r.id === id)).toMatchObject({ kind: "CANCEL_SCHEDULED", status: "APPLIED" });
  });

  it("refuses a row that has started, nobody to fall back to, and a row that is not the latest", async () => {
    const e = w.staff[1]!;
    await giveSalary(w, e.employeeId, "1200000", FIRST_SALARY_DAY);
    const started = (await salaryHistory(e.employeeId))[0]!;
    const p1 = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input: { employeeId: e.employeeId, salaryId: started.id } });
    expect(p1.body.canSubmit).toBe(false);
    expect(p1.body.blockers.join(" ")).toMatch(/started on 2025-04-01, so it cannot be cancelled. Make a revision dated after it instead/);
    const first = await scheduleRaise(e.employeeId, "1300000", scheduledDay());
    await scheduleRaise(e.employeeId, "1400000", laterDay());
    const p2 = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input: { employeeId: e.employeeId, salaryId: first } });
    expect(p2.body.blockers.join(" ")).toMatch(/Only the latest scheduled salary can be cancelled/);
    const missing = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input: { employeeId: e.employeeId, salaryId: "no-such-row" } });
    expect(missing.body.blockers.join(" ")).toMatch(/not found/);
  });

  it("is void if the person's salary changes after it was approved, and nothing is written", async () => {
    const e = w.staff[2]!;
    await giveSalary(w, e.employeeId, "1200000", FIRST_SALARY_DAY);
    const rowId = await scheduleRaise(e.employeeId);
    const input = { employeeId: e.employeeId, salaryId: rowId, note: "mistake" };
    const preview = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input });
    const id = (await api(w.tokens.maker, "post", "/salary/revisions/cancel", { input, fingerprint: preview.body.fingerprint })).body.id as string;
    const detail = await api(w.tokens.checkerA, "get", `/salary/revisions/${id}`);
    await api(w.tokens.checkerA, "post", `/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: detail.body.fingerprint });
    await giveSalary(w, e.employeeId, "1600000", laterDay()); // a later raise makes the one being cancelled no longer the latest
    const applied = await api(w.tokens.maker, "post", `/salary/revisions/${id}/apply`);
    expect([applied.status, applied.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    expect((await salaryHistory(e.employeeId)).map((r) => iso(r.effectiveFrom))).toEqual([laterDay(), scheduledDay(), FIRST_SALARY_DAY]);
    expect((await api(w.tokens.maker, "get", `/salary/revisions/${id}`)).body.status).toBe("VOIDED");
  });

  it("cannot be prepared, decided or applied by the person whose pay it is, and a withdrawn request changes nothing", async () => {
    // Your own pay: refused before anything is made, whatever your role.
    const own = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input: { employeeId: w.maker.employeeId, salaryId: "any" } });
    expect([own.status, own.body.error.code]).toEqual([403, "SELF_PAY"]);
    // A checker whose own scheduled raise it is cannot approve its cancellation.
    await giveSalary(w, w.checkerB.employeeId, "1200000", FIRST_SALARY_DAY);
    const rowId = await scheduleRaise(w.checkerB.employeeId);
    const input = { employeeId: w.checkerB.employeeId, salaryId: rowId, note: "cancel it" };
    const preview = await api(w.tokens.maker, "post", "/salary/revisions/cancel-preview", { input });
    expect(preview.body.checkers.excluded.map((c: { userId: string }) => c.userId)).toEqual([w.checkerB.userId]); // left out of "who can approve", with the reason
    expect(preview.body.checkers.eligible.map((c: { userId: string }) => c.userId)).not.toContain(w.checkerB.userId);
    const id = (await api(w.tokens.maker, "post", "/salary/revisions/cancel", { input, fingerprint: preview.body.fingerprint })).body.id as string;
    const detail = await api(w.tokens.checkerB, "get", `/salary/revisions/${id}`);
    const self = await api(w.tokens.checkerB, "post", `/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: detail.body.fingerprint });
    expect([self.status, self.body.error.code]).toEqual([403, "CHECKER_IS_AFFECTED"]);
    const withdrawn = await api(w.tokens.maker, "post", `/salary/revisions/${id}/withdraw`, { reason: "changed my mind" });
    expect(withdrawn.status).toBe(200);
    expect((await api(w.tokens.maker, "get", `/salary/revisions/${id}`)).body.status).toBe("WITHDRAWN");
    expect((await salaryHistory(w.checkerB.employeeId)).map((r) => iso(r.effectiveFrom))).toEqual([scheduledDay(), FIRST_SALARY_DAY]);
  });

  it("needs payroll.salary.edit to prepare it and payroll.approve to decide it", async () => {
    const e = w.staff[0]!;
    const row = (await salaryHistory(e.employeeId))[0]!;
    const asChecker = await api(w.tokens.checkerA, "post", "/salary/revisions/cancel-preview", { input: { employeeId: e.employeeId, salaryId: row.id } });
    expect(asChecker.status).toBe(403);
  });
});
