// Business-date helpers, Asia/Kolkata (fixed UTC+5:30, no DST — spec §1/
// CLAUDE.md's timezone rule), operating on UTC-midnight Dates — the same
// representation @db.Date columns round-trip as. Never use local-time
// Date methods (setDate/getDate/setMonth) for this kind of arithmetic:
// they read/write in the server process's own timezone, which can differ
// from Asia/Kolkata and would silently shift a business date by a day.

// Tests only: pretend today is `day` (null = the real clock), to check that
// a change dated D+7 takes effect on D+7 and not before. Refuses to run
// outside vitest, so production can never have its clock moved.
let testToday: Date | null = null;
export function setBusinessTodayForTests(day: Date | null): void {
  if (!process.env.VITEST) throw new Error("setBusinessTodayForTests is for tests only.");
  testToday = day;
}

// "Today" in the business timezone, truncated to UTC midnight. Computing
// this from the server's own (likely UTC) clock without the offset would
// let a scheduled job (separations, leave accrual, comp-off expiry) fire
// up to 5.5h early or late.
export function businessToday(): Date {
  if (testToday) return testToday;
  const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
  const nowIst = new Date(Date.now() + IST_OFFSET_MS);
  return new Date(Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate()));
}

export function addCalendarDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

export function addCalendarMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
}

// The 1st of the month containing `date`, at UTC midnight.
export function startOfMonthUTC(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
