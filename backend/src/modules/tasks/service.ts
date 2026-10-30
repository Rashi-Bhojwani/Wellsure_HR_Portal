import { describeCorrection, REASON_LABEL, type Correction } from "../attendance/regularization/correction";
import type { DataScope } from "@shared/constants/roles";
import type { Prisma } from "@prisma/client";
import { formatTicketNumber, HELPDESK_STATUS_LABELS, helpdeskAdminPath, helpdeskEmployeePath } from "@shared/constants/helpdesk";
import type { TaskItem, TaskType } from "@shared/types/inbox";
import { DIRECTOR_STEP_INFO, type DirectorStep } from "@shared/constants/directorAuthority";
import { prisma } from "../../lib/prisma";
import { approvalEmployeeIdFilter, resolveApprovalReach } from "../leave/scope";
import { getTeamEmployeeIds } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";

// Tasks inbox (spec §7.1 "My Tasks", To do → Tasks — Phase 5 commit D, user
// decision 1): things waiting on ME, with no task schema of its own. Each
// source applies exactly the permission and data-scope rules the screen
// that acts on the item enforces, so the inbox never lists something the
// caller would then be refused. A real task system (assign, due date, done)
// arrives later with onboarding/exit checklists. Regularization approvals
// (P2-E, the forgot-to-punch request) are a source here.

export interface TaskViewer {
  userId: string;
  employeeId: string;
  roleCodes: string[];
  dataScope: DataScope; // resolved per request (lib/permissions.ts)
  permissions: Set<string>;
}

export interface TaskSource {
  type: TaskType;
  list(viewer: TaskViewer, limit: number): Promise<TaskItem[]>;
}

const nameOf = (e: { employeeCode: string; nameHistory: { fullName: string }[] }) => e.nameHistory[0]?.fullName ?? e.employeeCode;
const currentName = () => ({ include: { nameHistory: { where: inForceOn() } } }) as const;
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

// Pending leave I can decide: leave.approve, inside my data scope, never my
// own (approveLeaveRequest refuses self-approval) — plus, while a workflow
// delegation to me is active, the delegator's team's (E3).
const leaveApprovals: TaskSource = {
  type: "LEAVE_APPROVAL",
  async list(viewer, limit) {
    if (!viewer.permissions.has("leave.approve")) return [];
    const scopeFilter = approvalEmployeeIdFilter(await resolveApprovalReach(viewer));
    const where: Prisma.LeaveRequestWhereInput = {
      status: "PENDING",
      AND: [{ employeeId: { not: viewer.employeeId } }, ...(scopeFilter ? [{ employeeId: scopeFilter }] : [])],
    };
    const rows = await prisma.leaveRequest.findMany({ where, include: { leaveType: true, employee: currentName() }, orderBy: { createdAt: "asc" }, take: limit });
    return rows.map((r) => ({
      type: "LEAVE_APPROVAL" as const,
      id: r.id,
      title: `${r.leaveType.name} request`,
      detail: `${dateOnly(r.fromDate)} to ${dateOnly(r.toDate)} · ${r.totalDays.toNumber()} day(s)`,
      employeeName: nameOf(r.employee),
      waitingSince: r.createdAt.toISOString(),
      link: "/app/todo/review",
      adminLink: "/admin/workforce/leave/employee-leave",
    }));
  },
};

// Pending profile change requests: profile.changerequest.approve (org-wide,
// exactly as the Change Requests screen lists them), never my own.
const FIELD_GROUP_LABELS: Record<string, string> = { bank: "Bank details", statutory: "Statutory details", personal: "Personal details" };
const profileChangeApprovals: TaskSource = {
  type: "PROFILE_CHANGE_APPROVAL",
  async list(viewer, limit) {
    if (!viewer.permissions.has("profile.changerequest.approve")) return [];
    const rows = await prisma.profileChangeRequest.findMany({
      where: { status: "PENDING", employeeId: { not: viewer.employeeId } },
      include: { employee: currentName() },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map((r) => ({
      type: "PROFILE_CHANGE_APPROVAL" as const,
      id: r.id,
      title: `${FIELD_GROUP_LABELS[r.fieldGroup] ?? r.fieldGroup} change`,
      detail: null,
      employeeName: nameOf(r.employee),
      waitingSince: r.createdAt.toISOString(),
      link: "/admin/employee/change-requests",
      adminLink: "/admin/employee/change-requests",
    }));
  },
};

// Helpdesk tickets assigned to me that still need HR: not resolved, not
// closed, not waiting on the employee. Sensitive ones only with
// helpdesk.sensitive.view (an assignment made before the permission was
// removed mustn't leak the ticket here).
const assignedTickets: TaskSource = {
  type: "HELPDESK_ASSIGNED",
  async list(viewer, limit) {
    if (!viewer.permissions.has("helpdesk.manage")) return [];
    const rows = await prisma.helpdeskTicket.findMany({
      where: {
        assigneeEmployeeId: viewer.employeeId,
        status: { in: ["OPEN", "IN_PROGRESS"] },
        raisedByEmployeeId: { not: viewer.employeeId },
        ...(!viewer.permissions.has("helpdesk.sensitive.view") && { category: { isSensitive: false } }),
      },
      include: { category: true, raisedBy: currentName() },
      orderBy: { lastActivityAt: "asc" },
      take: limit,
    });
    return rows.map((t) => ({
      type: "HELPDESK_ASSIGNED" as const,
      id: t.id,
      title: `${formatTicketNumber(t.number)} · ${t.subject}`,
      detail: `${t.category.name} · ${HELPDESK_STATUS_LABELS[t.status]}`,
      employeeName: nameOf(t.raisedBy),
      waitingSince: t.lastActivityAt.toISOString(),
      link: helpdeskEmployeePath(t.id),
      adminLink: helpdeskAdminPath(t.id),
    }));
  },
};

// Pending attendance corrections I can decide (P2-E, generalised in Phase 3): the approve key, my
// data scope (TEAM: my reports), never my own — as the queue enforces.
const regularizationApprovals: TaskSource = {
  type: "REGULARIZATION_APPROVAL",
  async list(viewer, limit) {
    if (!viewer.permissions.has("attendance.regularization.approve") || viewer.dataScope === "SELF") return [];
    const employeeId = viewer.dataScope === "ALL" ? { not: viewer.employeeId } : { in: await getTeamEmployeeIds(viewer.employeeId) };
    const rows = await prisma.regularizationRequest.findMany({ where: { status: "PENDING", employeeId }, include: { employee: currentName() }, orderBy: { createdAt: "asc" }, take: limit });
    return rows.map((r) => ({
      type: "REGULARIZATION_APPROVAL" as const,
      id: r.id,
      title: `Attendance correction: ${REASON_LABEL[r.reasonCode] ?? r.reasonCode}`,
      detail: `${dateOnly(r.date)} · asks for ${describeCorrection({ inTime: r.inTime, outTime: r.outTime, status: r.targetStatus as Correction["status"] })}`,
      employeeName: nameOf(r.employee),
      waitingSince: r.createdAt.toISOString(),
      link: "/app/todo/review?tab=attendance",
      adminLink: "/admin/workforce/attendance/regularizations",
    }));
  },
};

// What the other director did on their own authority and I have not acknowledged yet (docs/plans/DIRECTOR_AUTHORITY.md §6). Counts only: no amounts, no names.
const directorNotices: TaskSource = {
  type: "DIRECTOR_NOTICE",
  async list(viewer, limit) {
    if (!viewer.roleCodes.includes("SUPER_ADMIN")) return [];
    const rows = await prisma.directorActionReceipt.findMany({ where: { recipientUserId: viewer.userId, acknowledgedAt: null }, include: { notice: true }, orderBy: { createdAt: "asc" }, take: limit });
    return rows.map((r) => ({
      type: "DIRECTOR_NOTICE" as const,
      id: r.noticeId,
      title: r.notice.kind === "SWITCH_CHANGED" ? "A second-director check was changed" : "The other director acted on their own authority",
      detail: `${DIRECTOR_STEP_INFO[r.notice.step as DirectorStep]?.label ?? r.notice.step} · ${r.notice.subjectLabel}${r.notice.itemCount != null ? ` · ${r.notice.itemCount}` : ""}`,
      employeeName: null,
      waitingSince: r.notice.createdAt.toISOString(),
      link: "/admin/admin-tools/settings",
      adminLink: "/admin/admin-tools/settings",
    }));
  },
};

export const TASK_SOURCES: TaskSource[] = [leaveApprovals, profileChangeApprovals, assignedTickets, regularizationApprovals, directorNotices];

// Oldest-waiting first: the inbox is a queue, not a feed.
export async function listMyTasks(viewer: TaskViewer, limit = 100): Promise<TaskItem[]> {
  const lists = await Promise.all(TASK_SOURCES.map((s) => s.list(viewer, limit)));
  return lists.flat().sort((a, b) => a.waitingSince.localeCompare(b.waitingSince)).slice(0, limit);
}
