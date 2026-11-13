import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { dec, fixed } from "../money";
import { automaticLines, type Actor } from "./service";

// PY-27 / PY-28 / PY-29 (docs/plans/A_PARITY_ROWS.md): the settlement guide. Facts the system holds (service length, the last drawn pay, the leave balance in days)
// and the three rules a settlement amount needs, each Not set: the gratuity rule, the notice period and the encashment per-day rate are the owners' (spec §14). The
// guide never proposes an amount; a director types each line with its source on the prepare form, as before.

const DAY_MS = 86_400_000; // allow-number: milliseconds in a day
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** `start` plus `months` calendar months, the day clamped to the target month's last day (31 Jan + 1 month = 28 or 29 Feb). UTC dates. */
export function addMonthsClamped(start: Date, months: number): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth() + months;
  const target = new Date(Date.UTC(y, m, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(start.getUTCDate(), last)));
}

/**
 * Length of service from the date of joining to the last working day, both days counted: completed years and months (calendar months, the day clamped at month
 * ends), the days left over, and the total days. Pure; exported for the independent-model test.
 */
export function serviceLength(doj: Date, lastWorkingDay: Date): { years: number; months: number; days: number; totalDays: number } {
  if (lastWorkingDay < doj) throw new HttpError(400, "The last working day is before the date of joining.", "VALIDATION_ERROR");
  const end = new Date(lastWorkingDay.getTime() + DAY_MS); // the last working day counts
  let m = (end.getUTCFullYear() - doj.getUTCFullYear()) * 12 + (end.getUTCMonth() - doj.getUTCMonth()); // allow-number: months in a year
  while (m > 0 && addMonthsClamped(doj, m) > end) m -= 1;
  const days = Math.round((end.getTime() - addMonthsClamped(doj, m).getTime()) / DAY_MS); // allow-number: whole calendar days, not money
  return { years: Math.floor(m / 12), months: m % 12, days, totalDays: Math.round((end.getTime() - doj.getTime()) / DAY_MS) }; // allow-number: months in a year
}

const NOT_SET = "Not set";
export const GUIDE_RULES = [
  { key: "gratuity", label: "Gratuity rule", why: "Who qualifies, the formula and the wage it uses are the owners' to set (spec §14). Type the amount and its source if one is due." },
  { key: "noticePeriod", label: "Notice period", why: "No notice period is recorded for anyone yet; notice pay or recovery is typed with its source." },
  { key: "encashmentRate", label: "Leave encashment per-day rate", why: "The encashment formula and its tax treatment are the owners' to set (spec §14). The leave balance below is in days only." },
] as const;

export async function guide(separationId: string, actor: Actor) {
  await requireDirector(actor.userId, "see a settlement guide");
  const sep = await prisma.separation.findUnique({ where: { id: separationId }, include: { employee: { select: { id: true, employeeCode: true, dateOfJoining: true } } } });
  if (!sep || sep.status === "CANCELLED") throw new HttpError(404, "Separation not found.", "NOT_FOUND");
  const last = await prisma.payrollRunItem.findFirst({
    where: { employeeId: sep.employeeId, status: { in: ["PAYABLE", "HELD"] }, run: { status: "FINALISED" } },
    orderBy: { run: { cycleStart: "desc" } },
    select: { gross: true, run: { select: { cycleLabel: true } }, lines: { where: { kind: "EARNING" }, orderBy: { sortOrder: "asc" }, select: { code: true, label: true, amount: true } } },
  });
  const leave = (await automaticLines(sep.employeeId, sep.lastWorkingDate)).filter((l) => l.kind === "LEAVE_BALANCE").map((l) => ({ label: l.label, days: l.days ?? "0" }));
  return {
    separationId: sep.id,
    employeeCode: sep.employee.employeeCode,
    dateOfJoining: iso(sep.employee.dateOfJoining),
    lastWorkingDate: iso(sep.lastWorkingDate),
    service: serviceLength(sep.employee.dateOfJoining, sep.lastWorkingDate),
    lastDrawn: last ? { cycle: last.run.cycleLabel, gross: fixed(dec(last.gross.toString()), 2), earnings: last.lines.map((l) => ({ code: l.code, label: l.label, amount: fixed(dec(l.amount.toString()), 2) })) } : null,
    leave,
    rules: GUIDE_RULES.map((r) => ({ ...r, value: null, state: NOT_SET })),
    note: "Facts only. No amount is proposed: each line is typed by a director with its source.",
  };
}
