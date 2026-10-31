import { Prisma } from "@prisma/client";
import { z } from "zod";
import { cycleForRules, loadCycleRules } from "../../../lib/attendanceCycle";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { authorityFor, choiceMode, requireDirector } from "../../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../../lib/directorNotices";
import { employedBetween, namesOn, notifyPayrollInputsChanged, payrollConsumedBetween, payrollPlacementsOn, unfinalisedAttendanceDays } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { adapterFor, authorise, availabilityFrom, decide, liveApproval, noteFiguresChanged, registerSubject, submit, type CheckerAvailability } from "../approvals";
import { namesOfUsers } from "../names";
import { activeUsersHoldingPermission } from "../../../lib/permissions";
import { recordEvent, type Db } from "../events";
import { iso } from "../run/days";
import { payrollHash } from "../hash";
import { isActiveOn, type ComponentValue } from "../salary/schemas";
import { assertNotOwnPay, employeeIdOfUser, userIdsOfEmployees } from "../salary/guards";
import { currentCells, inputsHash, missingInputs, monthState, parseAmountText, type Cell, type LedgerRow, type MissingInput, type MonthState } from "./rules";

// Monthly Inputs: the figures a director enters for a payroll month, for the pay heads flagged "takes its value from Monthly Inputs" (docs/plans/STAGE_4_PLAN.md).
// Directors only, on every path. The muster holds no money: nothing here is read by attendance, and nothing here is entered before attendance is final.

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const MAX_CELLS_PER_REQUEST = 500;
const PAGE_SIZE_MAX = 200;
const NOTE_MIN = 3;

export async function cycleOfStart(cycleStart: string) {
  const rules = await loadCycleRules();
  const cycle = cycleForRules(rules, day(cycleStart));
  if (iso(cycle.start) !== cycleStart) throw new HttpError(400, `${cycleStart} is not the first day of a payroll month. The one containing it starts on ${iso(cycle.start)}.`, "VALIDATION_ERROR");
  return cycle;
}

export interface Head {
  code: string;
  name: string;
  /** EARNING is paid; DEDUCTION is taken off. An employer contribution is never a monthly input. */
  type: "EARNING" | "DEDUCTION";
  version: number;
}

/** The heads flagged as taking their value from Monthly Inputs and active on the last day of the month. Never hard-coded: a director creates and flags them. */
export async function inputHeads(cycleEnd: Date, db: Db = prisma): Promise<Head[]> {
  const rows = await db.payrollItemVersion.findMany({ where: { kind: "COMPONENT" }, orderBy: [{ key: "asc" }, { version: "asc" }] });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(r.key, r);
  const out: Head[] = [];
  for (const r of latest.values()) {
    const v = r.value as unknown as ComponentValue;
    if (!v.inputItem || v.type === "EMPLOYER_CONTRIBUTION" || !isActiveOn(v, iso(cycleEnd))) continue;
    out.push({ code: r.key, name: v.name, type: v.type, version: r.version });
  }
  return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

async function ledger(cycleStart: string, db: Db = prisma): Promise<Array<LedgerRow & { id: string; at: Date; by: string; reason: string; batchId: string | null }>> {
  const rows = await db.payrollMonthlyInput.findMany({ where: { cycleStart: day(cycleStart) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, head: r.componentCode, amount: r.amount === null ? null : r.amount.toString(), cleared: r.cleared, at: r.createdAt, by: r.enteredByUserId, reason: r.reason, batchId: r.batchId }));
}

/** The figures that stand now for a month (entered, not cleared), and only for the active flagged heads. */
export async function currentFigures(cycleStart: string, db: Db = prisma): Promise<Cell[]> {
  const cycle = await cycleOfStart(cycleStart);
  const heads = new Set((await inputHeads(cycle.end, db)).map((h) => h.code));
  return currentCells(await ledger(cycleStart, db)).filter((c) => heads.has(c.head));
}

export const hashOfMonth = async (cycleStart: string, db: Db = prisma): Promise<string> => inputsHash(cycleStart, await currentFigures(cycleStart, db));

export interface PeopleInMonth {
  ids: string[];
  people: Array<{ id: string; dateOfJoining: Date; lastWorkingDate: Date | null; employeeCode: string }>;
}
export async function peopleInMonth(start: Date, end: Date): Promise<PeopleInMonth> {
  const people = await prisma.employee.findMany({ where: employedBetween(start, end), select: { id: true, employeeCode: true, dateOfJoining: true, lastWorkingDate: true }, orderBy: { employeeCode: "asc" } });
  return { ids: people.map((p) => p.id), people };
}

export interface MonthView {
  cycleStart: string;
  cycleEnd: string;
  label: string;
  state: MonthState;
  reason: string | null;
  heads: Head[];
  people: number;
  cells: number;
  entered: number;
  blank: number;
  /** People with a head still blank, counted per person. */
  peopleWithBlanks: number;
  confirmation: { status: "NONE" | "PENDING" | "CONFIRMED" | "OUT_OF_DATE"; approvalId: string | null; makerName: string | null; checkerName: string | null; at: string | null; authority: string | null };
  hash: string;
}

export async function monthView(cycleStart: string): Promise<MonthView> {
  const cycle = await cycleOfStart(cycleStart);
  const [heads, who] = await Promise.all([inputHeads(cycle.end), peopleInMonth(cycle.start, cycle.end)]);
  const cycleOver = cycle.end < businessToday();
  const unfinal = cycleOver ? await unfinalisedAttendanceDays(who.people, cycle.start, cycle.end) : new Map<string, string[]>();
  const attendanceFinal = cycleOver && [...unfinal.values()].every((d) => d.length === 0);
  const consumed = await payrollConsumedBetween(cycle.start, cycle.end);
  const cells = currentCells(await ledger(cycleStart)).filter((c) => heads.some((h) => h.code === c.head) && who.ids.includes(c.employeeId));
  const hash = inputsHash(cycleStart, cells);
  const approval = await prisma.payrollApproval.findFirst({ where: { subject: "MONTHLY_INPUTS", subjectId: cycleStart, status: { in: ["PENDING", "APPROVED"] } }, orderBy: { submittedAt: "desc" } });
  const confirmed = approval?.status === "APPROVED" && approval.hashAtDecision === hash;
  const { state, reason } = monthState({ cycleOver, attendanceFinal, runUsesIt: consumed.consumed, confirmed });
  const names = await namesOfUsers([approval?.makerUserId, approval?.checkerUserId].filter((x): x is string => !!x));
  const missing = missingInputs(who.ids, heads.map((h) => h.code), cells);
  const total = who.ids.length * heads.length;
  return {
    cycleStart,
    cycleEnd: iso(cycle.end),
    label: cycle.label,
    state,
    reason,
    heads,
    people: who.ids.length,
    cells: total,
    entered: total - missing.length,
    blank: missing.length,
    peopleWithBlanks: new Set(missing.map((m) => m.employeeId)).size,
    confirmation: approval
      ? { status: approval.status === "PENDING" ? "PENDING" : confirmed ? "CONFIRMED" : "OUT_OF_DATE", approvalId: approval.id, makerName: names.get(approval.makerUserId) ?? null, checkerName: approval.checkerUserId ? (names.get(approval.checkerUserId) ?? null) : null, at: (approval.decidedAt ?? approval.submittedAt).toISOString(), authority: approval.authority }
      : { status: "NONE", approvalId: null, makerName: null, checkerName: null, at: null, authority: null },
    hash,
  };
}

// ── The grid ──

export const gridQuerySchema = z
  .object({
    cycleStart: z.iso.date(),
    departmentId: z.string().min(1).max(64).optional(),
    employeeId: z.string().min(1).max(64).optional(),
    head: z.string().min(1).max(64).optional(),
    status: z.enum(["NOT_ENTERED", "ENTERED", "CHANGED"]).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(PAGE_SIZE_MAX).default(40),
  })
  .strict();
export type GridQuery = z.infer<typeof gridQuerySchema>;

export interface GridRow {
  employeeId: string;
  employeeCode: string;
  name: string;
  departmentId: string | null;
  departmentName: string | null;
  cells: Array<{ head: string; amount: string | null; entries: number; lastAt: string | null }>;
}

export async function grid(q: GridQuery): Promise<{ month: MonthView; rows: GridRow[]; total: number; page: number; pageSize: number }> {
  const month = await monthView(q.cycleStart);
  const cycle = await cycleOfStart(q.cycleStart);
  const who = await peopleInMonth(cycle.start, cycle.end);
  const placements = await payrollPlacementsOn(who.ids, cycle.end);
  const deptNames = new Map((await prisma.department.findMany({ select: { id: true, name: true } })).map((d) => [d.id, d.name]));
  const names = await namesOn(who.ids, cycle.end);
  const rowsAll = await ledger(q.cycleStart);
  const shown = month.heads.filter((h) => !q.head || h.code === q.head);
  const byCell = new Map<string, typeof rowsAll>();
  for (const r of rowsAll) byCell.set(`${r.employeeId}|${r.head}`, [...(byCell.get(`${r.employeeId}|${r.head}`) ?? []), r]);
  let people = who.people;
  if (q.employeeId) people = people.filter((p) => p.id === q.employeeId);
  if (q.departmentId) people = people.filter((p) => placements.get(p.id)?.departmentId === q.departmentId);
  const view = (id: string): GridRow["cells"] =>
    shown.map((h) => {
      const history = byCell.get(`${id}|${h.code}`) ?? [];
      const last = history.at(-1);
      return { head: h.code, amount: last && !last.cleared ? last.amount : null, entries: history.length, lastAt: last ? last.at.toISOString() : null };
    });
  const all = people.map((p) => ({ p, cells: view(p.id) }));
  const kept = all.filter(({ cells }) => (q.status === "NOT_ENTERED" ? cells.some((c) => c.amount === null) : q.status === "ENTERED" ? cells.every((c) => c.amount !== null) : q.status === "CHANGED" ? cells.some((c) => c.entries > 1) : true));
  const start = (q.page - 1) * q.pageSize;
  const rows = kept.slice(start, start + q.pageSize).map(({ p, cells }): GridRow => {
    const dept = placements.get(p.id)?.departmentId ?? null;
    return { employeeId: p.id, employeeCode: p.employeeCode, name: names.get(p.id) ?? p.employeeCode, departmentId: dept, departmentName: dept ? (deptNames.get(dept) ?? null) : null, cells };
  });
  return { month, rows, total: kept.length, page: q.page, pageSize: q.pageSize };
}

export interface HistoryEntry {
  id: string;
  employeeId: string;
  employeeCode: string;
  name: string;
  head: string;
  amount: string | null;
  cleared: boolean;
  reason: string;
  by: string;
  at: string;
  fromFile: boolean;
}

export const historyQuerySchema = z.object({ cycleStart: z.iso.date(), employeeId: z.string().min(1).max(64).optional(), head: z.string().min(1).max(64).optional() }).strict();

/** Every entry ever made for the month (newest first), not just the one that stands. */
export async function history(q: z.infer<typeof historyQuerySchema>): Promise<HistoryEntry[]> {
  const rows = (await ledger(q.cycleStart)).filter((r) => (!q.employeeId || r.employeeId === q.employeeId) && (!q.head || r.head === q.head)).reverse().slice(0, MAX_CELLS_PER_REQUEST);
  const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, employeeCode: true } });
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const names = await namesOn([...code.keys()], businessToday());
  const who = await namesOfUsers([...new Set(rows.map((r) => r.by))]);
  return rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeCode: code.get(r.employeeId) ?? r.employeeId, name: names.get(r.employeeId) ?? code.get(r.employeeId) ?? r.employeeId, head: r.head, amount: r.amount, cleared: r.cleared, reason: r.reason, by: who.get(r.by) ?? "A director", at: r.at.toISOString(), fromFile: r.batchId !== null }));
}

// ── Entering figures ──

export const entrySchema = z
  .object({
    employeeId: z.string().min(1).max(64),
    head: z.string().min(1).max(64),
    /** Text so it stays exact. Null clears the cell back to blank. */
    amount: z.string().max(40).nullable(),
  })
  .strict();
export const enterSchema = z
  .object({
    cycleStart: z.iso.date(),
    entries: z.array(entrySchema).min(1).max(MAX_CELLS_PER_REQUEST),
    reason: z.string().trim().min(NOTE_MIN, "Say why").max(200),
  })
  .strict();
export type EnterInput = z.infer<typeof enterSchema>;

export interface Actor {
  userId: string;
  ip?: string | null;
}

/** Refuses unless the month accepts figures. Returns what the caller needs. */
export async function assertAcceptsFigures(cycleStart: string): Promise<MonthView> {
  const month = await monthView(cycleStart);
  if (month.state === "CLOSED" || month.state === "LOCKED") throw new HttpError(409, month.reason ?? "This month does not accept figures.", month.state === "LOCKED" ? "MONTH_LOCKED" : "MONTH_CLOSED");
  return month;
}

export interface PlannedRow {
  employeeId: string;
  head: string;
  amount: string | null;
}

/** Writes the rows in one transaction, voids any confirmation and tells payroll and the other director. Counts only leave this function. */
export async function writeEntries(cycleStart: string, rows: PlannedRow[], reason: string, actor: Actor, opts: { batchId?: string | null; what: string; db?: Prisma.TransactionClient } = { what: "Monthly Inputs were entered" }): Promise<{ written: number; voidedConfirmation: boolean }> {
  const run = async (tx: Prisma.TransactionClient) => {
    await tx.payrollMonthlyInput.createMany({
      data: rows.map((r) => ({ employeeId: r.employeeId, componentCode: r.head, cycleStart: day(cycleStart), amount: r.amount, cleared: r.amount === null, reason, enteredByUserId: actor.userId, batchId: opts.batchId ?? null })),
    });
    const { voided } = await noteFiguresChanged("MONTHLY_INPUTS", cycleStart, actor.userId, opts.what, tx);
    await recordEvent({ subjectType: "MONTHLY_INPUTS", subjectId: cycleStart, type: "ENTERED", actorUserId: actor.userId, payload: { count: rows.length, batchId: opts.batchId ?? null } }, tx);
    const { noticeId } = await recordDirectorNotice({ kind: "ACTION", step: "MONTHLY_INPUTS", subjectType: "MONTHLY_INPUTS", subjectId: cycleStart, subjectLabel: `${rows.length} Monthly Inputs ${rows.length === 1 ? "figure" : "figures"} entered`, itemCount: rows.length, actorUserId: actor.userId, approvalId: null, authority: null }, tx);
    return { voided, noticeId };
  };
  const result = opts.db ? await run(opts.db) : await prisma.$transaction(run);
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.monthly_inputs.entered", entityType: "PayrollMonthlyInput", entityId: cycleStart, after: { cycleStart, count: rows.length, batchId: opts.batchId ?? null, voidedConfirmation: result.voided, amounts: "redacted" }, ipAddress: actor.ip ?? null });
  await scheduleDelivery(result.noticeId);
  await notifyPayrollInputsChanged("Monthly Inputs were entered", actor.userId);
  return { written: rows.length, voidedConfirmation: result.voided };
}

export async function enter(raw: unknown, actor: Actor): Promise<{ written: number; voidedConfirmation: boolean }> {
  const parsed = enterSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  await requireDirector(actor.userId, "enter Monthly Inputs");
  const month = await assertAcceptsFigures(input.cycleStart);
  const cycle = await cycleOfStart(input.cycleStart);
  const who = await peopleInMonth(cycle.start, cycle.end);
  const headCodes = new Set(month.heads.map((h) => h.code));
  const seen = new Set<string>();
  const problems: string[] = [];
  const rows: PlannedRow[] = [];
  input.entries.forEach((e, i) => {
    const where = `Entry ${i + 1}`;
    if (!who.ids.includes(e.employeeId)) problems.push(`${where}: that person was not employed in ${month.label}.`);
    if (!headCodes.has(e.head)) problems.push(`${where}: ${e.head} is not a pay head that takes its value from Monthly Inputs and is active in ${month.label}.`);
    const key = `${e.employeeId}|${e.head}`;
    if (seen.has(key)) problems.push(`${where}: the same cell is in this request twice.`);
    seen.add(key);
    if (e.amount === null) rows.push({ employeeId: e.employeeId, head: e.head, amount: null });
    else {
      const a = parseAmountText(e.amount);
      if (!a.ok) problems.push(`${where}: ${a.message}`);
      else rows.push({ employeeId: e.employeeId, head: e.head, amount: a.value });
    }
  });
  if (problems.length > 0) throw new HttpError(400, "Nothing was saved: " + problems.slice(0, 5).join(" "), "VALIDATION_ERROR", { problems });
  await assertNotOwnPay(actor.userId, [...new Set(rows.map((r) => r.employeeId))], "These entries");
  return writeEntries(input.cycleStart, rows, input.reason, actor, { what: "Monthly Inputs were entered" });
}

export const fillBlanksSchema = z.object({ cycleStart: z.iso.date(), head: z.string().min(1).max(64).optional(), reason: z.string().trim().min(NOTE_MIN, "Say why").max(200) }).strict();

/**
 * A director's deliberate "nothing for these people this month": every blank cell (of one pay head, or of all) is entered as 0, so the run can go ahead. It is the same
 * entry as typing 0 into each cell, with the same history; it never touches a cell that already has a figure.
 */
export async function fillBlanks(raw: unknown, actor: Actor): Promise<{ written: number; voidedConfirmation: boolean }> {
  const parsed = fillBlanksSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  await requireDirector(actor.userId, "enter Monthly Inputs");
  const month = await assertAcceptsFigures(input.cycleStart);
  if (input.head && !month.heads.some((h) => h.code === input.head)) throw new HttpError(400, `${input.head} is not a pay head that takes its value from Monthly Inputs and is active in ${month.label}.`, "VALIDATION_ERROR");
  const cycle = await cycleOfStart(input.cycleStart);
  const who = await peopleInMonth(cycle.start, cycle.end);
  const heads = month.heads.filter((h) => !input.head || h.code === input.head).map((h) => h.code);
  const blanks = missingInputs(who.ids, heads, currentCells(await ledger(input.cycleStart)));
  if (blanks.length === 0) return { written: 0, voidedConfirmation: false };
  await assertNotOwnPay(actor.userId, [...new Set(blanks.map((b) => b.employeeId))], "These entries");
  return writeEntries(input.cycleStart, blanks.map((b) => ({ employeeId: b.employeeId, head: b.head, amount: "0" })), input.reason, actor, { what: "Blank Monthly Inputs were entered as 0" });
}

// ── Confirmation by a second director ──

export const confirmationQuerySchema = z.object({ cycleStart: z.iso.date() }).strict();
export const requestSchema = z.object({ cycleStart: z.iso.date(), fingerprint: z.string().min(1).max(200), note: z.string().trim().max(200).optional() }).strict();
export const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), fingerprint: z.string().min(1).max(200), note: z.string().trim().max(200).optional() }).strict();

const fingerprintOf = (cycleStart: string, hash: string) => payrollHash({ t: "MONTHLY_INPUTS_CONFIRM", cycleStart, hash });

export interface ConfirmationPreview {
  month: MonthView;
  fingerprint: string;
  mode: "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY" | "NOT_SET";
  checkers: CheckerAvailability;
  warnings: string[];
}

export async function previewConfirmation(cycleStart: string, actorUserId: string): Promise<ConfirmationPreview> {
  await requireDirector(actorUserId, "confirm Monthly Inputs");
  const month = await monthView(cycleStart);
  const warnings: string[] = [];
  if (month.heads.length === 0) warnings.push("No pay head takes its value from Monthly Inputs yet, so there is nothing to confirm.");
  if (month.blank > 0) warnings.push(`${month.blank} ${month.blank === 1 ? "figure is" : "figures are"} still blank (${month.peopleWithBlanks} ${month.peopleWithBlanks === 1 ? "person" : "people"}). A payroll run for this month will not start until each is entered, even as 0.`);
  const mode: ConfirmationPreview["mode"] = (await choiceMode("MONTHLY_INPUTS")) ?? "NOT_SET";
  const live = await liveApproval("MONTHLY_INPUTS", cycleStart);
  const holders = await activeUsersHoldingPermission(adapterFor("MONTHLY_INPUTS").checkerPermission);
  const names = await namesOfUsers(holders.map((h) => h.userId));
  const checkers = mode === "DIRECTOR_AUTHORITY" ? ({ eligible: [], excluded: [], state: "SELF", message: "You can confirm this yourself. It takes effect at once, and the other director is told." } as CheckerAvailability) : availabilityFrom(holders.map((h) => ({ userId: h.userId, name: names.get(h.userId) ?? "Someone" })), { makerUserId: live?.makerUserId ?? actorUserId });
  return { month, fingerprint: fingerprintOf(cycleStart, month.hash), mode, checkers, warnings };
}

export async function requestConfirmation(raw: unknown, actor: Actor) {
  const parsed = requestSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const { cycleStart, fingerprint, note } = parsed.data;
  await requireDirector(actor.userId, "confirm Monthly Inputs");
  const month = await monthView(cycleStart);
  if (month.state === "CLOSED" || month.state === "LOCKED") throw new HttpError(409, month.reason ?? "This month cannot be confirmed now.", month.state === "LOCKED" ? "MONTH_LOCKED" : "MONTH_CLOSED");
  if (month.heads.length === 0) throw new HttpError(409, "No pay head takes its value from Monthly Inputs, so there is nothing to confirm.", "NOTHING_TO_CONFIRM");
  if (fingerprintOf(cycleStart, month.hash) !== fingerprint) throw new HttpError(409, "The figures changed since you looked at them. Look at them again before you confirm.", "PREVIEW_STALE");
  const label = `the Monthly Inputs for ${month.label}`;
  const count = month.entered;
  if ((await authorityFor("MONTHLY_INPUTS")) === "DIRECTOR_AUTHORITY") {
    return authorise({ subject: "MONTHLY_INPUTS", subjectId: cycleStart, actorUserId: actor.userId, previewFingerprint: fingerprint, step: "MONTHLY_INPUTS", subjectLabel: label, itemCount: count, ...(note ? { note } : {}), ip: actor.ip ?? null });
  }
  return submit({ subject: "MONTHLY_INPUTS", subjectId: cycleStart, makerUserId: actor.userId, previewFingerprint: fingerprint, ...(note ? { note } : {}), ip: actor.ip ?? null, notify: { step: "MONTHLY_INPUTS", subjectLabel: label, itemCount: count } });
}

export async function decideConfirmation(cycleStart: string, raw: unknown, checker: Actor) {
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const input = parsed.data;
  const approval = await liveApproval("MONTHLY_INPUTS", cycleStart);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision for this month.", "NOT_PENDING");
  const hash = await hashOfMonth(cycleStart);
  if (fingerprintOf(cycleStart, hash) !== input.fingerprint) throw new HttpError(409, "What you were looking at is not what is there now. Look at it again before you decide.", "PREVIEW_STALE");
  return decide({ approvalId: approval.id, checkerUserId: checker.userId, decision: input.decision, ...(input.note !== undefined ? { note: input.note } : {}), ip: checker.ip ?? null, expectedHash: hash });
}

// ── The run: what it needs, and what it uses ──

export interface RunInputsCheck {
  missing: Array<MissingInput & { employeeCode: string; name: string; headName: string }>;
  notConfirmed: boolean;
  heads: Head[];
}

/** What a payroll run for the month still needs from Monthly Inputs. Empty when no head is flagged, or when every figure is entered and confirmed. */
export async function checkForRun(cycleStart: string, employeeIds: readonly string[]): Promise<RunInputsCheck> {
  const cycle = await cycleOfStart(cycleStart);
  const heads = await inputHeads(cycle.end);
  if (heads.length === 0) return { missing: [], notConfirmed: false, heads };
  const cells = await currentFigures(cycleStart);
  const gaps = missingInputs(employeeIds, heads.map((h) => h.code), cells);
  const approval = await prisma.payrollApproval.findFirst({ where: { subject: "MONTHLY_INPUTS", subjectId: cycleStart, status: { in: ["APPROVED", "CONSUMED"] } }, orderBy: { submittedAt: "desc" } });
  const notConfirmed = !(approval && approval.hashAtDecision === inputsHash(cycleStart, cells));
  const emps = await prisma.employee.findMany({ where: { id: { in: [...new Set(gaps.map((g) => g.employeeId))] } }, select: { id: true, employeeCode: true } });
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const names = await namesOn([...code.keys()], cycle.end);
  const headName = new Map(heads.map((h) => [h.code, h.name]));
  return { missing: gaps.map((g) => ({ ...g, employeeCode: code.get(g.employeeId) ?? g.employeeId, name: names.get(g.employeeId) ?? g.employeeId, headName: headName.get(g.head) ?? g.head })), notConfirmed, heads };
}

/** The sentence a refused run shows. Names each missing figure (the first few in full, then a count). */
export function refusalText(check: RunInputsCheck, label: string): string {
  const parts: string[] = [];
  if (check.missing.length > 0) {
    const shown = check.missing.slice(0, 10).map((m) => `${m.name} (${m.employeeCode}): ${m.headName}`);
    parts.push(`Monthly Inputs for ${label} are missing ${check.missing.length} ${check.missing.length === 1 ? "figure" : "figures"}: ${shown.join("; ")}${check.missing.length > shown.length ? `; and ${check.missing.length - shown.length} more` : ""}.`);
  }
  if (check.notConfirmed) parts.push(`The Monthly Inputs for ${label} have not been confirmed by a director.`);
  return parts.join(" ");
}

export async function assertReadyForRun(cycleStart: string, employeeIds: readonly string[], label: string): Promise<void> {
  const check = await checkForRun(cycleStart, employeeIds);
  if (check.missing.length === 0 && !check.notConfirmed) return;
  throw new HttpError(409, refusalText(check, label), "MONTHLY_INPUTS_MISSING", { missing: check.missing.slice(0, PAGE_SIZE_MAX), missingCount: check.missing.length, notConfirmed: check.notConfirmed });
}

/** One entry of the figures a run uses for the month (the run turns each into a line). */
export async function figuresForRun(cycleStart: string, employeeIds: readonly string[]): Promise<Map<string, Array<{ head: Head; amount: string; entryId: string }>>> {
  const cycle = await cycleOfStart(cycleStart);
  const heads = new Map((await inputHeads(cycle.end)).map((h) => [h.code, h]));
  const rows = await ledger(cycleStart);
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) latest.set(`${r.employeeId}|${r.head}`, r);
  const wanted = new Set(employeeIds);
  const out = new Map<string, Array<{ head: Head; amount: string; entryId: string }>>();
  for (const r of latest.values()) {
    const head = heads.get(r.head);
    if (!head || !wanted.has(r.employeeId) || r.cleared || r.amount === null) continue;
    out.set(r.employeeId, [...(out.get(r.employeeId) ?? []), { head, amount: r.amount, entryId: r.id }]);
  }
  for (const list of out.values()) list.sort((a, b) => (a.head.code < b.head.code ? -1 : 1));
  return out;
}

registerSubject({
  subject: "MONTHLY_INPUTS",
  makerPermission: "payroll.salary.edit",
  checkerPermission: "payroll.approve",
  async describe(subjectId) {
    return `the Monthly Inputs for the month starting ${subjectId}`;
  },
  hash: (subjectId) => hashOfMonth(subjectId),
  async affectedUserIds(subjectId) {
    const cycle = await cycleOfStart(subjectId);
    const own = await prisma.payrollMonthlyInput.findMany({ where: { cycleStart: cycle.start }, select: { employeeId: true }, distinct: ["employeeId"] });
    return userIdsOfEmployees(own.map((r) => r.employeeId));
  },
});

export { employeeIdOfUser };
