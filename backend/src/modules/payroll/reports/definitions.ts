import { PAYROLL_REPORTS, type PayrollReportKey } from "@shared/constants/payrollReports";
import { STATUTORY_LINE_LABEL } from "@shared/constants/payrollRun";
import { businessToday } from "../../../lib/businessDate";
import { employedOn, namesOn, placementsOn as placementsInForce, salariesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { listAll as listLoans } from "../loans/service";
import { ZERO, dec, fixed, roundTo, sum, type Money } from "../money";

// Stage 6 (docs/plans/STAGE_6_PAYROLL_REPORTS.md): each payroll report adds up what finalised runs (or the loan, claim and salary records) already hold. Nothing here
// works out a tax or statutory figure. Money is added exactly and shown to the paisa only at the end.

export interface Filters {
  month?: string;
  compareMonth?: string;
  fromMonth?: string;
  toMonth?: string;
  fromDate?: string;
  toDate?: string;
  asOf?: string;
  department?: string;
  location?: string;
}
type Row = Record<string, string | number | null>;
export interface Built {
  rows: Row[];
  filtersApplied: string[];
  notes: string[];
}

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const m2 = (v: Money) => fixed(v, 2);
const monthStart = (m: string) => day(`${m.slice(0, 7)}-01`);

async function orgNames() {
  const [deps, locs] = await Promise.all([prisma.department.findMany({ select: { id: true, name: true } }), prisma.location.findMany({ select: { id: true, name: true } })]);
  return { dep: new Map(deps.map((d) => [d.id, d.name])), loc: new Map(locs.map((l) => [l.id, l.name])) };
}

/** A finalised run for a month (YYYY-MM), or the latest finalised one. */
async function finalisedRun(month: string | undefined, what: string) {
  const run = month
    ? await prisma.payrollRun.findFirst({ where: { status: "FINALISED", cycleStart: monthStart(month) } })
    : await prisma.payrollRun.findFirst({ where: { status: "FINALISED" }, orderBy: { cycleStart: "desc" } });
  if (!run) throw new HttpError(404, month ? `There is no finalised payroll run for ${month.slice(0, 7)}${what}.` : "There is no finalised payroll run yet.", "NO_FINAL_RUN");
  return run;
}

type Placement = { departmentId?: string; locationId?: string };
const placed = (p: unknown) => (p ?? {}) as Placement;
const passesOrg = (p: Placement, f: Filters) => (!f.department || p.departmentId === f.department) && (!f.location || p.locationId === f.location);

/** Where each employee is placed on a day (department, branch), from the job history in force. */
async function placementsOn(employeeIds: string[], on: Date): Promise<Map<string, Placement>> {
  const rows = await placementsInForce(employeeIds, on); // the shared reader (lib/effectiveDating.ts)
  return new Map([...rows].map(([id, r]) => [id, { departmentId: r.departmentId, locationId: r.locationId }]));
}

function orgApplied(f: Filters, names: Awaited<ReturnType<typeof orgNames>>): string[] {
  const out: string[] = [];
  if (f.department) out.push(`Department: ${names.dep.get(f.department) ?? "unknown"}`);
  if (f.location) out.push(`Branch: ${names.loc.get(f.location) ?? "unknown"}`);
  return out;
}

async function personColumns(employeeIds: string[], placement: Map<string, Placement>, on: Date) {
  const [names, codes, org] = await Promise.all([namesOn(employeeIds, on), prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, employeeCode: true } }), orgNames()]);
  const code = new Map(codes.map((e) => [e.id, e.employeeCode]));
  return (id: string): Row => ({ employeeCode: code.get(id) ?? "", name: names.get(id) ?? "", department: org.dep.get(placement.get(id)?.departmentId ?? "") ?? "", location: org.loc.get(placement.get(id)?.locationId ?? "") ?? "" });
}

/** Pure: change and change % between two amounts, exact; % to two places half up; none when the compared amount is zero. Exported for the independent-model test. */
export function varianceOf(before: Money, now: Money): { change: Money; percent: Money | null } {
  const change = now.minus(before);
  return { change, percent: before.isZero() ? null : roundTo(change.times(100).dividedBy(before), 2, "HALF_UP") };
}

export async function build(key: PayrollReportKey, f: Filters, actor: { userId: string }): Promise<Built> {
  const names = await orgNames();
  switch (key) {
    case "payroll-summary": {
      const where = { status: "FINALISED" as const, ...(f.fromMonth || f.toMonth ? { cycleStart: { ...(f.fromMonth ? { gte: monthStart(f.fromMonth) } : {}), ...(f.toMonth ? { lte: monthStart(f.toMonth) } : {}) } } : {}) };
      const runs = await prisma.payrollRun.findMany({ where, orderBy: { cycleStart: "asc" }, take: 120 });
      const rows: Row[] = [];
      for (const r of runs) {
        const items = await prisma.payrollRunItem.findMany({ where: { runId: r.id, status: { in: ["PAYABLE", "HELD"] } }, select: { status: true, gross: true, deductions: true, employerContributions: true, netPay: true } });
        const paid = items.filter((i) => i.status === "PAYABLE");
        const held = items.filter((i) => i.status === "HELD");
        const gross = sum(items.map((i) => dec(i.gross.toString())));
        const employer = sum(items.map((i) => dec(i.employerContributions.toString())));
        rows.push({ cycle: r.cycleLabel, paid: paid.length, held: held.length, gross: m2(gross), deductions: m2(sum(items.map((i) => dec(i.deductions.toString())))), employer: m2(employer), netPaid: m2(sum(paid.map((i) => dec(i.netPay.toString())))), netHeld: m2(sum(held.map((i) => dec(i.netPay.toString())))), cost: m2(gross.plus(employer)) });
      }
      return { rows, filtersApplied: [`Months: ${f.fromMonth?.slice(0, 7) ?? "the first"} to ${f.toMonth?.slice(0, 7) ?? "the latest"}`], notes: ["Finalised runs only. Paid and held people are both counted; people left out of a run are not in it.", "Cost to company is gross plus employer contributions."] };
    }
    case "department-cost":
    case "head-wise":
    case "statutory-summary":
    case "statutory-by-person": {
      const run = await finalisedRun(f.month, "");
      const items = (await prisma.payrollRunItem.findMany({ where: { runId: run.id, status: { in: ["PAYABLE", "HELD"] } }, select: { id: true, employeeId: true, placement: true, gross: true, deductions: true, employerContributions: true, netPay: true } })).filter((i) => key === "statutory-summary" || passesOrg(placed(i.placement), f));
      const applied = [`Month: ${run.cycleLabel}`, ...(key === "statutory-summary" ? [] : orgApplied(f, names))];
      if (key === "department-cost") {
        const groups = new Map<string, typeof items>();
        for (const i of items) {
          const k = placed(i.placement).departmentId ?? "";
          groups.set(k, [...(groups.get(k) ?? []), i]);
        }
        const rows = [...groups.entries()]
          .map(([dep, list]) => {
            const gross = sum(list.map((i) => dec(i.gross.toString())));
            const employer = sum(list.map((i) => dec(i.employerContributions.toString())));
            return { department: names.dep.get(dep) ?? "No department on record", people: list.length, gross: m2(gross), employer: m2(employer), cost: m2(gross.plus(employer)), deductions: m2(sum(list.map((i) => dec(i.deductions.toString())))), net: m2(sum(list.map((i) => dec(i.netPay.toString())))) };
          })
          .sort((a, b) => String(a.department).localeCompare(String(b.department)));
        return { rows, filtersApplied: applied, notes: ["Each person counts in the department the run placed them in (the placement on the day that decides their state)."] };
      }
      const lines = await prisma.payrollRunLine.findMany({ where: { runItemId: { in: items.map((i) => i.id) } }, select: { employeeId: true, code: true, label: true, kind: true, source: true, amount: true } });
      if (key === "head-wise") {
        const groups = new Map<string, { code: string; label: string; kind: string; people: Set<string>; total: Money }>();
        for (const l of lines) {
          const k = `${l.code}|${l.kind}`;
          const g = groups.get(k) ?? { code: l.code, label: l.label, kind: l.kind, people: new Set<string>(), total: ZERO };
          g.people.add(l.employeeId);
          g.total = g.total.plus(dec(l.amount.toString()));
          groups.set(k, g);
        }
        const order = { EARNING: 0, DEDUCTION: 1, EMPLOYER_CONTRIBUTION: 2, ROUNDING: 3 } as Record<string, number>;
        const rows = [...groups.values()].sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9) || a.code.localeCompare(b.code)).map((g) => ({ code: g.code, label: g.label, kind: g.kind.replace(/_/g, " ").toLowerCase(), people: g.people.size, total: m2(g.total) }));
        return { rows, filtersApplied: applied, notes: ["Every line of the run, by pay head; a head that appears as an earning and as a deduction (for example an adjustment) has a row for each."] };
      }
      const STAT = new Set(["PF", "ESI", "PT", "LWF", "TDS"]);
      const statLines = lines.filter((l) => STAT.has(l.source));
      if (key === "statutory-summary") {
        const groups = new Map<string, { statute: string; line: string; people: Set<string>; employee: Money; employer: Money }>();
        for (const l of statLines) {
          const g = groups.get(l.code) ?? { statute: l.source, line: STATUTORY_LINE_LABEL[l.code] ?? l.label, people: new Set<string>(), employee: ZERO, employer: ZERO };
          g.people.add(l.employeeId);
          if (l.kind === "EMPLOYER_CONTRIBUTION") g.employer = g.employer.plus(dec(l.amount.toString()));
          else g.employee = g.employee.plus(dec(l.amount.toString()));
          groups.set(l.code, g);
        }
        const rows = [...groups.values()].sort((a, b) => a.statute.localeCompare(b.statute) || a.line.localeCompare(b.line)).map((g) => ({ statute: g.statute, line: g.line, people: g.people.size, employee: m2(g.employee), employer: m2(g.employer) }));
        return { rows, filtersApplied: applied, notes: ["What the run worked out from the statutory rules the directors confirmed; this report computes nothing itself."] };
      }
      // statutory-by-person
      const ids = [...new Set(items.map((i) => i.employeeId))];
      const placement = new Map(items.map((i) => [i.employeeId, placed(i.placement)]));
      const person = await personColumns(ids, placement, run.cycleEnd);
      const add = (m: Map<string, Money>, k: string, v: Money) => m.set(k, (m.get(k) ?? ZERO).plus(v));
      const byPerson = new Map<string, Map<string, Money>>();
      for (const l of statLines) {
        const m = byPerson.get(l.employeeId) ?? new Map<string, Money>();
        const v = dec(l.amount.toString());
        const col = l.source === "PF" ? (l.kind === "EMPLOYER_CONTRIBUTION" ? "pfEmployer" : "pfEmployee") : l.source === "ESI" ? (l.kind === "EMPLOYER_CONTRIBUTION" ? "esiEmployer" : "esiEmployee") : l.source === "LWF" ? (l.kind === "EMPLOYER_CONTRIBUTION" ? "lwfEmployer" : "lwfEmployee") : l.source === "PT" ? "pt" : "tds";
        add(m, col, v);
        byPerson.set(l.employeeId, m);
      }
      const COLS = ["pfEmployee", "pfEmployer", "esiEmployee", "esiEmployer", "pt", "lwfEmployee", "lwfEmployer", "tds"];
      const rows = ids.map((id) => ({ ...person(id), ...Object.fromEntries(COLS.map((k) => [k, m2(byPerson.get(id)?.get(k) ?? ZERO)])) })).sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)));
      return { rows, filtersApplied: applied, notes: ["PF (employer) is every employer part the run worked out (pension, provident fund, EDLI, administration)."] };
    }
    case "variance": {
      const run = await finalisedRun(f.month, "");
      const before = f.compareMonth ? await finalisedRun(f.compareMonth, " to compare with") : await prisma.payrollRun.findFirst({ where: { status: "FINALISED", cycleStart: { lt: run.cycleStart } }, orderBy: { cycleStart: "desc" } });
      if (!before) throw new HttpError(404, "There is no earlier finalised run to compare with.", "NO_FINAL_RUN");
      const load = async (runId: string) => new Map((await prisma.payrollRunItem.findMany({ where: { runId, status: { in: ["PAYABLE", "HELD"] } }, select: { employeeId: true, placement: true, gross: true, netPay: true } })).map((i) => [i.employeeId, i]));
      const [a, b] = await Promise.all([load(before.id), load(run.id)]);
      const ids = [...new Set([...a.keys(), ...b.keys()])].filter((id) => passesOrg(placed((b.get(id) ?? a.get(id))!.placement), f));
      const placement = new Map(ids.map((id) => [id, placed((b.get(id) ?? a.get(id))!.placement)]));
      const person = await personColumns(ids, placement, run.cycleEnd);
      const rows = ids
        .map((id) => {
          const netBefore = dec(a.get(id)?.netPay.toString() ?? "0");
          const netNow = dec(b.get(id)?.netPay.toString() ?? "0");
          const v = varianceOf(netBefore, netNow);
          return { ...person(id), grossBefore: m2(dec(a.get(id)?.gross.toString() ?? "0")), grossNow: m2(dec(b.get(id)?.gross.toString() ?? "0")), netBefore: m2(netBefore), netNow: m2(netNow), change: m2(v.change), changePercent: v.percent === null ? null : fixed(v.percent, 2) };
        }) as Row[];
      rows.sort((x, y) => String(x.employeeCode).localeCompare(String(y.employeeCode)));
      return { rows, filtersApplied: [`Month: ${run.cycleLabel}`, `Compared with: ${before.cycleLabel}`, ...orgApplied(f, names)], notes: ["Someone in only one of the two runs shows 0 in the other. Change % is blank when the compared net is 0."] };
    }
    case "bank-transfer": {
      const range = { ...(f.fromDate ? { gte: day(f.fromDate) } : {}), ...(f.toDate ? { lte: day(f.toDate) } : {}) };
      const pd = f.fromDate || f.toDate ? { paymentDate: range } : {};
      const [runs, repays, offs] = await Promise.all([
        prisma.bankTransferBatch.findMany({ where: pd, include: { run: { select: { cycleLabel: true } }, sentMark: true, _count: { select: { rejections: true } } } }),
        prisma.bankRepaymentBatch.findMany({ where: pd, include: { sentMark: true } }),
        prisma.offCycleBankBatch.findMany({ where: pd, include: { sentMark: true, run: { select: { kind: true } } } }),
      ]);
      const rows: Row[] = [
        ...runs.map((b) => ({ kind: "Monthly run", forWhat: b.run.cycleLabel, paymentDate: iso(b.paymentDate), rows: b.rowCount, total: m2(dec(b.total.toString())), fileName: b.fileName, sent: b.sentMark ? "Yes" : "No", rejected: b._count.rejections })),
        ...repays.map((b) => ({ kind: "Repayment", forWhat: "Rows the bank rejected", paymentDate: iso(b.paymentDate), rows: b.rowCount, total: m2(dec(b.total.toString())), fileName: b.fileName, sent: b.sentMark ? "Yes" : "No", rejected: 0 })),
        ...offs.map((b) => ({ kind: "Off-cycle run", forWhat: b.run.kind === "SETTLEMENT" ? "Final settlement" : "Held pay", paymentDate: iso(b.paymentDate), rows: 1, total: m2(dec(b.amount.toString())), fileName: b.fileName, sent: b.sentMark ? "Yes" : "No", rejected: 0 })),
      ].sort((x, y) => String(x.paymentDate).localeCompare(String(y.paymentDate)));
      return { rows, filtersApplied: [`Payment dates: ${f.fromDate ?? "the first"} to ${f.toDate ?? "the latest"}`], notes: ["No account number is shown: the files themselves hold them, and are downloaded from their own screens with an audit row."] };
    }
    case "loans": {
      const asOf = f.asOf ? day(f.asOf) : businessToday();
      const loans = (await listLoans(actor)).loans.filter((l) => l.status === "SANCTIONED");
      const ids = [...new Set(loans.map((l) => l.employeeId))];
      const placement = await placementsOn(ids, asOf);
      const keep = loans.filter((l) => passesOrg(placement.get(l.employeeId) ?? {}, f));
      const person = await personColumns(ids, placement, asOf);
      const LABEL: Record<string, string> = { NOT_PAID_OUT: "Paid with the next run", RECOVERING: "Recovering", STOPPED: "Recovery stopped", FULLY_RECOVERED: "Fully recovered", RECOVERED_AT_EXIT: "Recovered at exit" };
      const rows: Row[] = keep.map((l) => ({ ...person(l.employeeId), type: l.typeKey, principal: m2(dec(l.principal)), rate: l.ratePercent, instalments: l.instalments, recovered: l.recovered, balance: l.balance, recovery: LABEL[l.recovery ?? ""] ?? l.recovery ?? "" }));
      rows.sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)));
      return { rows, filtersApplied: [`As of: ${iso(asOf)} (balances are as recorded now)`, ...orgApplied(f, names)], notes: ["Recovered is what payroll runs recovered; a recovery at exit or a prepayment lowers the balance too."] };
    }
    case "claims": {
      const spent = { ...(f.fromDate ? { gte: day(f.fromDate) } : {}), ...(f.toDate ? { lte: day(f.toDate) } : {}) };
      const claims = await prisma.reimbursementClaim.findMany({ where: f.fromDate || f.toDate ? { spentOn: spent } : {}, include: { decision: true } });
      const paidRefs = new Set((await prisma.payrollAdjustment.findMany({ where: { source: "REIMBURSEMENT", status: "CONSUMED", sourceRef: { in: claims.map((c) => c.id) } }, select: { sourceRef: true } })).map((a) => a.sourceRef));
      const stateOf = (c: (typeof claims)[number]) => (!c.decision ? "Waiting" : c.decision.kind === "WITHDRAWN" ? "Withdrawn" : c.decision.kind === "REJECTED" ? "Rejected" : paidRefs.has(c.id) ? "Paid" : "Approved, not yet paid");
      const groups = new Map<string, { type: string; state: string; claims: number; claimed: Money; approved: Money }>();
      for (const c of claims) {
        const state = stateOf(c);
        const k = `${c.typeKey}|${state}`;
        const g = groups.get(k) ?? { type: c.typeKey, state, claims: 0, claimed: ZERO, approved: ZERO };
        g.claims += 1;
        g.claimed = g.claimed.plus(dec(c.amount.toString()));
        if (c.decision?.kind === "APPROVED") g.approved = g.approved.plus(dec(c.decision.approvedAmount!.toString()));
        groups.set(k, g);
      }
      const rows = [...groups.values()].sort((a, b) => a.type.localeCompare(b.type) || a.state.localeCompare(b.state)).map((g) => ({ type: g.type, state: g.state, claims: g.claims, claimed: m2(g.claimed), approved: m2(g.approved) }));
      return { rows, filtersApplied: [`Spent: ${f.fromDate ?? "any date"} to ${f.toDate ?? "any date"}`], notes: ["Approved is the amount a director approved (it can be lower than claimed)."] };
    }
    case "ctc": {
      const asOf = f.asOf ? day(f.asOf) : businessToday();
      const employed = (await prisma.employee.findMany({ where: employedOn(asOf), select: { id: true } })).map((e) => e.id);
      const salaries = [...(await salariesOn(employed, asOf)).values()]; // the shared reader (lib/effectiveDating.ts)
      const ids = salaries.map((s) => s.employeeId);
      const placement = await placementsOn(ids, asOf);
      const person = await personColumns(ids, placement, asOf);
      const rows = salaries
        .filter((s) => passesOrg(placement.get(s.employeeId) ?? {}, f))
        .map((s): Row => ({ ...person(s.employeeId), annualCtc: m2(dec(s.annualCtc.toString())), monthlyCtc: m2(dec(s.monthlyCtc.toString())), structure: `${s.structureKey} v${s.structureVersion}`, from: iso(s.effectiveFrom) }));
      rows.sort((a, b) => String(a.employeeCode).localeCompare(String(b.employeeCode)));
      return { rows, filtersApplied: [`As of: ${iso(asOf)}`, ...orgApplied(f, names)], notes: ["The salary in force on the date, as approved through salary revisions."] };
    }
  }
}

/** Exact totals of the money and number columns of the built rows. */
export function totalsOf(key: PayrollReportKey, rows: Row[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const col of PAYROLL_REPORTS[key].columns) {
    if (col.type === "money") out[col.key] = m2(sum(rows.map((r) => dec(String(r[col.key] ?? "0")))));
    if (col.type === "number" && !["instalments"].includes(col.key)) out[col.key] = rows.reduce((s, r) => s + Number(r[col.key] ?? 0), 0); // allow-number: counts of people, rows and claims, never money
  }
  return out;
}
