import type { PermissionKey } from "./permissions";

// The HR capability switches (docs/plans/HR_CAPABILITIES.md §1B). A director turns each of these on or off for HR, per role or per named person. Each is a named set of
// permission keys; lib/hrCapabilities.ts applies the switches inside resolveAccess, so every route, service check, socket room, task count and menu follows with no per-place code.
//
// A key here must never be in HR_FORBIDDEN_KEYS (a test pins that): a switch can take a duty away from HR or give it back, but it can never give HR pay data.

export const HR_CAPABILITY_IDS = [
  "VIEW_ATTENDANCE",
  "APPROVE_REGULARIZATIONS",
  "APPROVE_LEAVE",
  "EDIT_MUSTER",
  "UPLOAD_MANUAL_MUSTER",
  "FINALISE_MONTH",
  "CORRECTIONS",
  "SHIFT_ROSTER",
  "EXCEPTIONS_QUEUE",
  "ATTENDANCE_REPORTS",
  "LEAVE_REPORTS",
  "SEE_LEAVE_COUNTS",
  "SEND_INVITATIONS",
  "IMPORT_EMPLOYEE_DETAILS",
  "ISSUE_LETTERS_NO_PAY",
] as const;
export type HrCapabilityId = (typeof HR_CAPABILITY_IDS)[number];

export interface HrCapability {
  id: HrCapabilityId;
  label: string;
  /** In words an owner understands: what HR can do while it is on. */
  what: string;
  keys: readonly PermissionKey[];
}

export const HR_CAPABILITIES: readonly HrCapability[] = [
  { id: "VIEW_ATTENDANCE", label: "View individual attendance", what: "Open any employee's attendance calendar and day, Who Is In?, and the raw punch log.", keys: ["attendance.view", "attendance.swipes.view"] },
  { id: "APPROVE_REGULARIZATIONS", label: "Approve regularizations", what: "See and decide attendance regularization requests (forgot to punch).", keys: ["attendance.regularization.view", "attendance.regularization.approve"] },
  { id: "APPROVE_LEAVE", label: "Approve leave", what: "Approve, reject and cancel leave requests.", keys: ["leave.approve"] },
  { id: "EDIT_MUSTER", label: "Edit muster", what: "Enter or change attendance by hand for manual-capture branches.", keys: ["attendance.manual.enter"] },
  { id: "UPLOAD_MANUAL_MUSTER", label: "Upload manual-branch muster", what: "Upload the manual-branch muster workbook. Also needs Edit muster.", keys: ["attendance.manual.upload"] },
  { id: "FINALISE_MONTH", label: "Finalise a month", what: "Lock a finished attendance cycle so it can reach payroll.", keys: ["attendance.finalise"] },
  { id: "CORRECTIONS", label: "Corrections", what: "Correct many employee-days at once, and set a day's status or shift directly.", keys: ["attendance.regularization.bulk", "attendance.override.manage"] },
  { id: "SHIFT_ROSTER", label: "Shift roster", what: "Plan and publish the shift roster.", keys: ["attendance.roster.manage"] },
  { id: "EXCEPTIONS_QUEUE", label: "Exceptions queue", what: "Work the Attendance Exceptions queue.", keys: ["attendance.exceptions.view"] },
  { id: "ATTENDANCE_REPORTS", label: "Attendance reports", what: "Open and download the attendance reports.", keys: ["reports.attendance.view"] },
  { id: "LEAVE_REPORTS", label: "Leave reports", what: "Open and download the leave reports (balances, loss of pay).", keys: ["reports.leave.view"] },
  { id: "SEE_LEAVE_COUNTS", label: "See leave counts", what: "See other people's leave balances and ledgers, the leave dashboard and the org-wide leave calendar. Approving leave is its own switch and is not affected.", keys: ["leave.view"] },
  { id: "SEND_INVITATIONS", label: "Send invitations", what: "Send and resend sign-in invitations to employees. No pay data is involved.", keys: ["invitations.send"] },
  { id: "IMPORT_EMPLOYEE_DETAILS", label: "Import employee details", what: "Import org masters, employees and leave grants from a spreadsheet. A file with a salary, bank or statutory column is refused; those imports are the directors'.", keys: ["import.details.manage"] },
  { id: "ISSUE_LETTERS_NO_PAY", label: "Issue letters without pay figures", what: "Issue a letter only from a template the system has checked contains no pay figure (and no field that could carry one). Letters that carry a CTC or any pay figure are the directors'.", keys: ["letters.issue.nopay"] },
];

export const hrCapability = (id: string): HrCapability | undefined => HR_CAPABILITIES.find((c) => c.id === id);

export const HR_SWITCH_STATES = ["ON", "OFF", "DEFAULT"] as const;
export type HrSwitchState = (typeof HR_SWITCH_STATES)[number];
export const HR_SWITCH_SUBJECT_KINDS = ["ROLE", "USER"] as const;
export type HrSwitchSubjectKind = (typeof HR_SWITCH_SUBJECT_KINDS)[number];

/**
 * Keys split out of an older key so a switch can govern them alone. Everyone who held the parent holds the child (the migration copied roles and per-user grants and revokes; withSplitKeys
 * does the same for the default role definitions), so on the day this shipped nothing changed for anybody.
 */
export const SPLIT_KEYS: ReadonlyArray<{ child: PermissionKey; parent: PermissionKey }> = [
  { child: "attendance.manual.upload", parent: "attendance.manual.enter" },
  { child: "attendance.roster.manage", parent: "attendance.config.manage" },
  { child: "attendance.exceptions.view", parent: "attendance.view" },
  { child: "reports.attendance.view", parent: "reports.view" },
  { child: "reports.leave.view", parent: "reports.view" },
  { child: "invitations.send", parent: "employee.create" },
];

export function withSplitKeys(keys: readonly string[]): string[] {
  const out = new Set(keys);
  for (const { child, parent } of SPLIT_KEYS) if (out.has(parent)) out.add(child);
  return [...out];
}
