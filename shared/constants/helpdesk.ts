// Phase 5 commit D — Helpdesk constants shared by backend and frontend.
// The day counts are admin-editable System Settings; these are only the
// defaults a fresh install starts from.

export const HELPDESK_STATUSES = ["OPEN", "IN_PROGRESS", "WAITING_ON_EMPLOYEE", "RESOLVED", "CLOSED"] as const;
export type HelpdeskStatus = (typeof HELPDESK_STATUSES)[number];

export const HELPDESK_STATUS_LABELS: Record<HelpdeskStatus, string> = {
  OPEN: "Open",
  IN_PROGRESS: "In progress",
  WAITING_ON_EMPLOYEE: "Waiting on you",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
};

export const HELPDESK_PRIORITIES = ["LOW", "NORMAL", "HIGH"] as const;
export type HelpdeskPriority = (typeof HELPDESK_PRIORITIES)[number];

// A Resolved ticket closes automatically after this many quiet days...
export const DEFAULT_HELPDESK_AUTO_CLOSE_DAYS = 7;
// ...and the employee may reopen a Resolved/Closed ticket within this many
// days of it being resolved.
export const DEFAULT_HELPDESK_REOPEN_WINDOW_DAYS = 7;

export function formatTicketNumber(n: number): string {
  return `HD-${String(n).padStart(6, "0")}`;
}

// Where a ticket lives in each portal — used for notification links, the
// Request Hub, the Tasks inbox and the frontend routes, so they can't drift.
export const helpdeskEmployeePath = (ticketId: string) => `/app/helpdesk/${ticketId}`;
export const helpdeskAdminPath = (ticketId: string) => `/admin/employee/helpdesk/${ticketId}`;
