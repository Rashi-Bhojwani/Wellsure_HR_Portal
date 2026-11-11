import { displayLeaveForViewer, type LeaveViewerLevel } from "@shared/leave/display";
import { businessToday } from "../../lib/businessDate";
import { namesOn, placementsOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { listQueue, decideRequest } from "../attendance/regularization/service";
import { approveLeaveRequest, listLeaveRequests, rejectLeaveRequest } from "../leave/requests";
import type { ParityMeta, ParityViewer } from "../parity/types";

// A-10 G7 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 16): one Workflow screen for leave and attendance regularizations.
// * Review: what is waiting on me (pending) and what I decided (completed). Pending lists come from the existing queues, so who may see and decide what is
//   exactly the existing rule (scope, delegations, reviewers, HR switches); nothing is widened here.
// * Monitor: pending items I can see company-wide but that wait on someone else — only for a company-wide viewer — with who they wait on.
// * Bulk decisions call the existing decision functions one item at a time (each checked, audited and idempotent on its own); one failure never stops the
//   rest, and each item's result is returned.
// Every leave type and reason shown goes through displayLeaveForViewer (shared/leave/display.ts).

export type WorkflowType = "LEAVE" | "REGULARIZATION";
export const MAX_BULK = 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

const levelOf = (v: ParityViewer): LeaveViewerLevel => (v.roleCodes.some((c) => c === "SUPER_ADMIN" || c === "HR_ADMIN" || c === "HR_EXECUTIVE") ? "HR" : "BELOW_HR");

export interface WorkflowItem {
  id: string;
  type: WorkflowType;
  employeeId: string;
  employeeCode: string;
  name: string;
  what: string;
  when: string;
  reason: string | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  waitingOn?: string | null;
}

function searchHit(item: WorkflowItem, search?: string) {
  if (!search) return true;
  const s = search.toLowerCase();
  return item.name.toLowerCase().includes(s) || item.employeeCode.toLowerCase().includes(s) || item.what.toLowerCase().includes(s);
}

async function leaveItems(viewer: ParityViewer, rows: Array<{ id: string; employeeId: string; employeeCode: string; employeeName: string; leaveTypeCode: string; leaveTypeName: string; fromDate: string; toDate: string; totalDays: number; reason: string | null; status: string; createdAt?: string; decidedAt: string | null }>): Promise<WorkflowItem[]> {
  const level = levelOf(viewer);
  return rows.map((r) => {
    const shown = displayLeaveForViewer({ leaveTypeCode: r.leaveTypeCode, leaveTypeName: r.leaveTypeName, reason: r.reason }, level);
    return { id: r.id, type: "LEAVE" as const, employeeId: r.employeeId, employeeCode: r.employeeCode, name: r.employeeName, what: `${shown.typeLabel} · ${r.totalDays} day${r.totalDays === 1 ? "" : "s"}`, when: r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} to ${r.toDate}`, reason: shown.reason, status: r.status, createdAt: r.createdAt ?? "", decidedAt: r.decidedAt };
  });
}

export async function review(viewer: ParityViewer, q: { type: WorkflowType; state: "PENDING" | "COMPLETED"; search?: string }) {
  let items: WorkflowItem[] = [];
  if (q.type === "LEAVE") {
    if (!viewer.permissions.has("leave.approve")) throw new HttpError(403, "Missing permission: leave.approve", "FORBIDDEN");
    if (q.state === "PENDING") {
      const res = await listLeaveRequests({ status: "PENDING", page: 1, pageSize: 500 } as Parameters<typeof listLeaveRequests>[0], viewer);
      const rows = res.rows.filter((r) => r.employeeId !== viewer.employeeId);
      items = await leaveItems(viewer, rows);
    } else {
      const rows = await prisma.leaveRequest.findMany({ where: { decidedByUserId: viewer.userId, status: { in: ["APPROVED", "REJECTED"] } }, include: { leaveType: true, employee: { select: { employeeCode: true } } }, orderBy: { decidedAt: "desc" }, take: 300 });
      const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday());
      items = await leaveItems(viewer, rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, employeeName: names.get(r.employeeId) ?? r.employee.employeeCode, leaveTypeCode: r.leaveType.code, leaveTypeName: r.leaveType.name, fromDate: iso(r.fromDate), toDate: iso(r.toDate), totalDays: r.totalDays.toNumber(), reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null })));
    }
  } else {
    if (!viewer.permissions.has("attendance.regularization.approve")) throw new HttpError(403, "Missing permission: attendance.regularization.approve", "FORBIDDEN");
    if (q.state === "PENDING") {
      const rows = (await listQueue(viewer, { status: "PENDING" })).filter((r) => r.employeeId !== viewer.employeeId && r.canDecide);
      items = rows.map((r) => ({ id: r.id, type: "REGULARIZATION" as const, employeeId: r.employeeId, employeeCode: r.employeeCode, name: r.name, what: `${r.reasonLabel}: ${r.correctionText}`, when: r.date, reason: r.reason || null, status: r.status, createdAt: r.createdAt, decidedAt: r.decidedAt }));
    } else {
      const rows = await prisma.regularizationRequest.findMany({ where: { decidedByUserId: viewer.userId, status: { in: ["APPROVED", "REJECTED"] } }, include: { employee: { select: { employeeCode: true } } }, orderBy: { decidedAt: "desc" }, take: 300 });
      const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday());
      items = rows.map((r) => ({ id: r.id, type: "REGULARIZATION" as const, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, name: names.get(r.employeeId) ?? r.employee.employeeCode, what: r.reasonCode, when: iso(r.date), reason: r.reason || null, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null }));
    }
  }
  return { items: items.filter((i) => searchHit(i, q.search)) };
}

/** Company-wide viewers only: pending items waiting on someone else, and who (the person's reporting manager today, or "HR" when there is none). */
export async function monitor(viewer: ParityViewer, q: { type: WorkflowType; search?: string }) {
  const broad = q.type === "LEAVE" ? viewer.permissions.has("leave.view") : viewer.permissions.has("attendance.regularization.view") || viewer.permissions.has("attendance.regularization.approve");
  if (!broad || viewer.dataScope !== "ALL") throw new HttpError(403, "Only a company-wide viewer can monitor others' approvals.", "FORBIDDEN");
  const mine = new Set((await review(viewer, { type: q.type, state: "PENDING" }).catch(() => ({ items: [] as WorkflowItem[] }))).items.map((i) => i.id));
  let items: WorkflowItem[];
  if (q.type === "LEAVE") {
    const rows = await prisma.leaveRequest.findMany({ where: { status: "PENDING", id: { notIn: [...mine] } }, include: { leaveType: true, employee: { select: { employeeCode: true } } }, orderBy: { createdAt: "asc" }, take: 500 });
    const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday());
    items = await leaveItems(viewer, rows.map((r) => ({ id: r.id, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, employeeName: names.get(r.employeeId) ?? r.employee.employeeCode, leaveTypeCode: r.leaveType.code, leaveTypeName: r.leaveType.name, fromDate: iso(r.fromDate), toDate: iso(r.toDate), totalDays: r.totalDays.toNumber(), reason: r.reason, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: null })));
  } else {
    const rows = await prisma.regularizationRequest.findMany({ where: { status: "PENDING", id: { notIn: [...mine] } }, include: { employee: { select: { employeeCode: true } } }, orderBy: { createdAt: "asc" }, take: 500 });
    const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday());
    items = rows.map((r) => ({ id: r.id, type: "REGULARIZATION" as const, employeeId: r.employeeId, employeeCode: r.employee.employeeCode, name: names.get(r.employeeId) ?? r.employee.employeeCode, what: r.reasonCode, when: iso(r.date), reason: r.reason || null, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: null }));
  }
  const placed = await placementsOn([...new Set(items.map((i) => i.employeeId))], businessToday());
  for (const i of items) i.waitingOn = placed.get(i.employeeId)?.reportingManager ?? "HR (no reporting manager)";
  return { items: items.filter((i) => searchHit(i, q.search)) };
}

export async function decideMany(viewer: ParityViewer, input: { type: WorkflowType; ids: string[]; approve: boolean; note?: string | null }, meta: ParityMeta) {
  const ids = [...new Set(input.ids)];
  if (ids.length === 0 || ids.length > MAX_BULK) throw new HttpError(400, `Choose 1 to ${MAX_BULK} requests.`, "VALIDATION_ERROR");
  if (!input.approve && !(input.note ?? "").trim()) throw new HttpError(400, "Say why they are rejected (it is shown to the people asking).", "VALIDATION_ERROR");
  const results: Array<{ id: string; ok: boolean; error?: string; code?: string }> = [];
  for (const id of ids) {
    try {
      if (input.type === "LEAVE") {
        if (input.approve) await approveLeaveRequest(id, viewer, input.note?.trim() || undefined, { actorUserId: meta.actorUserId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
        else await rejectLeaveRequest(id, viewer, input.note!.trim(), { actorUserId: meta.actorUserId, ipAddress: meta.ipAddress, userAgent: meta.userAgent });
      } else {
        await decideRequest(viewer, id, { approve: input.approve, note: input.note ?? null }, { actorUserId: meta.actorUserId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null });
      }
      results.push({ id, ok: true });
    } catch (err) {
      const e = err as { message?: string; code?: string };
      results.push({ id, ok: false, error: e.message ?? "Failed", code: e.code });
    }
  }
  return { decided: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
}
