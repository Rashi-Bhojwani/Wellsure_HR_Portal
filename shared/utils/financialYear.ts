// The financial year (April to March), decided in one place. "2026-27" is 1 April 2026 to 31 March 2027. Dates are plain YYYY-MM-DD text, never time-zone dependent.

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const FIRST_MONTH = 4;
const MONTHS_IN_YEAR = 12;

export interface FinancialYear {
  /** The label, for example "2026-27". */
  label: string;
  startYear: number;
  /** First day, YYYY-04-01. */
  start: string;
  /** Last day, YYYY+1-03-31. */
  end: string;
}

const pad = (n: number): string => String(n).padStart(2, "0");

export function financialYearStartingIn(startYear: number): FinancialYear {
  return { label: `${startYear}-${pad((startYear + 1) % 100)}`, startYear, start: `${startYear}-04-01`, end: `${startYear + 1}-03-31` };
}

/** The financial year a day belongs to. */
export function financialYearOf(day: string): FinancialYear {
  const m = ISO.exec(day);
  if (!m) throw new Error(`"${day}" is not a date (year-month-day)`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  return financialYearStartingIn(month >= FIRST_MONTH ? year : year - 1);
}

export function parseFinancialYearLabel(label: string): FinancialYear {
  const m = /^(\d{4})-(\d{2})$/.exec(label);
  if (!m) throw new Error(`"${label}" is not a financial year (for example 2026-27)`);
  const fy = financialYearStartingIn(Number(m[1]));
  if (fy.label !== label) throw new Error(`"${label}" is not a financial year: the second part should be ${fy.label.slice(-2)}`);
  return fy;
}

/** Pay months left in the year counting the one that contains `day` (April is 12, March is 1). */
export function monthsLeftInYear(day: string): number {
  const m = ISO.exec(day);
  if (!m) throw new Error(`"${day}" is not a date (year-month-day)`);
  const month = Number(m[2]);
  return month >= FIRST_MONTH ? MONTHS_IN_YEAR - (month - FIRST_MONTH) : FIRST_MONTH - month;
}
