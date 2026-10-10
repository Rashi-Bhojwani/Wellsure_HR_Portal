// Plain-string date and time helpers for the simulator. Business time is
// Asia/Kolkata with no daylight saving, so a business date plus seconds on its
// timeline is all the simulator ever needs: no JavaScript Date in the time
// arithmetic, no time zone to get wrong.

export const DAY = 86_400;

export function secondsOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 3600 + m! * 60;
}

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** "HH:MM:SS" for seconds on a timeline (wraps past midnight). */
export function hms(seconds: number): string {
  const s = ((seconds % DAY) + DAY) % DAY;
  return `${pad2(Math.floor(s / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function datesBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/** 0 = Sunday. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

/** 1st..5th occurrence of this date's weekday in its month. */
export function occurrenceOf(date: string): number {
  return Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1;
}

/** The device-local text a punch at `seconds` on `date`'s timeline carries ("YYYY-MM-DD HH:MM:SS"). */
export function localText(date: string, seconds: number): string {
  return `${addDays(date, Math.floor(seconds / DAY))} ${hms(seconds)}`;
}

export const minutes = (m: number) => m * 60;
export const ceilMin = (s: number) => Math.ceil(s / 60);
export const floorMin = (s: number) => Math.floor(s / 60);
