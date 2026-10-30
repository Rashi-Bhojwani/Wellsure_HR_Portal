-- One more HR switch: "See leave counts" (governs leave.view). Default is as today: HR holds the key until a director switches it off.
ALTER TABLE "hr_capability_switches" DROP CONSTRAINT "hr_capability_switches_capability_check";
ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_capability_check" CHECK ("capability" IN (
  'VIEW_ATTENDANCE', 'APPROVE_REGULARIZATIONS', 'APPROVE_LEAVE', 'EDIT_MUSTER', 'UPLOAD_MANUAL_MUSTER', 'FINALISE_MONTH', 'CORRECTIONS', 'SHIFT_ROSTER', 'EXCEPTIONS_QUEUE', 'ATTENDANCE_REPORTS', 'LEAVE_REPORTS', 'SEE_LEAVE_COUNTS'));
