import { formatTicketNumber, HELPDESK_STATUS_LABELS, helpdeskEmployeePath } from "@shared/constants/helpdesk";
import type { RequestHubItem, RequestHubState, RequestHubType } from "@shared/types/inbox";
import type { HelpdeskTicketStatus } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { autoCloseAt, getHelpdeskSettings } from "../../lib/helpdeskSettings";

// Request Hub (spec §6, Phase 5 commit D): everything I have asked for, from
// every module, as one list. Always SELF — this is "my requests", never a
// management view, so each source filters on the caller's own employeeId
// and nothing else. Actions stay on each module's own screen; items link
// there.
//
// Sources plug in through REQUEST_HUB_SOURCES: attendance regularizations
// (Phase 3) and reimbursements (Phase 6) add a source here and a type to
// shared/types/inbox.ts, and nothing else changes.

export interface RequestHubSource {
  type: RequestHubType;
  // The caller's most recent `limit` items of this type, already narrowed
  // to `state` in the query itself (filtering after the limit would drop
  // older matches).
  list(employeeId: string, state: RequestHubState | undefined, limit: number): Promise<RequestHubItem[]>;
}

const titleCase = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const iso = (d: Date) => d.toISOString();
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

const leaveSource: RequestHubSource = {
  type: "LEAVE",
  async list(employeeId, state, limit) {
    const rows = await prisma.leaveRequest.findMany({
      where: { employeeId, ...(state === "OPEN" && { status: "PENDING" }), ...(state === "CLOSED" && { status: { not: "PENDING" } }) },
      include: { leaveType: true },
      orderBy: { updatedAt: "desc" },
      take: limit,
    });
    return rows.map((r) => ({
      type: "LEAVE" as const,
      id: r.id,
      title: r.leaveType.name,
      detail: `${dateOnly(r.fromDate)} to ${dateOnly(r.toDate)} · ${r.totalDays.toNumber()} day(s)`,
      status: r.status,
      statusLabel: titleCase(r.status),
      state: (r.status === "PENDING" ? "OPEN" : "CLOSED") as RequestHubState,
      submittedAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
      autoClosesAt: null,
      link: "/app/leave/apply",
    }));
  },
};

const FIELD_GROUP_LABELS: Record<string, string> = { bank: "Bank details", statutory: "Statutory details", personal: "Personal details" };

const profileChangeSource: RequestHubSource = {
  type: "PROFILE_CHANGE",
  async list(employeeId, state, limit) {
    const rows = await prisma.profileChangeRequest.findMany({
      where: { employeeId, ...(state === "OPEN" && { status: "PENDING" }), ...(state === "CLOSED" && { status: { not: "PENDING" } }) },
      orderBy: { createdAt: "desc" }, take: limit });
    return rows.map((r) => ({
      type: "PROFILE_CHANGE" as const,
      id: r.id,
      title: `${FIELD_GROUP_LABELS[r.fieldGroup] ?? titleCase(r.fieldGroup)} change`,
      detail: r.remarks,
      status: r.status,
      statusLabel: titleCase(r.status),
      state: (r.status === "PENDING" ? "OPEN" : "CLOSED") as RequestHubState,
      submittedAt: iso(r.createdAt),
      updatedAt: iso(r.decidedAt ?? r.createdAt),
      autoClosesAt: null,
      link: "/app/profile",
    }));
  },
};

const helpdeskSource: RequestHubSource = {
  type: "HELPDESK",
  async list(employeeId, state, limit) {
    const settled: HelpdeskTicketStatus[] = ["RESOLVED", "CLOSED"];
    const [rows, settings] = await Promise.all([
      prisma.helpdeskTicket.findMany({
        where: {
          raisedByEmployeeId: employeeId,
          ...(state === "OPEN" && { status: { notIn: settled } }),
          ...(state === "CLOSED" && { status: { in: settled } }),
        },
        include: { category: true }, orderBy: { lastActivityAt: "desc" }, take: limit }),
      getHelpdeskSettings(),
    ]);
    return rows.map((t) => ({
      type: "HELPDESK" as const,
      id: t.id,
      title: `${formatTicketNumber(t.number)} · ${t.subject}`,
      detail: t.category.name,
      status: t.status,
      statusLabel: HELPDESK_STATUS_LABELS[t.status],
      state: (t.status === "RESOLVED" || t.status === "CLOSED" ? "CLOSED" : "OPEN") as RequestHubState,
      submittedAt: iso(t.createdAt),
      updatedAt: iso(t.lastActivityAt),
      // A resolved ticket always says when it will close by itself (user
      // decision 5) — here as well as on the ticket itself.
      autoClosesAt: t.status === "RESOLVED" && t.resolvedAt ? iso(autoCloseAt(t.resolvedAt, settings)) : null,
      link: helpdeskEmployeePath(t.id),
    }));
  },
};

export const REQUEST_HUB_SOURCES: RequestHubSource[] = [leaveSource, profileChangeSource, helpdeskSource];

export interface RequestHubQuery {
  type?: RequestHubType;
  state?: RequestHubState;
  limit: number;
}

export async function listMyRequests(employeeId: string, query: RequestHubQuery): Promise<RequestHubItem[]> {
  const sources = REQUEST_HUB_SOURCES.filter((s) => !query.type || s.type === query.type);
  const lists = await Promise.all(sources.map((s) => s.list(employeeId, query.state, query.limit)));
  return lists
    .flat()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, query.limit);
}
