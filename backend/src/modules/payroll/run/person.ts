import { HOLD_REASON_LABEL, STATUTORY_LINE_CODES, STATUTORY_LINE_LABEL, type HoldReason } from "@shared/constants/payrollRun";
import { ARREARS_CODE, HOLD_RELEASE_CODE, LOP_REVERSAL_CODE } from "@shared/constants/payrollSalary";
import { payrollHash } from "../hash";
import { ZERO, canonicalDecimal, intDec, sum, type Money } from "../money";
import { applyShare } from "../salary/arrears";
import type { ComponentValue } from "../salary/schemas";
import { computeDayFigures, countDays, iso, segmentFactor, type DayFigures } from "./days";
import { computeEsi, computeLwf, computePf, computePt, resolveState, roundByRule } from "./statutory";
import type { AdjustmentIn, CalcContext, ExceptionOut, ItemOut, LineOut, PersonInput } from "./types";

// One person's pay for one cycle (docs/plans/PHASE_6.md §14D). A pure function of what was gathered and the rules: the same inputs always give the same lines and
// the same hash, and every line carries the basis it was worked out from. Nothing here reads the database, the clock or a rate written in code.

const c = canonicalDecimal;

interface Acc {
  code: string;
  type: ComponentValue["type"];
  label: string;
  order: number;
  prorates: boolean;
  pf: boolean;
  esi: boolean;
  /** Sum of amount x segment numerator: divided once, by the person's common denominator, at the end. */
  numerator: Money;
  fixedAmount: Money | null;
  parts: Array<Record<string, unknown>>;
}

function excluded(input: PersonInput, reason: HoldReason, detail: string, inputs: Record<string, unknown>, figures?: DayFigures): ItemOut {
  const base = {
    employeeId: input.employeeId,
    status: "EXCLUDED" as const,
    holdReason: reason,
    holdDetail: detail,
    employedFrom: input.span.from,
    employedTo: input.span.to,
    basisDays: figures?.basisDays ?? ZERO,
    lopDivisorDays: figures?.lopDivisorDays ?? ZERO,
    lopDays: figures?.lopDays ?? ZERO,
    paidDays: ZERO,
    gross: ZERO,
    deductions: ZERO,
    employerContributions: ZERO,
    netBeforeRounding: ZERO,
    roundingAdjustment: ZERO,
    netPay: ZERO,
    employmentType: input.employmentType,
    placement: {},
    structureKey: input.segments.at(-1)?.structureKey ?? null,
    structureVersion: input.segments.at(-1)?.structureVersion ?? null,
    lines: [],
    inputs,
    notices: [],
    exceptions: [],
  };
  return { ...base, itemHash: payrollHash({ e: input.employeeId, s: base.status, r: reason, i: inputs }) };
}

const listDates = (dates: readonly string[]) => (dates.length <= 5 ? dates.join(", ") : `${dates.slice(0, 5).join(", ")} and ${dates.length - 5} more`);

export function calculatePerson(input: PersonInput, ctx: CalcContext): ItemOut {
  const { rules } = ctx;
  const digest = payrollHash(input.days.map((d) => [iso(d.date), d.status, c(d.lopDays)]));
  const baseInputs: Record<string, unknown> = {
    cycle: { start: iso(ctx.cycle.start), end: iso(ctx.cycle.end), label: ctx.cycle.label },
    employedFrom: iso(input.span.from),
    employedTo: iso(input.span.to),
    attendanceDigest: digest,
    employmentType: input.employmentType,
  };

  if (input.missingDays.length > 0) {
    return excluded(input, "ATTENDANCE_NOT_FINAL", `Attendance is not finalised for ${input.missingDays.length} of their days (${listDates(input.missingDays)}). Payroll pays only for finalised days.`, { ...baseInputs, missingDays: input.missingDays });
  }
  if (input.salaryGapDays.length > 0) {
    return excluded(input, "NO_SALARY", `No salary is on record for ${input.salaryGapDays.length} of the days they were employed (${listDates(input.salaryGapDays)}). They are not paid until it is set, and never paid zero silently.`, { ...baseInputs, salaryGapDays: input.salaryGapDays });
  }

  const figures = computeDayFigures({ cycle: ctx.cycle, span: input.span, days: input.days, basis: rules.payDaysBasis, lopDivisor: rules.lopDivisor, fixedDays: rules.fixedDays });
  if (figures.hold) return excluded(input, figures.hold.reason, figures.hold.detail, baseInputs, figures);

  const exceptions: ExceptionOut[] = [];
  const notices: string[] = [];
  if (figures.lopExceedsDays) {
    exceptions.push({ code: "LOP_EXCEEDS_DAYS", severity: "BLOCKING", message: `Loss of pay (${c(figures.lopDays)} days) is more than the ${figures.employedDays} days they were employed.` });
  }

  // ── Component lines: each salary segment, pro-rated by its own factor, summed, rounded once ──
  const segmentsOut: Array<Record<string, unknown>> = [];
  const acc = new Map<string, Acc>();
  let commonDen = intDec(1); // every segment of one person has the same denominator, so their numerators add exactly
  for (const seg of input.segments) {
    const sf = segmentFactor(figures, seg, input.days);
    commonDen = sf.den;
    segmentsOut.push({ from: iso(seg.from), to: iso(seg.to), days: sf.days, lop: c(sf.lop), factor: c(sf.factor), factorNum: c(sf.num), factorDen: c(sf.den), salaryId: seg.salaryId, structure: `${seg.structureKey} v${seg.structureVersion}` });
    for (const line of seg.lines) {
      const flags = ctx.components.byVersion.get(`${line.component}@${line.version}`);
      if (!flags) throw new Error(`The component ${line.component} version ${line.version} is not on record, so ${input.employeeCode}'s salary cannot be calculated`);
      const a = acc.get(line.component) ?? { code: line.component, type: flags.type, label: flags.payslipLabel, order: flags.payslipOrder, prorates: flags.prorates, pf: flags.pfApplicable, esi: flags.esiApplicable, numerator: ZERO, fixedAmount: null, parts: [] };
      // The latest segment's version of a component names it on the payslip.
      a.type = flags.type;
      a.label = flags.payslipLabel;
      a.order = flags.payslipOrder;
      a.prorates = flags.prorates;
      a.pf = flags.pfApplicable;
      a.esi = flags.esiApplicable;
      if (flags.prorates) a.numerator = a.numerator.plus(line.amount.times(sf.num));
      else if (applyShare(line.amount, false, { paid: sf.num, basis: sf.den }).greaterThan(ZERO)) a.fixedAmount = line.amount; // pays in full, from the last segment that was paid at all
      a.parts.push({ from: iso(seg.from), to: iso(seg.to), monthly: c(line.amount), factor: c(sf.factor), version: line.version });
      acc.set(line.component, a);
    }
  }

  const earningLines: LineOut[] = [];
  const deductionLines: LineOut[] = [];
  const employerLines: LineOut[] = [];
  let pfWages = ZERO;
  let esiWages = ZERO;
  const comps = [...acc.values()].sort((x, y) => x.order - y.order || x.code.localeCompare(y.code));
  for (const a of comps) {
    const raw = a.prorates ? a.numerator.dividedBy(commonDen) : (a.fixedAmount ?? ZERO);
    const lineRule = rules.headRounding[a.code] ?? rules.lineRounding;
    const amount = roundByRule(raw, lineRule, a.label);
    const line: LineOut = {
      code: a.code,
      label: a.label,
      kind: a.type,
      source: "COMPONENT",
      sourceRef: null,
      amount,
      basis: { prorates: a.prorates, parts: a.parts, unrounded: c(raw), rounding: lineRule, pfApplicable: a.pf, esiApplicable: a.esi },
    };
    if (a.type === "EARNING") {
      earningLines.push(line);
      if (a.pf) pfWages = pfWages.plus(amount);
      if (a.esi) esiWages = esiWages.plus(amount);
    } else if (a.type === "DEDUCTION") deductionLines.push(line);
    else employerLines.push(line);
  }

  // ── Adjustments, arrears and year-end encashment: each a line of its own, carrying where it came from ──
  let adjustmentPf = ZERO;
  for (const adj of input.adjustments) {
    if (adj.source === "LOP_REVERSAL") {
      const rev = reversalLines(adj, ctx);
      for (const l of rev.lines) (l.kind === "EARNING" ? earningLines : deductionLines).push(l);
      if (adj.direction === "EARNING") {
        pfWages = pfWages.plus(rev.pf);
        esiWages = esiWages.plus(rev.esi);
        adjustmentPf = adjustmentPf.plus(rev.pf);
      }
      notices.push(...rev.notices);
      continue;
    }
    const line = adjustmentLine(adj, ctx);
    if (adj.direction === "EARNING") earningLines.push(line.line);
    else deductionLines.push(line.line);
    if (adj.direction === "EARNING") {
      pfWages = pfWages.plus(line.pf);
      esiWages = esiWages.plus(line.esi);
      adjustmentPf = adjustmentPf.plus(line.pf);
    }
    notices.push(...line.notices);
  }

  const grossBeforeStatutory = sum(earningLines.map((l) => l.amount));

  // ── PF ──
  const inputsOut: Record<string, unknown> = { ...baseInputs };
  const statutoryDeductions: LineOut[] = [];
  const pfCovered = rules.pf.eligibleTypes.includes(input.employmentType);
  if (!pfCovered) notices.push(`Provident fund does not apply to ${input.employmentType.toLowerCase()} staff under the rule "PF: employment types covered".`);
  const pf = pfCovered ? computePf(pfWages, rules) : null;
  if (pf && pf.cappedWages.greaterThan(ZERO)) {
    const basis = { wages: c(pf.wages), cappedWages: c(pf.cappedWages), ceilingMode: rules.pf.ceilingMode, ceiling: c(rules.pf.ceiling), rounding: rules.pfRounding };
    if (pf.employee.greaterThan(ZERO)) statutoryDeductions.push({ code: STATUTORY_LINE_CODES.PF_EMPLOYEE, label: STATUTORY_LINE_LABEL.PF_EMPLOYEE!, kind: "DEDUCTION", source: "PF", sourceRef: null, amount: pf.employee, basis: { ...basis, rate: c(rules.pf.employeeRate) } });
    const employer: Array<[string, Money, Money]> = [
      [STATUTORY_LINE_CODES.PF_EPS, pf.eps, rules.pf.epsRate],
      [STATUTORY_LINE_CODES.PF_EPF_ER, pf.epfEr, rules.pf.epfErRate],
      [STATUTORY_LINE_CODES.PF_EDLI, pf.edli, rules.pf.edliRate],
      [STATUTORY_LINE_CODES.PF_ADMIN, pf.admin, rules.pf.adminRate],
    ];
    for (const [code, amount, rate] of employer) {
      if (amount.greaterThan(ZERO)) employerLines.push({ code, label: STATUTORY_LINE_LABEL[code]!, kind: "EMPLOYER_CONTRIBUTION", source: "PF", sourceRef: null, amount, basis: { ...basis, rate: c(rate) } });
    }
  }
  inputsOut.pf = pf ? { covered: true, wages: c(pf.wages), cappedWages: c(pf.cappedWages), adjustmentWages: c(adjustmentPf) } : { covered: false };

  // ── ESI: coverage on the full-month entitlement (so a few days of loss of pay do not change who is covered), contribution on what was earned ──
  const esiCovered = rules.esi.eligibleTypes.includes(input.employmentType);
  let entitlement: Money | null = null;
  if (esiCovered) {
    if (rules.esi.periodRule === "STICKY_HALF_YEAR") entitlement = input.esiPeriodStartEntitlement;
    else {
      const last = input.segments.at(-1);
      entitlement = last ? sum(last.lines.filter((l) => l.type === "EARNING" && ctx.components.byVersion.get(`${l.component}@${l.version}`)?.esiApplicable).map((l) => l.amount)) : ZERO;
    }
  }
  const esiInCover = esiCovered && entitlement !== null && entitlement.greaterThan(ZERO) && entitlement.lessThanOrEqualTo(rules.esi.ceiling);
  if (!esiCovered) notices.push(`ESI does not apply to ${input.employmentType.toLowerCase()} staff under the rule "ESI: employment types covered".`);
  else if (!esiInCover) notices.push(`ESI does not apply: their ESI wages for the month (${entitlement ? c(entitlement) : "none"}) are ${entitlement && entitlement.greaterThan(rules.esi.ceiling) ? "above" : "not within"} the ESI ceiling of ${c(rules.esi.ceiling)}.`);
  const esi = esiInCover ? computeEsi(esiWages, rules) : null;
  if (esi) {
    const basis = { wages: c(esi.wages), entitlement: c(entitlement!), ceiling: c(rules.esi.ceiling), periodRule: rules.esi.periodRule, rounding: rules.esiRounding };
    if (esi.employee.greaterThan(ZERO)) statutoryDeductions.push({ code: STATUTORY_LINE_CODES.ESI_EMPLOYEE, label: STATUTORY_LINE_LABEL.ESI_EMPLOYEE!, kind: "DEDUCTION", source: "ESI", sourceRef: null, amount: esi.employee, basis: { ...basis, rate: c(rules.esi.employeeRate) } });
    if (esi.employer.greaterThan(ZERO)) employerLines.push({ code: STATUTORY_LINE_CODES.ESI_EMPLOYER, label: STATUTORY_LINE_LABEL.ESI_EMPLOYER!, kind: "EMPLOYER_CONTRIBUTION", source: "ESI", sourceRef: null, amount: esi.employer, basis: { ...basis, rate: c(rules.esi.employerRate) } });
  }
  inputsOut.esi = esi ? { covered: true, wages: c(esi.wages), entitlement: c(entitlement!) } : { covered: false, entitlement: entitlement ? c(entitlement) : null };

  // ── PT and LWF, by the state of the branch they were placed in ──
  let stateKey: string | null = null;
  if (rules.ptSlabs || rules.lwfTable) {
    if (!input.placement) {
      exceptions.push({ code: "NO_PLACEMENT", severity: "BLOCKING", message: `They have no placement on ${iso(input.placementDay)}, so the state for professional tax and labour welfare fund is not known.` });
    } else {
      stateKey = resolveState(input.placement.locationState, rules.stateNameMap ?? {});
      if (!stateKey) {
        exceptions.push({ code: "STATE_UNMAPPED", severity: "BLOCKING", message: `Their branch's state is written "${input.placement.locationState}", which is not in the rule "State names". Add it so professional tax and labour welfare fund can be worked out.` });
      }
    }
  }
  inputsOut.state = { text: input.placement?.locationState ?? null, key: stateKey, onDay: iso(input.placementDay) };
  if (rules.ptSlabs && stateKey) {
    const pt = computePt(rules.ptSlabs, stateKey, grossBeforeStatutory, ctx.payrollMonth);
    if (!pt) notices.push(`Professional tax: the table has nothing for ${stateKey}, so none is charged.`);
    else if (pt.amount.greaterThan(ZERO)) {
      statutoryDeductions.push({ code: STATUTORY_LINE_CODES.PT, label: STATUTORY_LINE_LABEL.PT!, kind: "DEDUCTION", source: "PT", sourceRef: null, amount: pt.amount, basis: { state: stateKey, gross: c(grossBeforeStatutory), slab: pt.slab, monthOverride: pt.overridden, month: ctx.payrollMonth } });
    }
    inputsOut.pt = pt ? { amount: c(pt.amount), slab: pt.slab, overridden: pt.overridden } : { amount: "0", noTableFor: stateKey };
  }
  if (rules.lwfTable && stateKey) {
    const lwf = computeLwf(rules.lwfTable, stateKey, ctx.payrollMonth);
    if (!lwf) notices.push(`Labour welfare fund: the table has nothing for ${stateKey}, so none is charged.`);
    else {
      if (lwf.employee.greaterThan(ZERO)) statutoryDeductions.push({ code: STATUTORY_LINE_CODES.LWF_EMPLOYEE, label: STATUTORY_LINE_LABEL.LWF_EMPLOYEE!, kind: "DEDUCTION", source: "LWF", sourceRef: null, amount: lwf.employee, basis: { state: stateKey, month: ctx.payrollMonth } });
      if (lwf.employer.greaterThan(ZERO)) employerLines.push({ code: STATUTORY_LINE_CODES.LWF_EMPLOYER, label: STATUTORY_LINE_LABEL.LWF_EMPLOYER!, kind: "EMPLOYER_CONTRIBUTION", source: "LWF", sourceRef: null, amount: lwf.employer, basis: { state: stateKey, month: ctx.payrollMonth } });
    }
  }

  // ── Totals, net, rounding ──
  const lines: LineOut[] = [...earningLines, ...deductionLines, ...statutoryDeductions, ...employerLines];
  const gross = sum(earningLines.map((l) => l.amount));
  const deductions = sum([...deductionLines, ...statutoryDeductions].map((l) => l.amount));
  const employerContributions = sum(employerLines.map((l) => l.amount));
  const netBeforeRounding = gross.minus(deductions);
  const rounded = roundByRule(netBeforeRounding, rules.netRounding, "Net pay");
  const roundingAdjustment = rounded.minus(netBeforeRounding);
  if (!roundingAdjustment.isZero()) {
    lines.push({ code: STATUTORY_LINE_CODES.NET_ROUNDING, label: STATUTORY_LINE_LABEL.NET_ROUNDING!, kind: "ROUNDING", source: "NET_ROUNDING", sourceRef: null, amount: roundingAdjustment, basis: { rounding: rules.netRounding, before: c(netBeforeRounding) } });
  }
  const netPay = rounded;

  // ── Holds and exceptions ──
  const holds: HoldReason[] = [];
  const leftThisCycle = input.lastWorkingDate !== null && input.lastWorkingDate >= ctx.cycle.start && input.lastWorkingDate <= ctx.cycle.end;
  if (leftThisCycle && rules.leaverTiming === "HOLD_FOR_FNF") holds.push("FINAL_SETTLEMENT");
  if (netPay.isNegative()) {
    if (rules.negativeNet === "HOLD_PAYMENT") holds.push("NEGATIVE_NET");
    else exceptions.push({ code: "NEGATIVE_NET", severity: "BLOCKING", message: `Deductions (${c(deductions)}) are more than earnings (${c(gross)}), so net pay is negative (${c(netPay)}). Resolve it before the run can be submitted.` });
  } else if (netPay.isZero()) holds.push("ZERO_NET");
  if (!input.hasBankAccount) holds.push("NO_BANK_ACCOUNT");
  if (input.directorHold) holds.push("DIRECTOR_HOLD");
  const status = holds.length > 0 ? ("HELD" as const) : ("PAYABLE" as const);

  const last = input.segments.at(-1)!;
  inputsOut.days = {
    cycleDays: figures.cycleDays,
    employedDays: figures.employedDays,
    notEmployedDays: figures.notEmployedDays,
    basisDays: c(figures.basisDays),
    lopDivisorDays: c(figures.lopDivisorDays),
    lopDays: c(figures.lopDays),
    employedShare: c(figures.employedShare),
    lopShare: c(figures.lopShare),
    factor: c(figures.factor),
    factorNum: c(figures.factorNum),
    factorDen: c(figures.factorDen),
    payBasis: rules.payDaysBasis,
    lopDivisor: rules.lopDivisor,
    lopByDay: input.days.filter((d) => d.lopDays.greaterThan(ZERO)).map((d) => ({ date: iso(d.date), lop: c(d.lopDays) })),
  };
  inputsOut.segments = segmentsOut;
  inputsOut.holds = holds;
  inputsOut.employedDays = countDays(input.span.from, input.span.to);

  const placement: Record<string, unknown> = input.placement ? { onDay: iso(input.placementDay), locationId: input.placement.locationId, departmentId: input.placement.departmentId, gradeId: input.placement.gradeId, costCentreId: input.placement.costCentreId, stateKey } : {};
  const lineHash = lines.map((l) => [l.code, l.kind, l.source, l.sourceRef, c(l.amount)]);
  return {
    employeeId: input.employeeId,
    status,
    holdReason: holds[0] ?? null,
    holdDetail: holds.length ? holds.map((h) => HOLD_REASON_LABEL[h]).join("; ") : null,
    employedFrom: input.span.from,
    employedTo: input.span.to,
    basisDays: figures.basisDays,
    lopDivisorDays: figures.lopDivisorDays,
    lopDays: figures.lopDays,
    paidDays: figures.paidDays,
    gross,
    deductions,
    employerContributions,
    netBeforeRounding,
    roundingAdjustment,
    netPay,
    employmentType: input.employmentType,
    placement,
    structureKey: last.structureKey,
    structureVersion: last.structureVersion,
    lines,
    inputs: inputsOut,
    notices,
    exceptions,
    itemHash: payrollHash({ e: input.employeeId, s: status, h: holds, l: lineHash, n: c(netPay), i: inputsOut, x: exceptions.map((x) => x.code) }),
  };
}

// ── A loss-of-pay reversal: a line for each prorated head, linked to the month it belongs to ──

function reversalLines(adj: AdjustmentIn, ctx: CalcContext): { lines: LineOut[]; pf: Money; esi: Money; notices: string[] } {
  const notices: string[] = [];
  const follow = ctx.rules.arrearsPfEsi === "FOLLOW_COMPONENT_FLAGS";
  let pf = ZERO;
  let esi = ZERO;
  const lines: LineOut[] = [];
  for (const part of adj.breakdown ?? []) {
    const head = ctx.components.current.get(part.component)?.value;
    const link = head?.reversalHead ? ctx.components.current.get(head.reversalHead)?.value : undefined;
    if (head?.reversalHead && !link) notices.push(`The reversal head ${head.reversalHead} of ${part.component} has no version on record, so its line is carried under the general loss-of-pay reversal head.`);
    if (follow && head?.pfApplicable) pf = pf.plus(part.amount);
    if (follow && head?.esiApplicable) esi = esi.plus(part.amount);
    const earning = part.amount.greaterThan(ZERO);
    lines.push({
      code: link && head?.reversalHead ? head.reversalHead : LOP_REVERSAL_CODE,
      label: `${link?.payslipLabel ?? "Loss of pay reversal"}: ${head?.payslipLabel ?? part.component} for ${adj.periodLabel ?? "an earlier month"}`,
      kind: earning ? "EARNING" : "DEDUCTION",
      source: "LOP_REVERSAL",
      sourceRef: adj.id,
      amount: part.amount.abs(),
      basis: { kind: "LOP_REVERSAL", head: part.component, sourceMonth: adj.periodLabel ?? null, correctionKey: adj.sourceRef, reason: adj.reason, signed: c(part.amount), reversalHead: head?.reversalHead ?? null },
    });
  }
  return { lines, pf, esi, notices };
}

// ── An adjustment, an arrears row or a year-end encashment as a line ──

function adjustmentLine(adj: AdjustmentIn, ctx: CalcContext): { line: LineOut; pf: Money; esi: Money; notices: string[] } {
  const notices: string[] = [];
  const signed = (m: Money) => (adj.direction === "EARNING" ? m : m.negated());
  if (adj.source === "SALARY_ARREARS") {
    const follow = ctx.rules.arrearsPfEsi === "FOLLOW_COMPONENT_FLAGS";
    let pf = ZERO;
    let esi = ZERO;
    for (const part of adj.breakdown ?? []) {
      const flags = ctx.components.current.get(part.component)?.value;
      if (follow && flags?.pfApplicable) pf = pf.plus(part.amount);
      if (follow && flags?.esiApplicable) esi = esi.plus(part.amount);
    }
    return {
      line: { code: ARREARS_CODE, label: `${STATUTORY_LINE_LABEL.ARREARS} for ${adj.periodLabel ?? "an earlier month"}`, kind: adj.direction, source: "ARREARS", sourceRef: adj.id, amount: adj.amount, basis: { reason: adj.reason, breakdown: (adj.breakdown ?? []).map((p) => ({ component: p.component, amount: c(p.amount) })), pfEsi: ctx.rules.arrearsPfEsi } },
      pf,
      esi,
      notices,
    };
  }
  if (adj.source === "HOLD_RELEASE") {
    // Pays a month whose salary a director held and has now released. Its statutory deductions were worked out, and stay, in the held month's own run: this only moves the payment.
    return {
      line: { code: HOLD_RELEASE_CODE, label: `Held salary released for ${adj.periodLabel ?? "an earlier month"}`, kind: "EARNING", source: "HOLD_RELEASE", sourceRef: adj.id, amount: adj.amount, basis: { kind: "HOLD_RELEASE", holdId: adj.sourceRef, sourceMonth: adj.periodLabel ?? null, reason: adj.reason, netOfStatutory: true } },
      pf: ZERO,
      esi: ZERO,
      notices,
    };
  }
  if (adj.source === "YEAR_END_ENCASHMENT") {
    const pf = ctx.rules.encashPfApplicable ? adj.amount : ZERO;
    return {
      line: { code: STATUTORY_LINE_CODES.LEAVE_ENCASHMENT, label: STATUTORY_LINE_LABEL.LEAVE_ENCASHMENT!, kind: "EARNING", source: "ENCASHMENT", sourceRef: adj.sourceRef, amount: adj.amount, basis: { reason: adj.reason, committedAmount: c(adj.amount), pfApplicable: ctx.rules.encashPfApplicable === true } },
      pf,
      esi: ZERO,
      notices,
    };
  }
  const current = ctx.components.current.get(adj.componentCode);
  if (!current) notices.push(`The component ${adj.componentCode} used by an adjustment has no version on record.`);
  const flags = current?.value;
  return {
    line: { code: adj.componentCode, label: flags?.payslipLabel ?? adj.componentCode, kind: adj.direction, source: "ADJUSTMENT", sourceRef: adj.id, amount: adj.amount, basis: { reason: adj.reason, componentVersion: current?.version ?? null, signed: c(signed(adj.amount)) } },
    pf: flags?.pfApplicable ? adj.amount : ZERO,
    esi: flags?.esiApplicable ? adj.amount : ZERO,
    notices,
  };
}

