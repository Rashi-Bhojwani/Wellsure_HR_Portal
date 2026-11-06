import { Prisma } from "@prisma/client";
import { writeAuditLogs } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { businessToday } from "../../lib/businessDate";
import { assignmentsBetween, rowInForce } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { requestRecompute } from "../attendance/recompute";
import { loadShiftOverrides } from "../attendance/shiftOverrides";
import type { ParityMeta, ParityViewer } from "../parity/types";

// A-10 G5 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 13, 14).
// * Swipe decisions: reject a punch with a reason (the engine then ignores it) or reinstate it. Append-only; the latest decision of a punch is in force.
//   Only for people in the viewer's scope; never the viewer's own punches; the affected days are worked out again. No location, device identifiers or map
//   links are added anywhere (owner: NOT WANTED).
// * Device sync requests: ask the agent that reads a device to read it again for a date range; the agent picks the oldest pending one up on its heartbeat
//   and reports it done; the server's duplicate key drops what it already has.

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
export const MAX_SWIPE_BATCH = 500;
export const MAX_SYNC_DAYS = 31;

/** The punches among `ids` whose latest decision is REJECT. Read by the engine (compute.ts). */
export async function rejectedPunchIds(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await prisma.$queryRaw<Array<{ punch_id: string; action: string }>>(Prisma.sql`
    SELECT DISTINCT ON (punch_id) punch_id, action::text AS action FROM swipe_decisions WHERE punch_id IN (${Prisma.join(ids)}) ORDER BY punch_id, seq DESC`);
  return new Set(rows.filter((r) => r.action === "REJECT").map((r) => r.punch_id));
}

/** Latest decision per punch (for the swipes list). */
export async function latestDecisions(ids: string[]): Promise<Map<string, { action: string; reason: string; at: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.$queryRaw<Array<{ punch_id: string; action: string; reason: string; created_at: Date }>>(Prisma.sql`
    SELECT DISTINCT ON (punch_id) punch_id, action::text AS action, reason, created_at FROM swipe_decisions WHERE punch_id IN (${Prisma.join(ids)}) ORDER BY punch_id, seq DESC`);
  return new Map(rows.map((r) => [r.punch_id, { action: r.action, reason: r.reason, at: r.created_at.toISOString() }]));
}

/** The shift code each (employee, business date) had: a Shift Override for the day, else the assignment in force. For the swipes list's shift column. */
export async function shiftCodesFor(pairs: Array<{ employeeId: string; date: string }>): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (pairs.length === 0) return out;
  const ids = [...new Set(pairs.map((p) => p.employeeId))];
  const dates = pairs.map((p) => p.date).sort();
  const [assignments, overrides] = await Promise.all([assignmentsBetween(ids, day(dates[0]!), day(dates.at(-1)!)), loadShiftOverrides(ids, dates[0]!, dates.at(-1)!)]);
  for (const p of pairs) {
    const k = `${p.employeeId}|${p.date}`;
    const o = overrides.get(k);
    const a = assignments.find((r) => r.employeeId === p.employeeId && rowInForce(r, day(p.date)));
    const code = o?.shift.code ?? a?.shift.code;
    if (code) out.set(k, code);
  }
  return out;
}

export async function decideSwipes(viewer: ParityViewer, input: { punchIds: string[]; action: "REJECT" | "REINSTATE"; reason: string }, meta: ParityMeta) {
  if (!viewer.permissions.has("attendance.devices.manage")) throw new HttpError(403, "Missing permission: attendance.devices.manage", "FORBIDDEN");
  const ids = [...new Set(input.punchIds)];
  if (ids.length === 0 || ids.length > MAX_SWIPE_BATCH) throw new HttpError(400, `Choose 1 to ${MAX_SWIPE_BATCH} swipes.`, "VALIDATION_ERROR");
  const punches = await prisma.rawPunch.findMany({ where: { id: { in: ids } }, select: { id: true, employeeId: true, businessDate: true } });
  if (punches.length !== ids.length) throw new HttpError(404, "Swipe not found.", "NOT_FOUND");
  if (punches.some((p) => p.employeeId === viewer.employeeId)) throw new HttpError(403, "You can't decide your own swipes. Another administrator does it.", "OWN_ATTENDANCE");
  if (viewer.dataScope !== "ALL") {
    if (punches.some((p) => !p.employeeId)) throw new HttpError(404, "Swipe not found.", "NOT_FOUND");
    const empIds = [...new Set(punches.map((p) => p.employeeId!))];
    const n = await prisma.employee.count({ where: { AND: [await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope), { id: { in: empIds } }] } });
    if (n !== empIds.length) throw new HttpError(404, "Swipe not found.", "NOT_FOUND");
  }
  // Only a change is written: rejecting a rejected swipe, or reinstating one that is not rejected, is refused (nothing would change).
  const rejected = await rejectedPunchIds(ids);
  const already = ids.filter((id) => (input.action === "REJECT") === rejected.has(id));
  if (already.length) throw new HttpError(409, input.action === "REJECT" ? `${already.length} of these swipes are already rejected.` : `${already.length} of these swipes are not rejected.`, "NO_CHANGE", { punchIds: already });
  await prisma.swipeDecision.createMany({ data: ids.map((punchId) => ({ punchId, action: input.action, reason: input.reason.trim(), decidedByUserId: viewer.userId })) });
  await writeAuditLogs(punches.map((p) => ({ ...meta, action: input.action === "REJECT" ? "attendance.swipe.rejected" : "attendance.swipe.reinstated", entityType: "RawPunch", entityId: p.id, after: { reason: input.reason.trim() } })));
  const days = punches.filter((p) => p.employeeId).flatMap((p) => [-1, 0, 1].map((k) => ({ employeeId: p.employeeId!, date: new Date(p.businessDate.getTime() + k * 86_400_000) })));
  await requestRecompute(days.filter((d) => iso(d.date) <= iso(businessToday())));
  return { decided: ids.length, action: input.action };
}

// ── Sync requests ────────────────────────────────────────────────────────────────────────────────────────────────────────────

function requireDevices(viewer: ParityViewer) {
  if (!viewer.permissions.has("attendance.devices.manage")) throw new HttpError(403, "Missing permission: attendance.devices.manage", "FORBIDDEN");
}

export async function requestSync(viewer: ParityViewer, input: { deviceId: string; fromDate: string; toDate: string; reason: string }, meta: ParityMeta) {
  requireDevices(viewer);
  if (input.fromDate > input.toDate) throw new HttpError(400, "The range ends before it starts.", "VALIDATION_ERROR");
  if ((day(input.toDate).getTime() - day(input.fromDate).getTime()) / 86_400_000 + 1 > MAX_SYNC_DAYS) throw new HttpError(400, `At most ${MAX_SYNC_DAYS} days at a time.`, "TOO_WIDE");
  if (input.toDate > iso(businessToday())) throw new HttpError(400, "A sync can't ask for days that haven't happened.", "VALIDATION_ERROR");
  const device = await prisma.device.findUnique({ where: { id: input.deviceId }, select: { id: true, route: true, agentId: true, isActive: true, name: true } });
  if (!device) throw new HttpError(404, "Device not found.", "NOT_FOUND");
  if (device.route !== "AGENT" || !device.agentId || !device.isActive) throw new HttpError(409, "Only an active device read by a sync agent can be read again on request.", "NOT_AGENT_DEVICE");
  const row = await prisma.deviceSyncRequest.create({ data: { deviceId: device.id, fromDate: day(input.fromDate), toDate: day(input.toDate), reason: input.reason.trim(), requestedByUserId: viewer.userId } });
  await writeAuditLogs([{ ...meta, action: "attendance.device.sync_requested", entityType: "DeviceSyncRequest", entityId: row.id, after: { device: device.name, fromDate: input.fromDate, toDate: input.toDate, reason: row.reason } }]);
  return syncView({ ...row, device: { name: device.name } });
}

export async function cancelSync(viewer: ParityViewer, id: string, meta: ParityMeta) {
  requireDevices(viewer);
  const row = await prisma.deviceSyncRequest.findUnique({ where: { id }, include: { device: { select: { name: true } } } });
  if (!row) throw new HttpError(404, "Sync request not found.", "NOT_FOUND");
  if (row.status !== "PENDING") throw new HttpError(409, "Only a pending request can be cancelled.", "NOT_PENDING");
  const updated = await prisma.deviceSyncRequest.update({ where: { id }, data: { status: "CANCELLED", finishedAt: new Date(), cancelledByUserId: viewer.userId }, include: { device: { select: { name: true } } } });
  await writeAuditLogs([{ ...meta, action: "attendance.device.sync_cancelled", entityType: "DeviceSyncRequest", entityId: id }]);
  return syncView(updated);
}

function syncView(r: { id: string; fromDate: Date; toDate: Date; reason: string; status: string; requestedAt: Date; finishedAt: Date | null; device: { name: string } }) {
  return { id: r.id, device: r.device.name, fromDate: iso(r.fromDate), toDate: iso(r.toDate), reason: r.reason, status: r.status, requestedAt: r.requestedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null };
}

export async function listSync(viewer: ParityViewer) {
  requireDevices(viewer);
  const rows = await prisma.deviceSyncRequest.findMany({ orderBy: { requestedAt: "desc" }, take: 300, include: { device: { select: { name: true } } } });
  return { requests: rows.map(syncView) };
}

/** For the agent heartbeat: the oldest pending request per device (by device id). */
export async function pendingSyncFor(deviceIds: string[]): Promise<Map<string, { requestId: string; from: string; to: string }>> {
  const rows = await prisma.deviceSyncRequest.findMany({ where: { deviceId: { in: deviceIds }, status: "PENDING" }, orderBy: { requestedAt: "asc" } });
  const out = new Map<string, { requestId: string; from: string; to: string }>();
  for (const r of rows) if (!out.has(r.deviceId)) out.set(r.deviceId, { requestId: r.id, from: iso(r.fromDate), to: iso(r.toDate) });
  return out;
}

/** The agent says it finished a request for this device: mark it DONE (only a pending request of that same device). */
export async function markSyncDone(deviceId: string, requestId: string): Promise<boolean> {
  const r = await prisma.deviceSyncRequest.updateMany({ where: { id: requestId, deviceId, status: "PENDING" }, data: { status: "DONE", finishedAt: new Date() } });
  return r.count === 1;
}
