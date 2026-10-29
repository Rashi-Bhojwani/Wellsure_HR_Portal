import { statusTone } from "../../../../components/attendance/statusTone";

// Shared by the muster grid and its legend (Phase 2 P2-D).

export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

export interface CellTone {
  background: string;
  color: string;
}

/** Colours per code, from the attendanceStatusColor tokens (CSS variables, so dark mode follows). Kept as a hook-shaped helper for its callers. */
export function useCellTones() {
  return (code: string | null): CellTone => {
    const t = statusTone(code);
    return { background: t.bg, color: t.fg };
  };
}
