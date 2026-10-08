import { MusterPage } from "../../admin/attendance/muster/MusterPage";

// Attendance → Mark Attendance (Phase 2 P2-D): the Attendance Muster for a
// manager who marks a branch by hand — the same grid, limited by the API to
// the branches assigned to them.
export function MarkAttendancePage() {
  return <MusterPage title="Mark Attendance" />;
}
