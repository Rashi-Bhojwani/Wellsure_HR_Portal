import type { UploadFile } from "antd";
import type { HelpdeskTicketSummary } from "../../api/helpdesk";
import { formatDate } from "../../lib/dates";

// One line for lists: a resolved ticket always says when it closes by itself
// (user decision 5) — a ticket never vanishes unexplained.
export function lifecycleHint(t: Pick<HelpdeskTicketSummary, "status" | "autoClosesAt" | "reopenUntil">): string | null {
  if (t.status === "RESOLVED" && t.autoClosesAt) return `Closes automatically on ${formatDate(t.autoClosesAt)} unless you reply`;
  if (t.status === "CLOSED" && t.reopenUntil && new Date(t.reopenUntil) > new Date()) return `Can be reopened until ${formatDate(t.reopenUntil)}`;
  return null;
}

// The browser File objects behind AntD's upload list (files are held
// client-side and sent with the message, never uploaded on their own).
export const toFiles = (list: UploadFile[]) => list.map((f) => f.originFileObj).filter((f): f is NonNullable<typeof f> => Boolean(f)) as File[];
