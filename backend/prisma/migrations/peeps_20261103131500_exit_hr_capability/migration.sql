-- PEEPS: additive capability; preserve every existing HR switch value.
ALTER TABLE hr_capability_switches DROP CONSTRAINT hr_capability_switches_capability_check;
ALTER TABLE hr_capability_switches ADD CONSTRAINT hr_capability_switches_capability_check CHECK (capability IN (
 'VIEW_ATTENDANCE', 'APPROVE_REGULARIZATIONS', 'APPROVE_LEAVE', 'EDIT_MUSTER', 'UPLOAD_MANUAL_MUSTER', 'FINALISE_MONTH', 'CORRECTIONS', 'SHIFT_ROSTER', 'EXCEPTIONS_QUEUE', 'ATTENDANCE_REPORTS', 'LEAVE_REPORTS', 'SEE_LEAVE_COUNTS',
 'SEND_INVITATIONS', 'IMPORT_EMPLOYEE_DETAILS', 'ISSUE_LETTERS_NO_PAY', 'MANAGE_EXITS'));
