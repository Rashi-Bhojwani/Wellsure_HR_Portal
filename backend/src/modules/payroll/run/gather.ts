import type { EmploymentType, PayrollItemKind } from "@prisma/client";
import type { ComponentType } from "@shared/constants/payrollSalary";
import { addCalendarDays, businessDateOf } from "../../../lib/businessDate";
import { bankAccountsOn, employedBetween, employmentSpan, finalisedAttendanceDays, payrollPlacementsOn, salariesOn, salarySegmentsMany, unfinalisedAttendanceDays, type PayrollPlacement, type SalaryWithLines } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { committedEncashments } from "../../leave/payrollReader";
import { payrollHash } from "../hash";
import { ZERO, canonicalDecimal, dec, sum, type Money } from "../money";
import type { RuleContext, RulePin } from "../rules/context";
import type { ComponentValue } from "../salary/schemas";
import { iso } from "./days";
import { loadOverrideItems, resolveOverrides } from "../rules/overrides";
import type { RuleNeeds } from "./rules";
import { contributionPeriodStart } from "./statutory";
import { figuresForRun } from "../inputs/service";
import { skippedOn } from "../exclusions/service";
import type { AdjustmentIn, ComponentLookup, CycleSpan, PersonInput, SegmentInput } from "./types";

// Everything a payroll run reads, gathered through the readers and nothing else (docs/plans/PHASE_6.md §14D):
//   people            Employee (joining, leaving, type) and employedBetween: never `status`
//   attendance        finalisedAttendanceDays: only LOCKED days exist for payroll
//   salary            salarySegmentsMany / salariesOn: the frozen breakup, as it was on each day
//   placement, bank   payrollPlacementsOn, bankAccountsOn: the state and the account on the day that matters
//   adjustments       pending adjustments, arrears, and committed year-end encashments (via the leave module's reader)
// It also records the pins of what it reads, so the run can be judged on the structure, components and rounding each salary was frozen under.

export interface RunInputs {
  cycle: CycleSpan;
  payrollMonth: number;
  payrollYear: number;
  paymentDate: Date | null;
  /** People a director marked as not on payroll (confirmed by a different director) for this cycle: not calculated, named here. */
  skipped: Array<{ employeeId: string; employeeCode: string; reason: string }>;
  people: PersonInput[];
  components: ComponentLookup;
  needs: RuleNeeds;
  /** Component versions that exist, with their value hash, for pinning. */
  componentHashes: ReadonlyMap<string, string>;
  /** Committed year-end items skipped because the payout rule says another cycle pays them, for the readiness list. */
  encashmentsNotThisCycle: Array<{ itemId: string; employeeId: string; amount: string }>;
}

const MAX_CODES = 400;

export function paymentDateFor(cycleEnd: Date, rule: { monthOffset: 0 | 1; day: number | "LAST" }): Date {
  const y = cycleEnd.getUTCFullYear();
  const m = cycleEnd.getUTCMonth() + rule.monthOffset;
  return rule.day === "LAST" ? new Date(Date.UTC(y, m + 1, 0)) : new Date(Date.UTC(y, m, rule.day));
}

function clip(seg: { from: Date; to: Date }, span: { from: Date; to: Date }): { from: Date; to: Date } | null {
  const from = seg.from > span.from ? seg.from : span.from;
  const to = seg.to < span.to ? seg.to : span.to;
  return from > to ? null : { from, to };
}

/** The per-head amounts an adjustment carries: an arrears row stores an array; a loss-of-pay reversal stores them under `lines`, beside the days it covers. */
function breakdownOf(a: { source: string; breakdown: unknown }): Array<{ component: string; amount: Money }> {
  const raw = a.source === "LOP_REVERSAL" ? ((a.breakdown as { lines?: unknown } | null)?.lines ?? []) : (a.breakdown ?? []);
  return (raw as Array<{ component: string; amount: string }>).map((p) => ({ component: p.component, amount: dec(p.amount) }));
}

export async function gatherRunInputs(cycle: CycleSpan, ctx: RuleContext): Promise<RunInputs> {
  const everyone = await prisma.employee.findMany({
    where: employedBetween(cycle.start, cycle.end),
    select: { id: true, employeeCode: true, employmentType: true, dateOfJoining: true, lastWorkingDate: true },
    orderBy: { employeeCode: "asc" },
  });
  // A person a director has marked as not on payroll (and a different director confirmed) on the cycle's last day is not calculated; the run names them in its skipped list.
  const notOnPayroll = await skippedOn(everyone.map((e) => e.id), cycle.end);
  const employees = everyone.filter((e) => !notOnPayroll.has(e.id));
  const skipped = everyone.filter((e) => notOnPayroll.has(e.id)).map((e) => ({ employeeId: e.id, employeeCode: e.employeeCode, reason: notOnPayroll.get(e.id)! }));
  const ids = employees.map((e) => e.id);
  const payrollMonth = cycle.end.getUTCMonth() + 1;
  const payrollYear = cycle.end.getUTCFullYear();

  const paymentRule = ctx.peek<{ monthOffset: 0 | 1; day: number | "LAST" }>("PAYMENT_DATE_RULE");
  const paymentDate = paymentRule ? paymentDateFor(cycle.end, paymentRule) : null;
  const stateRule = ctx.peek<"LAST_DAY_OF_PERIOD" | "FIRST_DAY_OF_PERIOD">("PT_STATE_OF_PLACEMENT");
  const sticky = ctx.peek<string>("ESI_PERIOD_RULE") === "STICKY_HALF_YEAR";
  const payoutRule = ctx.peek<"FIRST_RUN_AFTER_COMMIT" | "SAME_MONTH_AS_COMMIT">("ENCASH_PAYOUT_RULE");

  const [attendance, missing, segmentsByEmployee, bank, pendingAdjustments, committed] = await Promise.all([
    finalisedAttendanceDays(ids, cycle.start, cycle.end),
    unfinalisedAttendanceDays(employees, cycle.start, cycle.end),
    salarySegmentsMany(ids, cycle.start, cycle.end),
    paymentDate ? bankAccountsOn(ids, paymentDate) : Promise.resolve(new Map()),
    prisma.payrollAdjustment.findMany({ where: { employeeId: { in: ids }, status: "PENDING", source: { not: "YEAR_END_ENCASHMENT" } }, orderBy: [{ employeeId: "asc" }, { createdAt: "asc" }, { id: "asc" }] }),
    committedEncashments(ids),
  ]);

  // The state decides PT and LWF: taken on the first or last day of the person's paid span, per the rule.
  const placementDayOf = (span: { from: Date; to: Date }) => (stateRule === "FIRST_DAY_OF_PERIOD" ? span.from : span.to);
  const spans = new Map(employees.map((e) => [e.id, employmentSpan(e, cycle.start, cycle.end)!]));
  const idsByDay = new Map<string, string[]>();
  for (const e of employees) {
    const k = iso(placementDayOf(spans.get(e.id)!));
    idsByDay.set(k, [...(idsByDay.get(k) ?? []), e.id]);
  }
  const holdRows = await prisma.payrollSalaryHold.findMany({ where: { cycleStart: cycle.start, release: null, employeeId: { in: employees.map((e) => e.id) } }, select: { employeeId: true, reason: true } });
  const holdBy = new Map(holdRows.map((h) => [h.employeeId, h.reason]));
  const overrideItems = await loadOverrideItems();
  const placements = new Map<string, PayrollPlacement>();
  for (const [day, group] of idsByDay) for (const [id, p] of await payrollPlacementsOn(group, new Date(`${day}T00:00:00Z`))) placements.set(id, p);

  // Year-end encashments that this cycle pays, with the adjustment row that already stands for each (if any).
  const existingEncash = await prisma.payrollAdjustment.findMany({ where: { source: "YEAR_END_ENCASHMENT", sourceRef: { in: committed.map((c) => c.itemId) } } });
  const encashRow = new Map(existingEncash.map((r) => [r.sourceRef!, r]));
  const encashmentsNotThisCycle: RunInputs["encashmentsNotThisCycle"] = [];
  const encashmentsByEmployee = new Map<string, AdjustmentIn[]>();
  for (const item of committed) {
    const row = encashRow.get(item.itemId);
    if (row && row.status !== "PENDING") continue; // already paid, or cancelled
    const committedOn = businessDateOf(item.committedAt);
    const due = payoutRule === "FIRST_RUN_AFTER_COMMIT" ? committedOn < cycle.start : committedOn <= cycle.end;
    if (!due) {
      encashmentsNotThisCycle.push({ itemId: item.itemId, employeeId: item.employeeId, amount: item.amount });
      continue;
    }
    const list = encashmentsByEmployee.get(item.employeeId) ?? [];
    list.push({ id: row?.id ?? null, source: "YEAR_END_ENCASHMENT", sourceRef: item.itemId, componentCode: "LEAVE_ENCASHMENT", direction: "EARNING", amount: dec(item.amount), reason: `Year-end ${item.leaveYear} leave encashment: ${item.days} day(s) at ${item.dailyRate} (${item.rateSource})` });
    encashmentsByEmployee.set(item.employeeId, list);
  }

  // Salary rows for the ESI half-year test (only under the half-year rule): the salary on the first day of the contribution period, or the joining day if later.
  const startOfPeriod = contributionPeriodStart(payrollYear, payrollMonth);
  const periodStart = new Date(Date.UTC(startOfPeriod.year, startOfPeriod.month - 1, 1));
  const periodRows = new Map<string, SalaryWithLines>();
  if (sticky) {
    const byDay = new Map<string, string[]>();
    for (const e of employees) {
      const day = e.dateOfJoining > periodStart ? e.dateOfJoining : periodStart;
      byDay.set(iso(day), [...(byDay.get(iso(day)) ?? []), e.id]);
    }
    for (const [day, group] of byDay) for (const [id, row] of await salariesOn(group, new Date(`${day}T00:00:00Z`))) periodRows.set(id, row);
  }

  // The figures a director entered in Monthly Inputs for this month: each is a line of the run, by the same path as an adjustment. They are read, never consumed:
  // a month's figures belong to the month, and a run for it that is unlocked reads them again.
  const monthly = await figuresForRun(iso(cycle.start), ids);

  // Every component version any of this is built from, with its flags: the exact version each salary line was frozen under, and the newest for adjustments.
  const codes = new Set<string>();
  for (const segs of segmentsByEmployee.values()) for (const s of segs) for (const l of s.row.lines) codes.add(l.componentCode);
  for (const row of periodRows.values()) for (const l of row.lines) codes.add(l.componentCode);
  for (const a of pendingAdjustments) {
    codes.add(a.componentCode);
    for (const part of breakdownOf(a)) codes.add(part.component);
  }
  for (const list of monthly.values()) for (const f of list) codes.add(f.head.code);
  if (codes.size > MAX_CODES) throw new Error("A run reads more salary components than any structure could hold");
  const loadVersions = (keys: Iterable<string>) => prisma.payrollItemVersion.findMany({ where: { kind: "COMPONENT" as PayrollItemKind, key: { in: [...keys] } }, orderBy: [{ key: "asc" }, { version: "asc" }] });
  let versionRows = codes.size ? await loadVersions(codes) : [];
  // A loss-of-pay reversal line is carried under its head's reversal head, so the heads a reversal names are read as well.
  const reversalCodes = new Set<string>();
  for (const a of pendingAdjustments) {
    if (a.source !== "LOP_REVERSAL") continue;
    for (const part of breakdownOf(a)) {
      const latest = versionRows.filter((v) => v.key === part.component).at(-1);
      const link = (latest?.value as { reversalHead?: string } | undefined)?.reversalHead;
      if (link && !codes.has(link)) reversalCodes.add(link);
    }
  }
  if (reversalCodes.size) {
    for (const c of reversalCodes) codes.add(c);
    versionRows = await loadVersions(codes);
  }
  const byVersion = new Map<string, ComponentValue>();
  const componentHashes = new Map<string, string>();
  const current = new Map<string, { version: number; value: ComponentValue }>();
  for (const v of versionRows) {
    byVersion.set(`${v.key}@${v.version}`, v.value as unknown as ComponentValue);
    componentHashes.set(`${v.key}@${v.version}`, v.valueHash);
    current.set(v.key, { version: v.version, value: v.value as unknown as ComponentValue });
  }
  const components: ComponentLookup = { byVersion, current };

  // Pins: what each salary was frozen under (not re-read, so never stale) and the component versions adjustments read live.
  const pinned = new Set<string>();
  const frozen = (pin: Required<Pick<RulePin, "kind" | "key" | "version" | "valueHash">>) => {
    const k = `${pin.kind}|${pin.key}|${pin.version}`;
    if (!pinned.has(k)) {
      pinned.add(k);
      ctx.addFrozenPin(pin);
    }
  };
  for (const segs of segmentsByEmployee.values()) {
    for (const s of segs) {
      frozen({ kind: "STRUCTURE", key: s.row.structureKey, version: s.row.structureVersion, valueHash: s.row.structureHash });
      const rp = s.row.roundingPin as unknown as RulePin | null;
      if (rp) frozen({ kind: "RULE", key: rp.key, version: rp.version, valueHash: rp.valueHash });
      for (const l of s.row.lines) {
        const h = componentHashes.get(`${l.componentCode}@${l.componentVersion}`);
        if (h) frozen({ kind: "COMPONENT", key: l.componentCode, version: l.componentVersion, valueHash: h });
      }
    }
  }
  const usedByAdjustments = new Set([...pendingAdjustments.map((a) => a.componentCode), ...[...monthly.values()].flatMap((l) => l.map((f) => f.head.code))]);
  for (const code of usedByAdjustments) {
    const cur = current.get(code);
    const h = cur ? componentHashes.get(`${code}@${cur.version}`) : undefined;
    if (cur && h) ctx.addLivePin({ kind: "COMPONENT", key: code, version: cur.version, valueHash: h });
  }

  const people: PersonInput[] = [];
  let arrears = false;
  let encashment = false;
  let reversals = false;
  for (const e of employees) {
    const span = spans.get(e.id)!;
    const segments: SegmentInput[] = [];
    for (const s of segmentsByEmployee.get(e.id) ?? []) {
      const c = clip(s, span);
      if (!c) continue;
      segments.push({
        ...c,
        salaryId: s.row.id,
        structureKey: s.row.structureKey,
        structureVersion: s.row.structureVersion,
        structureHash: s.row.structureHash,
        roundingPin: (s.row.roundingPin as unknown as RulePin | null) ?? null,
        lines: s.row.lines.map((l) => ({ component: l.componentCode, version: l.componentVersion, type: l.componentType as ComponentType, amount: dec(l.amount.toString()), order: l.sortOrder })),
      });
    }
    const gaps: string[] = [];
    for (let d = span.from; d <= span.to; d = addCalendarDays(d, 1)) if (!segments.some((s) => s.from <= d && d <= s.to)) gaps.push(iso(d));

    const adjustments: AdjustmentIn[] = pendingAdjustments
      .filter((a) => a.employeeId === e.id)
      .map((a) => ({
        id: a.id,
        source: a.source,
        sourceRef: a.sourceRef,
        componentCode: a.componentCode,
        direction: a.direction,
        amount: dec(a.amount.toString()),
        reason: a.reason,
        periodLabel: a.periodStart ? `${iso(a.periodStart)} to ${iso(a.periodEnd ?? a.periodStart)}` : undefined,
        breakdown: breakdownOf(a),
      }));
    adjustments.push(...(encashmentsByEmployee.get(e.id) ?? []));
    for (const f of monthly.get(e.id) ?? []) {
      if (dec(f.amount).isZero()) continue; // a zero was entered (so the run may go ahead), and pays or takes nothing: there is no line to print
      adjustments.push({ id: null, source: "MONTHLY_INPUT", sourceRef: f.entryId, componentCode: f.head.code, direction: f.head.direction ?? f.head.type, amount: dec(f.amount), reason: "Entered in Monthly Inputs", periodLabel: cycle.label });
    }
    if (adjustments.some((a) => a.source === "SALARY_ARREARS" || a.source === "LOP_REVERSAL")) arrears = true; // a reversal follows the same PF and ESI rule
    if (adjustments.some((a) => a.source === "LOP_REVERSAL")) reversals = true;
    if (adjustments.some((a) => a.source === "YEAR_END_ENCASHMENT")) encashment = true;

    const pr = periodRows.get(e.id);
    const esiPeriodStartEntitlement = sticky && pr ? sum(pr.lines.filter((l) => l.componentType === "EARNING" && byVersion.get(`${l.componentCode}@${l.componentVersion}`)?.esiApplicable).map((l) => dec(l.amount.toString()))) : sticky ? ZERO : null;

    people.push({
      employeeId: e.id,
      employeeCode: e.employeeCode,
      employmentType: e.employmentType as EmploymentType,
      dateOfJoining: e.dateOfJoining,
      lastWorkingDate: e.lastWorkingDate,
      span,
      days: (attendance.get(e.id) ?? []).map((d) => ({ date: d.date, status: d.status, lopDays: dec(d.lopDays.toString()) })),
      missingDays: missing.get(e.id) ?? [],
      segments,
      salaryGapDays: gaps,
      placement: placements.get(e.id) ?? null,
      placementDay: placementDayOf(span),
      hasBankAccount: paymentDate ? bank.has(e.id) : true,
      ruleOverrides: [...resolveOverrides(overrideItems, { employeeId: e.id, departmentId: placements.get(e.id)?.departmentId ?? null }, iso(cycle.end)).values()].map((o) => ({ ruleKey: o.ruleKey, level: o.level, itemKey: o.itemKey, version: o.version, valueHash: o.valueHash, value: o.value, registrationRef: o.registrationRef })),
      directorHold: holdBy.has(e.id) ? { reason: holdBy.get(e.id)! } : null,
      adjustments,
      esiPeriodStartEntitlement,
    });
  }
  // Every override a person was calculated under is pinned live: a run that used a Placeholder override is a test run, and editing an override makes the run stale.
  const usedOverrides = new Map<string, { itemKey: string; version: number; valueHash: string }>();
  for (const p of people) for (const o of p.ruleOverrides ?? []) usedOverrides.set(`${o.itemKey}|${o.version}`, o);
  for (const o of usedOverrides.values()) ctx.addLivePin({ kind: "RULE_OVERRIDE", key: o.itemKey, version: o.version, valueHash: o.valueHash });
  return { cycle, payrollMonth, payrollYear, paymentDate, skipped, people, components, needs: { arrears, encashment, reversals }, componentHashes, encashmentsNotThisCycle };
}

/** A fingerprint of everything gathered, so a resumed or repeated calculation can tell whether the world moved, and a confirm can tell that what was previewed is still true. */
export function inputsFingerprint(inputs: RunInputs): string {
  return payrollHash({
    cycle: [iso(inputs.cycle.start), iso(inputs.cycle.end)],
    payment: inputs.paymentDate ? iso(inputs.paymentDate) : null,
    components: [...inputs.componentHashes].sort((a, b) => a[0].localeCompare(b[0])),
    people: inputs.people.map((p) => ({
      e: p.employeeId,
      type: p.employmentType,
      span: [iso(p.span.from), iso(p.span.to)],
      days: p.days.map((d) => [iso(d.date), d.status, canonicalDecimal(d.lopDays)]),
      missing: p.missingDays,
      gaps: p.salaryGapDays,
      segments: p.segments.map((s) => [s.salaryId, iso(s.from), iso(s.to), s.structureHash]),
      placement: p.placement ? [p.placement.locationId, p.placement.locationState, p.placement.departmentId, p.placement.gradeId, p.placement.costCentreId] : null,
      bank: p.hasBankAccount,
      ...(p.directorHold ? { held: true } : {}),
      ...(p.ruleOverrides && p.ruleOverrides.length > 0 ? { overrides: p.ruleOverrides.map((o) => [o.itemKey, o.version, o.valueHash]) } : {}),
      adjustments: p.adjustments.map((a) => [a.id, a.source, a.sourceRef, a.componentCode, a.direction, canonicalDecimal(a.amount)]),
      esi: p.esiPeriodStartEntitlement ? canonicalDecimal(p.esiPeriodStartEntitlement) : null,
    })),
  });
}

/** The money an adjustment adds, signed, for the run totals shown before a calculation. */
export const signedAmount = (a: AdjustmentIn): Money => (a.direction === "EARNING" ? a.amount : a.amount.negated());
