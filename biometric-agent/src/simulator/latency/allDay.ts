import type { ServerApi } from "../serverApi";

// The latency test must not depend on the hour it runs at (user, 2026-10-15). It punches "now", and "now" is only inside
// a person's punch window during the working day: at 00:10 IST the General shift's window for today has not opened
// and yesterday's is closing, so the punch is filed against yesterday and today's screens, rightly, never show it.
// That is correct behaviour and not what this test is about: it measures how fast a punch that IS filed reaches the screen.
//
// So the measured people are given an all-day shift for yesterday and today through Shift Override (the HR feature),
// with no margin either side, so that any moment between 00:00 and 23:59 is inside exactly one window and cannot be
// attributed to the other day. The overrides are cleared and the shift deactivated afterwards. Only the clock's
// last few minutes are left out (see `msUntilClearOfMidnight`): a run must not straddle midnight.

export const ALL_DAY_SHIFT_CODE = "LATENCY24";
const MIDNIGHT_GUARD_FROM = 23 * 3600 + 55 * 60; // seconds into the day
const AFTER_MIDNIGHT = 30; // seconds past 00:00 to resume

/** How long to wait so that a few-minute run does not straddle midnight: 0 unless it is 23:55 or later. `timeOfDay` is "HH:MM:SS". */
export function msUntilClearOfMidnight(timeOfDay: string): number {
  const [h, m, s] = timeOfDay.split(":").map(Number) as [number, number, number];
  const seconds = h * 3600 + m * 60 + s;
  return seconds >= MIDNIGHT_GUARD_FROM ? (86_400 - seconds + AFTER_MIDNIGHT) * 1000 : 0;
}

const dayBefore = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

interface ShiftRow {
  id: string;
  code: string;
}

export interface AllDay {
  /** The people it was applied to. */
  codes: string[];
  restore(): Promise<void>;
}

/**
 * Gives these people (employee codes) the all-day shift for `today` and the day before. HR must hold attendance.override.manage
 * and none of them may be HR themselves (nobody overrides their own shift). Returns what is needed to undo it.
 */
export async function openTheDay(api: ServerApi, today: string, codes: string[]): Promise<AllDay> {
  const { shifts } = await api.request<{ shifts: ShiftRow[] }>("GET", "/api/attendance/config/shifts");
  let shift: ShiftRow | undefined = shifts.find((s) => s.code === ALL_DAY_SHIFT_CODE);
  if (!shift) {
    shift = await api.request<ShiftRow>("POST", "/api/attendance/config/shifts", {
      json: {
        code: ALL_DAY_SHIFT_CODE,
        name: "Latency test (open all day)",
        startTime: "00:00",
        endTime: "23:59",
        graceInMinutes: 0,
        graceOutMinutes: 0,
        windowBeforeMinutes: 0,
        windowAfterMinutes: 0,
        sessions: [{ kind: "WORK", label: "All day", startTime: "00:00", endTime: "23:59" }],
      },
    });
  } else {
    await api.request("PATCH", `/api/attendance/config/shifts/${shift.id}`, { json: { isActive: true } });
  }
  const ids: string[] = [];
  for (const code of codes) {
    const found = await api.request<{ rows: Array<{ id: string; employeeCode: string }> }>("GET", `/api/employees?search=${encodeURIComponent(code)}&pageSize=10`);
    const row = found.rows.find((r) => r.employeeCode === code);
    if (!row) throw new Error(`Employee ${code} was not found, so the day cannot be opened for them.`);
    ids.push(row.id);
  }
  const body = { selection: { employeeIds: ids }, from: dayBefore(today), to: today, shiftId: shift.id, note: "Latency test: open all day so the hour it runs at does not matter" };
  const preview = await api.request<{ count: number; fingerprint: string }>("POST", "/api/attendance/shift-overrides/preview", { json: body });
  if (preview.count === 0) throw new Error("The all-day shift could not be applied to any of the measured people (are they all on it already, or finalised?).");
  await api.request("POST", "/api/attendance/shift-overrides", { json: { ...body, fingerprint: preview.fingerprint, confirm: true } });
  return {
    codes,
    async restore() {
      for (const id of ids) {
        for (const date of [dayBefore(today), today]) {
          await api.request("POST", "/api/attendance/shift-overrides/clear", { json: { employeeId: id, date, note: "Latency test finished: back to the usual shift" } }).catch(() => undefined);
        }
      }
      await api.request("PATCH", `/api/attendance/config/shifts/${shift!.id}`, { json: { isActive: false } }).catch(() => undefined);
    },
  };
}
