import { Prisma, type LeaveChangeKind } from "@prisma/client";
import { writeAuditLog } from "../../lib/audit";
import { isDirector } from "../../lib/directorAuthority";
import { notifyDirectors } from "../../lib/notifyDirectors";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { manualCompOffGrant, manualGrantOrDebit, validateManualGrant } from "./grants";
import type { ActorMeta } from "./types";

// FIX-C3 (independent audit 2026-11-20, finding C3). Paid leave becomes money at year-end encashment and at exit, so a leave-changing action is treated like
// a pay change: one person PROPOSES it (a director, or HR with leave.grant), and it changes no balance until a DIFFERENT person, who must be a director,
// CONFIRMS it. Nobody proposes or confirms leave for themselves. Covered: a manual grant or debit, a manual comp-off credit, and an import that changes
// leave balances (the leave-grants dataset, which is also how opening balances are loaded). The request row is decided once and never deleted (database
// trigger), and the confirmer is never the proposer (database CHECK).

export interface LeaveChangeActor {
  userId: string;
  employeeId: string;
}

const SELF = (what: string) => new HttpError(403, `Nobody can ${what} leave for themselves. Another person proposes it and a director confirms it.`, "SELF_LEAVE_CHANGE");

async function employeeCodes(ids: string[]): Promise<string[]> {
  const rows = await prisma.employee.findMany({ where: { id: { in: ids } }, select: { employeeCode: true } });
  return rows.map((r) => r.employeeCode).sort();
}

async function employeeIdOfUser(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  if (!u) throw new HttpError(401, "Not signed in.", "UNAUTHENTICATED");
  return u.employeeId;
}

async function record(kind: LeaveChangeKind, payload: Record<string, unknown>, targets: string[], summary: string, proposedByUserId: string, meta: Omit<ActorMeta, "actorUserId">, importBatchId?: string) {
  const row = await prisma.leaveChangeRequest.create({ data: { kind, payload: payload as Prisma.InputJsonValue, targetEmployeeIds: targets, summary, proposedByUserId, importBatchId: importBatchId ?? null } });
  await writeAuditLog({ actorUserId: proposedByUserId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: "leave.change.proposed", entityType: "LeaveChangeRequest", entityId: row.id, after: { kind, summary, targets: targets.length } });
  await notifyDirectors(
    { type: "director.leave_change_pending", title: "A leave change waits for a director's confirmation", body: `${summary}. It changes no balance until a director who did not propose it confirms it.`, link: "/admin/workforce/leave-granter?tab=pending", payload: { requestId: row.id } },
    { exceptUserId: proposedByUserId },
  );
  return { id: row.id, status: row.status, summary, pendingConfirmation: true as const };
}

export async function proposeGrant(input: { employeeId: string; leaveTypeId: string; days: number; entryDate: string; remarks?: string }, actor: LeaveChangeActor, meta: ActorMeta) {
  if (input.employeeId === actor.employeeId) throw SELF("grant or debit");
  const type = await validateManualGrant(input);
  const [code] = await employeeCodes([input.employeeId]);
  const days = new Prisma.Decimal(input.days);
  const summary = `${days.greaterThan(0) ? "Grant" : "Debit"} ${days.abs().toFixed(2)} day(s) of ${type.code} for employee ${code} from ${input.entryDate}`;
  return record("GRANT", { ...input }, [input.employeeId], summary, actor.userId, meta);
}

export async function proposeCompOff(input: { employeeId: string; earnedDate: string; hoursWorked: number; remarks?: string }, actor: LeaveChangeActor, meta: ActorMeta) {
  if (input.employeeId === actor.employeeId) throw SELF("grant comp-off");
  const emp = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { status: true, employeeCode: true } });
  if (!emp || emp.status !== "ACTIVE") throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  return record("COMP_OFF_GRANT", { ...input }, [input.employeeId], `Comp-off credit for employee ${emp.employeeCode}, earned ${input.earnedDate} (${input.hoursWorked} hours worked)`, actor.userId, meta);
}

export async function proposeLeaveImport(batchId: string, rows: Array<{ data: Record<string, unknown> }>, meta: ActorMeta) {
  const pending = await prisma.leaveChangeRequest.findFirst({ where: { importBatchId: batchId, status: "PENDING" }, select: { id: true } });
  if (pending) throw new HttpError(409, "This file is already waiting for a director's confirmation.", "ALREADY_PENDING");
  const codes = [...new Set(rows.map((r) => String(r.data.employeeCode ?? "").toLowerCase()).filter(Boolean))];
  const employees = await prisma.employee.findMany({ select: { id: true, employeeCode: true } });
  const targets = employees.filter((e) => codes.includes(e.employeeCode.toLowerCase())).map((e) => e.id);
  const actorEmployeeId = await employeeIdOfUser(meta.actorUserId);
  if (targets.includes(actorEmployeeId)) throw SELF("import");
  return record("IMPORT", { rows: rows.length }, targets, `Leave import of ${rows.length} row(s) for ${targets.length} employee(s)`, meta.actorUserId, meta, batchId);
}

export async function listRequests(actor: LeaveChangeActor, status: "PENDING" | "ALL" = "PENDING") {
  const director = await isDirector(actor.userId);
  const rows = await prisma.leaveChangeRequest.findMany({
    where: { ...(status === "PENDING" ? { status: "PENDING" as const } : {}), ...(director ? {} : { proposedByUserId: actor.userId }) },
    orderBy: { proposedAt: "desc" },
    take: 100,
  });
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    summary: r.summary,
    proposedAt: r.proposedAt.toISOString(),
    mine: r.proposedByUserId === actor.userId,
    aboutMe: r.targetEmployeeIds.includes(actor.employeeId),
    // What the viewer may do: the UI offers only these; confirm() re-checks every one.
    canConfirm: director && r.status === "PENDING" && r.proposedByUserId !== actor.userId && !r.targetEmployeeIds.includes(actor.employeeId),
    canReject: r.status === "PENDING" && (director || r.proposedByUserId === actor.userId),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
  }));
}

export async function confirmRequest(id: string, actor: LeaveChangeActor, meta: ActorMeta) {
  if (!(await isDirector(actor.userId))) throw new HttpError(403, "Only a director confirms a leave change.", "DIRECTOR_ONLY");
  const result = await prisma.$transaction(
    async (tx) => {
      const [locked] = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM leave_change_requests WHERE id = ${id} FOR UPDATE`;
      if (!locked) throw new HttpError(404, "There is no such leave change.", "NOT_FOUND");
      const req = await tx.leaveChangeRequest.findUniqueOrThrow({ where: { id } });
      if (req.status !== "PENDING") throw new HttpError(409, "This leave change has already been decided.", "ALREADY_DECIDED");
      if (req.proposedByUserId === actor.userId) throw new HttpError(403, "You proposed this leave change, so a different director confirms it.", "CHECKER_IS_MAKER");
      if (req.targetEmployeeIds.includes(actor.employeeId)) throw SELF("confirm");
      const applyMeta: ActorMeta = { ...meta, actorUserId: actor.userId };
      const p = req.payload as Record<string, unknown>;
      let outcome: unknown;
      if (req.kind === "GRANT") outcome = await manualGrantOrDebit(p as never, applyMeta, tx);
      else if (req.kind === "COMP_OFF_GRANT") outcome = await manualCompOffGrant(p as never, applyMeta, tx);
      else {
        const { applyLeaveGrantsBatch } = await import("../import/service");
        outcome = await applyLeaveGrantsBatch(tx, req.importBatchId!, applyMeta);
      }
      await tx.leaveChangeRequest.update({ where: { id }, data: { status: "CONFIRMED", decidedByUserId: actor.userId, decidedAt: new Date(), result: JSON.parse(JSON.stringify(outcome ?? null)) as Prisma.InputJsonValue } });
      return { req, outcome };
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: "leave.change.confirmed", entityType: "LeaveChangeRequest", entityId: id, after: { kind: result.req.kind, summary: result.req.summary, proposedBy: result.req.proposedByUserId } });
  const proposer = await prisma.user.findUnique({ where: { id: result.req.proposedByUserId }, select: { employeeId: true } });
  if (proposer) await notifyEmployee(proposer.employeeId, { type: "director.leave_change_decided", title: "Your leave change was confirmed", body: result.req.summary, link: "/admin/workforce/leave-granter?tab=pending" });
  return { id, status: "CONFIRMED" as const, result: result.outcome };
}

export async function rejectRequest(id: string, note: string, actor: LeaveChangeActor, meta: ActorMeta) {
  const req = await prisma.leaveChangeRequest.findUnique({ where: { id } });
  if (!req) throw new HttpError(404, "There is no such leave change.", "NOT_FOUND");
  const director = await isDirector(actor.userId);
  if (!director && req.proposedByUserId !== actor.userId) throw new HttpError(403, "Only a director, or the person who proposed it, can turn down a leave change.", "FORBIDDEN");
  const { count } = await prisma.leaveChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedByUserId: actor.userId, decidedAt: new Date(), decisionNote: note } });
  if (count === 0) throw new HttpError(409, "This leave change has already been decided.", "ALREADY_DECIDED");
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: meta.ipAddress ?? null, userAgent: meta.userAgent ?? null, action: "leave.change.rejected", entityType: "LeaveChangeRequest", entityId: id, after: { kind: req.kind, summary: req.summary, note } });
  return { id, status: "REJECTED" as const };
}
