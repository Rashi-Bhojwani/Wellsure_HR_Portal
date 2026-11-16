import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { namesOn, salariesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { behaviourOn, behaviourValue } from "../../behaviours/service";
import { policyInForce } from "../../policySettings/service";
import { fixed } from "../money";
import { basisOf, encashmentAmount, gratuityAmount, gratuityYears, noticeRecoveryAmount, noticeShortfall, overtimeAmount } from "./arith";
import { serviceLength } from "../settlements/guide";

// Part 3 A2/A3 (docs/plans/A_PART3.md; owner decisions 2026-11-13): paying approved overtime and in-year leave encashment. Each needs its behaviour setting confirmed by
// two directors (Not set by default) AND the other session's own switch on; until then nothing is paid and no run changes. Paying creates ordinary pending pay adjustments
// (paid by the next run, reviewed like any other input), once: the adjustment's unique source reference makes a second click find it already there.

type Actor = { userId: string; ip?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);
const monthEnd = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)); // allow-number: calendar arithmetic
const linesOf = (s: { lines: Array<{ componentCode: string; amount: { toString(): string } }> } | undefined) => (s?.lines ?? []).map((l) => ({ componentCode: l.componentCode, amount: l.amount.toString() }));

export async function overtimeSetting() {
  return (await behaviourValue("payroll.overtimePay")).value;
}
export async function encashmentSetting() {
  return (await behaviourValue("payroll.leaveEncashment")).value;
}

export const monthQuery = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, "A month, YYYY-MM") }).strict();

/** What a month's approved overtime would pay each person (or why nothing can be paid yet). */
export async function overtimePreview(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "see overtime pay");
  const p = monthQuery.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const month = p.data.month;
  const [setting, policy] = await Promise.all([overtimeSetting(), policyInForce("policy.overtime")]);
  const notSet = [...(policy ? [] : ["Overtime is not turned on (Policy settings)."]), ...(setting ? [] : ["Overtime pay is Not set (Default behaviours): the pay head and the rate."])];
  const claims = await prisma.overtimeClaim.findMany({ where: { status: "APPROVED", date: { gte: new Date(`${month}-01T00:00:00Z`), lte: monthEnd(month) } }, select: { employeeId: true, minutes: true, approvedMinutes: true } });
  const minutes = new Map<string, number>();
  for (const c of claims) minutes.set(c.employeeId, (minutes.get(c.employeeId) ?? 0) + (c.approvedMinutes ?? c.minutes));
  const ids = [...minutes.keys()];
  const [names, emps, salaries, posted] = await Promise.all([
    namesOn(ids, monthEnd(month)),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }),
    salariesOn(ids, monthEnd(month)),
    prisma.payrollAdjustment.findMany({ where: { source: "MANUAL", sourceRef: { in: ids.map((id) => `overtime:${id}:${month}`) } }, select: { sourceRef: true } }),
  ]);
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const done = new Set(posted.map((x) => x.sourceRef));
  const people = ids.sort().map((id) => {
    const amount = setting ? overtimeAmount(minutes.get(id)!, setting.rate, linesOf(salaries.get(id)), setting.rounding) : null;
    return { employeeId: id, employeeCode: code.get(id) ?? "", name: names.get(id) ?? "", minutes: minutes.get(id)!, amount: amount ? fixed(amount, 2) : null, posted: done.has(`overtime:${id}:${month}`), noSalary: !salaries.get(id) };
  });
  return { month, notSet, payHead: setting?.payHead ?? null, people };
}

/** Pays a month's approved overtime: one pending adjustment per person, once. Refused while anything is Not set. */
export async function overtimePost(raw: unknown, actor: Actor) {
  const pre = await overtimePreview(raw, actor);
  if (pre.notSet.length) throw new HttpError(409, pre.notSet.join(" "), "NOT_SET");
  const setting = (await overtimeSetting())!;
  let created = 0;
  for (const person of pre.people) {
    if (person.posted || person.noSalary || !person.amount || Number.parseFloat(person.amount) === 0) continue; // allow-number: skip a zero amount
    try {
      await prisma.payrollAdjustment.create({ data: { employeeId: person.employeeId, componentCode: setting.payHead, direction: "EARNING", amount: person.amount, source: "MANUAL", sourceRef: `overtime:${person.employeeId}:${pre.month}`, reason: `Overtime ${pre.month} (${person.minutes} minutes)`, createdByUserId: actor.userId } });
      created += 1;
    } catch {
      // posted by the other director at the same moment: the unique source reference kept it to one
    }
  }
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.overtime.posted", entityType: "PayrollAdjustment", entityId: pre.month, after: { month: pre.month, people: created } }); // no figure
  return { month: pre.month, created };
}

/** Approved in-year encashment requests and what each would pay (or why nothing can be paid yet). */
export async function encashmentList(actor: Actor) {
  await requireDirector(actor.userId, "see leave encashment pay");
  const [setting, policy] = await Promise.all([encashmentSetting(), policyInForce("policy.encashmentRequests")]);
  const notSet = [...(policy ? [] : ["Encashment requests are not turned on (Policy settings)."]), ...(setting ? [] : ["Leave encashment is Not set (Default behaviours): the pay head, the per-day basis and the divisor."])];
  const reqs = await prisma.leaveEncashmentRequest.findMany({ where: { status: "APPROVED" }, orderBy: { decidedAt: "asc" }, include: { leaveType: { select: { code: true } } } });
  const ids = [...new Set(reqs.map((r) => r.employeeId))];
  const today = businessToday();
  const [names, emps, salaries, paid] = await Promise.all([
    namesOn(ids, today),
    prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, employeeCode: true } }),
    salariesOn(ids, today),
    prisma.payrollAdjustment.findMany({ where: { source: "MANUAL", sourceRef: { in: reqs.map((r) => `encashment:${r.id}`) } }, select: { sourceRef: true } }),
  ]);
  const code = new Map(emps.map((e) => [e.id, e.employeeCode]));
  const done = new Set(paid.map((x) => x.sourceRef));
  const dim = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0)).getUTCDate();
  return {
    notSet,
    payHead: setting?.payHead ?? null,
    requests: reqs.map((r) => {
      const amount = setting ? encashmentAmount(r.days.toString(), linesOf(salaries.get(r.employeeId)), setting.basisHeads, setting.divisor, dim, setting.rounding) : null;
      return { id: r.id, employeeCode: code.get(r.employeeId) ?? "", name: names.get(r.employeeId) ?? "", leaveType: r.leaveType.code, leaveYear: r.leaveYear, days: r.days.toString(), amount: amount ? fixed(amount, 2) : null, paid: done.has(`encashment:${r.id}`), noSalary: !salaries.get(r.employeeId) };
    }),
  };
}

export const payEncashmentSchema = z.object({ requestId: z.string().min(1).max(64) }).strict();

/** Pays one approved request: a pending adjustment and the leave-ledger ENCASHMENT entry, in one transaction, once. Refused while anything is Not set. */
export async function encashmentPay(raw: unknown, actor: Actor) {
  const p = payEncashmentSchema.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const list = await encashmentList(actor);
  if (list.notSet.length) throw new HttpError(409, list.notSet.join(" "), "NOT_SET");
  const r = list.requests.find((x) => x.id === p.data.requestId);
  if (!r) throw new HttpError(404, "No approved encashment request with that id.", "NOT_FOUND");
  if (r.paid) throw new HttpError(409, "Already paid.", "ALREADY_PAID");
  if (r.noSalary || !r.amount) throw new HttpError(409, "The person has no salary in force, so there is nothing to pay from.", "NO_SALARY");
  const setting = (await encashmentSetting())!;
  const req = await prisma.leaveEncashmentRequest.findUniqueOrThrow({ where: { id: r.id } });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.payrollAdjustment.create({ data: { employeeId: req.employeeId, componentCode: setting.payHead, direction: "EARNING", amount: r.amount!, source: "MANUAL", sourceRef: `encashment:${req.id}`, reason: `Leave encashment (${r.leaveType}, ${r.days} days)`, createdByUserId: actor.userId } });
      await tx.leaveLedger.create({ data: { employeeId: req.employeeId, leaveTypeId: req.leaveTypeId, leaveYear: req.leaveYear, entryDate: new Date(`${iso(businessToday())}T00:00:00Z`), entryType: "ENCASHMENT", days: req.days.negated(), referenceType: "ENCASHMENT_REQUEST", referenceId: req.id } });
    });
  } catch (err) {
    if ((err as { code?: string }).code === "P2002") throw new HttpError(409, "Already paid.", "ALREADY_PAID");
    throw err;
  }
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.encashment.paid", entityType: "LeaveEncashmentRequest", entityId: req.id, after: { days: req.days.toString() } });
  return { id: req.id, paid: true };
}

/** At exit (the settlement's leave-balance line): the amount for `days` of a leave type, or null while the setting is Not set or the type is not encashed at exit. */
export async function exitEncashment(employeeId: string, leaveTypeCode: string, days: string, lastWorkingDate: Date): Promise<{ amount: string; source: string } | null> {
  const setting = await encashmentSetting();
  if (!setting || !setting.exitLeaveTypes.includes(leaveTypeCode)) return null;
  const salary = (await salariesOn([employeeId], lastWorkingDate)).get(employeeId);
  if (!salary) return null;
  const dim = new Date(Date.UTC(lastWorkingDate.getUTCFullYear(), lastWorkingDate.getUTCMonth() + 1, 0)).getUTCDate();
  return { amount: fixed(encashmentAmount(days, linesOf(salary), setting.basisHeads, setting.divisor, dim, setting.rounding), 2), source: "leave encashment setting (Default behaviours)" };
}

/** Part 4: gratuity at exit, or null while the setting is Not set (or not in force on the day) or the person does not qualify. */
export async function exitGratuity(employeeId: string, lastWorkingDate: Date): Promise<{ amount: string; source: string; years: number } | null> {
  const setting = await behaviourOn("payroll.gratuity", iso(lastWorkingDate));
  if (!setting) return null;
  const emp = await prisma.employee.findUnique({ where: { id: employeeId }, select: { dateOfJoining: true } });
  const salary = (await salariesOn([employeeId], lastWorkingDate)).get(employeeId);
  if (!emp || !salary) return null;
  const svc = serviceLength(emp.dateOfJoining, lastWorkingDate);
  const completed = svc.years + svc.months / 12; // allow-number: months in a year, for the eligibility comparison only
  if (completed < Number(setting.minYears)) return null; // allow-number: the setting's own least years
  const years = gratuityYears(svc.years, svc.months, setting.partYear);
  const amount = gratuityAmount(years, basisOf(linesOf(salary), setting.wageHeads), setting.daysPerYear, setting.divisor, setting.ceiling, setting.rounding);
  return { amount: fixed(amount, 2), source: `gratuity setting (Default behaviours), ${years} year(s) counted`, years };
}

/** Part 4: notice recovery at exit, or null while the setting is Not set, recovery is off, or the notice was served in full. */
export async function exitNoticeRecovery(employeeId: string, noticeGiven: Date, lastWorkingDate: Date): Promise<{ amount: string; shortfall: number; source: string } | null> {
  const setting = await behaviourOn("payroll.noticeRecovery", iso(lastWorkingDate));
  if (!setting || !setting.recoverShortfall) return null;
  const given = new Date(`${iso(noticeGiven)}T00:00:00Z`);
  const { shortfall } = noticeShortfall(given, lastWorkingDate, setting.noticeDays);
  if (shortfall === 0) return null;
  const salary = (await salariesOn([employeeId], lastWorkingDate)).get(employeeId);
  if (!salary) return null;
  const amount = noticeRecoveryAmount(shortfall, basisOf(linesOf(salary), setting.basisHeads), setting.divisor, setting.rounding);
  return { amount: fixed(amount, 2), shortfall, source: `notice setting (Default behaviours): ${setting.noticeDays} days, given ${iso(given)}` };
}
