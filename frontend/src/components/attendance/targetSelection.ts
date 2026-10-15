import type { Selection } from "../../api/attendanceAdmin";

export interface TargetValues {
  who?: "GROUP" | "LIST";
  locationId?: string;
  departmentId?: string;
  employeeIds?: string[];
}

/** The selection the server takes, or an error to show. A fixed person (opened from a day) needs no picking. */
export function selectionOf(v: TargetValues, fixedEmployeeId?: string): { selection?: Selection; error?: string } {
  if (fixedEmployeeId) return { selection: { employeeIds: [fixedEmployeeId] } };
  if ((v.who ?? "GROUP") === "LIST") {
    return (v.employeeIds ?? []).length ? { selection: { employeeIds: v.employeeIds } } : { error: "Choose at least one employee." };
  }
  return v.locationId || v.departmentId ? { selection: { locationId: v.locationId, departmentId: v.departmentId } } : { error: "Choose a branch, a department, or switch to specific employees." };
}
