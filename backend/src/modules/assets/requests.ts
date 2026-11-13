import { Prisma } from "@prisma/client";
import { writeAuditLogs } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import type { TaskSource } from "../tasks/service";
import { loadInForce } from "./settings";
import type { ActorMeta } from "./types";

// Employees' asset requests (Peeps Stage 3). An employee asks for an asset type (a category from the confirmed asset lists) with an optional short note;
// the people who run the register (HR and the directors, and Wellsure Office members while the directors' asset audience allows) see every request and
// approve, decline or mark it fulfilled; the employee sees only their own requests and their status, and may cancel one that is still waiting. Nobody
// else sees a request. Every step is an append-only event, audited; asking is idempotent on the employee's key.

export type AssetRequestStatus = "SUBMITTED" | "APPROVED" | "DECLINED" | "FULFILLED" | "CANCELLED";
type Row = Prisma.AssetRequestGetPayload<{ include: { events: true } }>;
const ORDER: Record<string, number> = { APPROVED: 1, DECLINED: 2, FULFILLED: 3, CANCELLED: 4 };
const statusOf = (r: Row): AssetRequestStatus => {
  const last = [...r.events].sort((a, b) => ORDER[b.kind]! - ORDER[a.kind]!)[0];
  return (last?.kind as AssetRequestStatus | undefined) ?? "SUBMITTED";
};
const ALLOWED: Record<AssetRequestStatus, Array<"APPROVED" | "DECLINED" | "FULFILLED">> = { SUBMITTED: ["APPROVED", "DECLINED", "FULFILLED"], APPROVED: ["FULFILLED"], DECLINED: [], FULFILLED: [], CANCELLED: [] };

async function present(rows: Row[], withPerson: boolean) {
  const lists = await loadInForce();
  const people = withPerson ? await prisma.employee.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.employeeId))] } }, select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } }) : [];
  return rows.map((r) => {
    const p = people.find((x) => x.id === r.employeeId);
    const last = [...r.events].sort((a, b) => b.at.getTime() - a.at.getTime())[0];
    return {
      id: r.id,
      category: lists.label("CATEGORIES", r.categoryCode) ?? r.categoryCode,
      categoryCode: r.categoryCode,
      note: r.note,
      status: statusOf(r),
      requestedAt: r.createdAt.toISOString(),
      updatedAt: (last?.at ?? r.createdAt).toISOString(),
      decisionNote: last && last.kind !== "CANCELLED" ? last.note : null,
      ...(withPerson ? { employee: p ? { employeeId: p.id, employeeCode: p.employeeCode, name: p.nameHistory[0]?.fullName ?? p.employeeCode } : null } : {}),
    };
  });
}

export async function options() {
  const lists = await loadInForce();
  return { ready: lists.categories.length > 0, categories: lists.categories.map((c) => ({ code: c.code, label: c.label })) };
}

export async function mine(employeeId: string) {
  const rows = await prisma.assetRequest.findMany({ where: { employeeId }, orderBy: { createdAt: "desc" }, take: 100, include: { events: true } });
  return present(rows, false);
}

export async function create(actor: { userId: string; employeeId: string }, input: { categoryCode: string; note?: string; idempotencyKey: string }, meta: ActorMeta) {
  const lists = await loadInForce();
  if (!lists.categories.length) throw new HttpError(409, "Asset categories are Not set yet, so requests cannot be made. A director sets them in the asset register.", "NOT_SET_UP");
  if (!lists.categories.some((c) => c.code === input.categoryCode)) throw new HttpError(400, "That asset type is not on the list.", "VALIDATION_ERROR");
  const key = { employeeId_idempotencyKey: { employeeId: actor.employeeId, idempotencyKey: input.idempotencyKey } };
  const existing = await prisma.assetRequest.findUnique({ where: key, include: { events: true } });
  if (existing) return { ...(await present([existing], false))[0]!, repeated: true };
  const row = await prisma
    .$transaction(async (tx) => {
      const r = await tx.assetRequest.create({ data: { employeeId: actor.employeeId, categoryCode: input.categoryCode, note: input.note?.trim() || null, idempotencyKey: input.idempotencyKey }, include: { events: true } });
      await writeAuditLogs([{ ...meta, action: "assets.request.created", entityType: "AssetRequest", entityId: r.id, after: { categoryCode: r.categoryCode } }], tx); // the note never goes into the audit log
      return r;
    })
    .catch(async (err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return prisma.assetRequest.findUniqueOrThrow({ where: key, include: { events: true } });
      throw err;
    });
  return { ...(await present([row], false))[0]!, repeated: false };
}

async function addEvent(id: string, kind: "APPROVED" | "DECLINED" | "FULFILLED" | "CANCELLED", userId: string, note: string | null, meta: ActorMeta) {
  await prisma
    .$transaction(async (tx) => {
      const e = await tx.assetRequestEvent.create({ data: { requestId: id, kind, byUserId: userId, note } });
      await writeAuditLogs([{ ...meta, action: `assets.request.${kind.toLowerCase()}`, entityType: "AssetRequest", entityId: id, after: { eventId: e.id } }], tx);
    })
    .catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "That request has already been updated.", "ALREADY_DECIDED");
      throw err;
    });
}

/** The employee cancels their own request while it is still waiting. */
export async function cancel(actor: { userId: string; employeeId: string }, id: string, meta: ActorMeta) {
  const r = await prisma.assetRequest.findUnique({ where: { id }, include: { events: true } });
  if (!r || r.employeeId !== actor.employeeId) throw new HttpError(404, "Request not found.", "NOT_FOUND");
  if (statusOf(r) !== "SUBMITTED") throw new HttpError(409, "Only a request that is still waiting can be cancelled.", "ALREADY_DECIDED");
  await addEvent(id, "CANCELLED", actor.userId, null, meta);
  return (await present([await prisma.assetRequest.findUniqueOrThrow({ where: { id }, include: { events: true } })], false))[0]!;
}

/** Every request, for the people who run the register. */
export async function all(filter: { status?: AssetRequestStatus }) {
  const rows = await prisma.assetRequest.findMany({ orderBy: { createdAt: "desc" }, take: 300, include: { events: true } });
  const out = await present(rows, true);
  return filter.status ? out.filter((r) => r.status === filter.status) : out;
}

/** Approve, decline or mark fulfilled (in that order of states); the employee is told generically. */
export async function decide(actor: { userId: string; employeeId: string }, id: string, input: { outcome: "APPROVED" | "DECLINED" | "FULFILLED"; note?: string }, meta: ActorMeta) {
  const r = await prisma.assetRequest.findUnique({ where: { id }, include: { events: true } });
  if (!r) throw new HttpError(404, "Request not found.", "NOT_FOUND");
  if (r.employeeId === actor.employeeId) throw new HttpError(403, "Your own request is decided by someone else.", "OWN_REQUEST");
  if (!ALLOWED[statusOf(r)].includes(input.outcome)) throw new HttpError(409, "That request cannot move to that state now.", "ALREADY_DECIDED");
  await addEvent(id, input.outcome, actor.userId, input.note?.trim() || null, meta);
  await notifyEmployee(r.employeeId, { type: "assets.request.updated", title: "Your asset request was updated", body: "Open My assets to see it.", link: "/app/assets" });
  return (await present([await prisma.assetRequest.findUniqueOrThrow({ where: { id }, include: { events: true } })], true))[0]!;
}

/** Tasks for the people who run the register: requests waiting for a decision or for fulfilment. Never the viewer's own. */
export const assetRequestTasks: TaskSource = {
  type: "ASSET_REQUEST",
  async list(viewer, limit) {
    if (viewer.roleCodes.includes("DEVELOPER")) return [];
    const isDirector = viewer.roleCodes.includes("SUPER_ADMIN");
    if (!isDirector && !viewer.permissions.has("assets.manage")) return [];
    if (!isDirector && !viewer.roleCodes.some((c) => c === "HR_ADMIN" || c === "HR_EXECUTIVE")) {
      const { assetsOpenToOffice } = await import("../peeps/office");
      if (!(await assetsOpenToOffice())) return [];
    }
    const rows = await prisma.assetRequest.findMany({ where: { employeeId: { not: viewer.employeeId } }, orderBy: { createdAt: "asc" }, take: 300, include: { events: true } });
    const open = (await present(rows.filter((r) => ["SUBMITTED", "APPROVED"].includes(statusOf(r))), true)).slice(0, limit);
    return open.map((r) => ({
      type: "ASSET_REQUEST" as const,
      id: r.id,
      title: r.status === "APPROVED" ? "Asset request to fulfil" : "Asset request",
      detail: r.category,
      employeeName: r.employee?.name ?? null,
      waitingSince: r.updatedAt,
      link: "/app/office/assets",
      adminLink: "/admin/assets/requests",
    }));
  },
};
