import { writeAuditLog } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { businessToday } from "../../lib/businessDate";
import { namesOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { commitRecalculation, previewRecalculation } from "../leave/recalculator";
import type { ParityMeta, ParityViewer } from "../parity/types";

// A-10 G6 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 15): the leavers list and leave recalculated to the last working day. Days only (no money: the
// encashment of what is left is a payroll question, open in spec §14). A leaver is a person with a separation that is not cancelled; "done" means the
// recalculation was applied for the separation's current last working day. Recalculation reverses accruals for months that start after that day and never
// credits them; the leaving month itself is not changed (whether a part month accrues is the policy's question, not this screen's).

const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const firstOfMonth = (d: Date) => `${iso(d).slice(0, 7)}-01`;

function requireRecalc(viewer: ParityViewer) {
  if (!viewer.permissions.has("leave.recalculate")) throw new HttpError(403, "Missing permission: leave.recalculate", "FORBIDDEN");
}

async function scopedIds(viewer: ParityViewer, ids: string[]): Promise<Set<string>> {
  if (viewer.dataScope === "ALL") return new Set(ids);
  const rows = await prisma.employee.findMany({ where: { AND: [await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope), { id: { in: ids } }] }, select: { id: true } });
  return new Set(rows.map((r) => r.id));
}

export async function listLeavers(viewer: ParityViewer, q: { from?: string; to?: string; status?: "PENDING" | "DONE" }) {
  requireRecalc(viewer);
  const today = businessToday();
  const from = q.from ?? iso(new Date(today.getTime() - 90 * 86_400_000));
  const to = q.to ?? iso(new Date(today.getTime() + 60 * 86_400_000));
  if (from > to) throw new HttpError(400, "The end date is before the start date.", "VALIDATION_ERROR");
  const seps = await prisma.separation.findMany({ where: { status: { not: "CANCELLED" }, lastWorkingDate: { gte: day(from), lte: day(to) } }, include: { employee: { select: { employeeCode: true } } }, orderBy: { lastWorkingDate: "asc" } });
  const visible = await scopedIds(viewer, seps.map((s) => s.employeeId));
  const mine = seps.filter((s) => visible.has(s.employeeId));
  const [done, names] = await Promise.all([
    prisma.leaverLeaveRecalc.findMany({ where: { separationId: { in: mine.map((s) => s.id) } }, orderBy: { createdAt: "asc" } }),
    namesOn(mine.map((s) => s.employeeId), today),
  ]);
  const doneFor = new Map<string, { at: string; actions: number; date: string }>();
  for (const r of done) doneFor.set(r.separationId, { at: r.createdAt.toISOString(), actions: r.actions, date: iso(r.lastWorkingDate) });
  const rows = mine.map((s) => {
    const d = doneFor.get(s.id);
    const status = d && d.date === iso(s.lastWorkingDate) ? "DONE" : "PENDING";
    return { separationId: s.id, employeeId: s.employeeId, employeeCode: s.employee.employeeCode, name: names.get(s.employeeId) ?? s.employee.employeeCode, lastWorkingDate: iso(s.lastWorkingDate), separationStatus: s.status, status, doneAt: status === "DONE" ? d!.at : null, actions: status === "DONE" ? d!.actions : null };
  });
  return { from, to, leavers: q.status ? rows.filter((r) => r.status === q.status) : rows };
}

async function separationFor(viewer: ParityViewer, separationId: string) {
  const sep = await prisma.separation.findUnique({ where: { id: separationId } });
  if (!sep || sep.status === "CANCELLED") throw new HttpError(404, "Leaver not found.", "NOT_FOUND");
  if (!(await scopedIds(viewer, [sep.employeeId])).has(sep.employeeId)) throw new HttpError(404, "Leaver not found.", "NOT_FOUND");
  if (sep.employeeId === viewer.employeeId) throw new HttpError(403, "Your own leave is recalculated by someone else.", "OWN_RECORD");
  return sep;
}

export async function previewLeaver(viewer: ParityViewer, separationId: string, meta: ParityMeta) {
  requireRecalc(viewer);
  const sep = await separationFor(viewer, separationId);
  const [r] = await previewRecalculation([sep.employeeId], firstOfMonth(sep.lastWorkingDate), { actorUserId: meta.actorUserId }, new Map([[sep.employeeId, sep.lastWorkingDate]]));
  return { lastWorkingDate: iso(sep.lastWorkingDate), actions: r?.actions ?? [] };
}

export async function applyLeaver(viewer: ParityViewer, separationId: string, meta: ParityMeta) {
  requireRecalc(viewer);
  const sep = await separationFor(viewer, separationId);
  const [r] = await commitRecalculation([sep.employeeId], firstOfMonth(sep.lastWorkingDate), { actorUserId: meta.actorUserId, ipAddress: meta.ipAddress, userAgent: meta.userAgent }, { confirmText: "APPLY RECALCULATION", leaving: new Map([[sep.employeeId, sep.lastWorkingDate]]) });
  const actions = r?.actions ?? [];
  await prisma.leaverLeaveRecalc.create({ data: { employeeId: sep.employeeId, separationId: sep.id, lastWorkingDate: sep.lastWorkingDate, actions: actions.length, doneByUserId: viewer.userId } });
  await writeAuditLog({ ...meta, action: "leave.leaver.recalculated", entityType: "Separation", entityId: sep.id, after: { lastWorkingDate: iso(sep.lastWorkingDate), actions: actions.length } });
  return { lastWorkingDate: iso(sep.lastWorkingDate), actions };
}
