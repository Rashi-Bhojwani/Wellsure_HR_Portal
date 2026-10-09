// Request Hub and Tasks inbox (Phase 5 commit D): the normalised item shapes
// both the backend sources and the frontend lists use. Each module keeps its
// own screens and actions; these lists only point at them.

export const REQUEST_HUB_TYPES = ["LEAVE", "PROFILE_CHANGE", "HELPDESK", "REGULARIZATION"] as const;
export type RequestHubType = (typeof REQUEST_HUB_TYPES)[number];

export const REQUEST_HUB_TYPE_LABELS: Record<RequestHubType, string> = {
  LEAVE: "Leave",
  PROFILE_CHANGE: "Profile change",
  HELPDESK: "Helpdesk",
  REGULARIZATION: "Attendance regularization",
};

// Every source's own statuses map onto two buckets so one filter works
// across all of them: OPEN = still waiting on someone, CLOSED = settled.
export type RequestHubState = "OPEN" | "CLOSED";

export interface RequestHubItem {
  type: RequestHubType;
  id: string;
  title: string;
  detail: string | null;
  status: string; // the source's own status code, e.g. PENDING, IN_PROGRESS
  statusLabel: string;
  state: RequestHubState;
  submittedAt: string;
  updatedAt: string;
  // Set on a resolved helpdesk ticket: when it will close by itself unless
  // the employee replies (user decision 5 — always visible).
  autoClosesAt: string | null;
  link: string; // employee-portal path
}

export const TASK_TYPES = ["LEAVE_APPROVAL", "PROFILE_CHANGE_APPROVAL", "HELPDESK_ASSIGNED", "REGULARIZATION_APPROVAL"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  LEAVE_APPROVAL: "Leave approval",
  PROFILE_CHANGE_APPROVAL: "Profile change approval",
  HELPDESK_ASSIGNED: "Helpdesk ticket",
  REGULARIZATION_APPROVAL: "Attendance regularization",
};

export interface TaskItem {
  type: TaskType;
  id: string;
  title: string;
  detail: string | null;
  employeeName: string | null; // whose request it is
  waitingSince: string;
  link: string; // employee-portal path
  adminLink: string; // admin-portal path
}
