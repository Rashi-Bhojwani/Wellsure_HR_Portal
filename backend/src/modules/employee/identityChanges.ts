import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { businessToday } from "../../lib/businessDate";
import { writeAuditLog } from "../../lib/audit";
import { inForceOn, writeBankChange } from "../../lib/effectiveDating";
import { packBytes, unpackBytes } from "../../lib/bytesJson";
import { activeDirectors, isDirector, requiresSecondDirector } from "../../lib/directorAuthority";
import type { DataScope } from "../../lib/dataScope";
import { HttpError } from "../../middleware/errorHandler";
import { behaviourValue } from "../behaviours/service";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { encryptBankFields, encryptStatutoryFields, findScopedEmployee, type BankFieldsInput, type StatutoryFieldsInput } from "./service";
import type { RequestMetaInput } from "./types";

// M session, task 1 (docs/plans/M_CHECKLIST.md): decision b of docs/plans/HR_PAYROLL_SEPARATION.md §1. A bank account or a PAN / Aadhaar / UAN / ESI
// number entered by HR waits, masked, until a director other than the person who entered it confirms it (the director setting
// `identity.directorConfirmsHrChanges`, on by default). A director's change to their OWN record always waits for the other director (Q-DA-2), and a
// director's entry for someone else waits when the director switch IDENTITY_DIRECTOR_ENTRY is "a different director". Nothing here stores a raw number:
// the entry is encrypted before it is held, in the packed shape of ProfileChangeRequest.changesJson.

export const IDENTITY_SETTING_KEY = "identity.directorConfirmsHrChanges";
export type IdentityKind = "BANK" | "STATUTORY";
export type IdentitySource = "HR_EDIT" | "ADD_EMPLOYEE" | "EMPLOYEE_REQUEST" | "DIRECTOR_EDIT";
export type HoldReason = "HR_ENTRY" | "OWN_RECORD" | "SECOND_DIRECTOR";

/** Why an entry by this person for this employee must wait for a director, or null when it is written at once. `employeeId` null = a new employee. */
export async function holdReasonFor(actorUserId: string, employeeId: string | null): Promise<HoldReason | null> {
  if (await isDirector(actorUserId)) {
    if (employeeId) {
      const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { employeeId: true } });
      if (actor?.employeeId === employeeId) return "OWN_RECORD";
    }
    return (await requiresSecondDirector("IDENTITY_DIRECTOR_ENTRY")) ? "SECOND_DIRECTOR" : null;
  }
  return (await behaviourValue("identity.directorConfirmsHrChanges")).value === true ? "HR_ENTRY" : null;
}

export function packBank(input: BankFieldsInput): Record<string, unknown> {
  const e = encryptBankFields(input);
  return { ...e, accountNumberEncrypted: packBytes(e.accountNumberEncrypted) };
}

export function packStatutory(input: StatutoryFieldsInput): Record<string, unknown> {
  const e = encryptStatutoryFields(input);
  const packed: Record<string, unknown> = { ...e };
  for (const f of ["panEncrypted", "aadhaarEncrypted", "uanEncrypted", "esiEncrypted"] as const) if (e[f]) packed[f] = packBytes(e[f] as Uint8Array);
  return packed;
}

/** What a reader may see of a held entry: last four digits and the bank's own details only, never a whole number. */
function maskedSummary(kind: string, p: Record<string, unknown>) {
  if (kind === "BANK") {
    return { accountHolderName: p.accountHolderName ?? null, accountNumberLast4: p.accountNumberLast4 ?? null, ifsc: p.ifsc ?? null, bankName: p.bankName ?? null, branchName: p.branchName ?? null };
  }
  return {
    panLast4: "panLast4" in p ? p.panLast4 : undefined,
    aadhaarLast4: "aadhaarLast4" in p ? p.aadhaarLast4 : undefined,
    uanLast4: "uanLast4" in p ? p.uanLast4 : undefined,
    esiLast4: "esiLast4" in p ? (p.esiLast4 ?? "(cleared)") : undefined,
  };
}

async function tellDirectors(employeeId: string, enteredByUserId: string, kind: IdentityKind, id: string) {
  const directors = await activeDirectors();
  for (const d of directors) {
    if (d.userId === enteredByUserId || d.employeeId === employeeId) continue; // never asked to confirm what they entered, or their own record
    await notifyEmployee(d.employeeId, {
      type: "identity.change.pending",
      title: kind === "BANK" ? "A bank account change waits for you" : "A statutory number change waits for you",
      body: "Confirm or reject it under Employee → Change Requests. It is masked until you open it.",
      link: "/admin/employee/change-requests",
      payload: { identityChangeId: id },
    });
  }
}

export async function holdInTx(
  tx: Prisma.TransactionClient,
  input: { employeeId: string; kind: IdentityKind; payload: Record<string, unknown>; effectiveFrom: Date | null; source: IdentitySource; sourceRequestId?: string | null; enteredByUserId: string },
) {
  if (await tx.identityChangeRequest.findFirst({ where: { employeeId: input.employeeId, kind: input.kind, status: "PENDING" }, select: { id: true } })) {
    throw new HttpError(409, "A change of this kind already waits for a director for this person. Ask a director to decide it, or withdraw it, first.", "IDENTITY_CHANGE_PENDING");
  }
  return tx.identityChangeRequest.create({
    data: {
      employeeId: input.employeeId,
      kind: input.kind,
      payload: input.payload as Prisma.InputJsonValue,
      effectiveFrom: input.kind === "BANK" ? (input.effectiveFrom ?? businessToday()) : null,
      source: input.source,
      sourceRequestId: input.sourceRequestId ?? null,
      enteredByUserId: input.enteredByUserId,
    },
  });
}

/** Hold an entry (its own transaction), audit it and tell the directors. Returns the masked view. */
export async function hold(
  input: { employeeId: string; kind: IdentityKind; payload: Record<string, unknown>; effectiveFrom: Date | null; source: IdentitySource; sourceRequestId?: string | null },
  reason: HoldReason,
  meta: RequestMetaInput,
) {
  const row = await prisma.$transaction((tx) => holdInTx(tx, { ...input, enteredByUserId: meta.actorUserId }));
  await afterHold(row, reason, meta);
  return { pending: true as const, id: row.id, kind: row.kind, status: row.status, ...maskedSummary(row.kind, input.payload) };
}

export async function afterHold(row: { id: string; employeeId: string; kind: string; source: string; enteredByUserId: string }, reason: HoldReason, meta: RequestMetaInput) {
  await writeAuditLog({ ...meta, action: "employee.identity_change.held", entityType: "IdentityChangeRequest", entityId: row.id, after: { employeeId: row.employeeId, kind: row.kind, source: row.source, reason } });
  await tellDirectors(row.employeeId, row.enteredByUserId, row.kind as IdentityKind, row.id);
}

async function applyInTx(tx: Prisma.TransactionClient, row: { employeeId: string; kind: string; payload: Prisma.JsonValue; effectiveFrom: Date | null }, byUserId: string) {
  const p = row.payload as Record<string, unknown>;
  if (row.kind === "BANK") {
    await writeBankChange(
      tx,
      row.employeeId,
      row.effectiveFrom ?? businessToday(),
      {
        accountHolderName: p.accountHolderName as string,
        accountNumberEncrypted: unpackBytes(p.accountNumberEncrypted as string),
        accountNumberLast4: p.accountNumberLast4 as string,
        accountNumberHash: p.accountNumberHash as string,
        ifsc: p.ifsc as string,
        bankName: p.bankName as string,
        branchName: p.branchName as string,
      },
      { createdByUserId: byUserId },
    );
    return;
  }
  const data: Record<string, unknown> = { updatedByUserId: byUserId };
  for (const [enc, rest] of [
    ["panEncrypted", ["panLast4", "panHash"]],
    ["aadhaarEncrypted", ["aadhaarLast4", "aadhaarHash"]],
    ["uanEncrypted", ["uanLast4"]],
  ] as const) {
    if (typeof p[enc] === "string") {
      data[enc] = unpackBytes(p[enc] as string);
      for (const r of rest) data[r] = p[r];
    }
  }
  if ("esiEncrypted" in p) {
    data.esiEncrypted = typeof p.esiEncrypted === "string" ? unpackBytes(p.esiEncrypted) : null;
    data.esiLast4 = p.esiLast4 ?? null;
  }
  await tx.employeeStatutory.upsert({ where: { employeeId: row.employeeId }, create: { employeeId: row.employeeId, ...data }, update: data });
}

async function loadPending(id: string) {
  const row = await prisma.identityChangeRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "There is no such change.", "NOT_FOUND");
  if (row.status !== "PENDING") throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
  return row;
}

/** A director other than the person who entered it, and never on their own record. */
async function assertDecider(row: { employeeId: string; enteredByUserId: string }, actorUserId: string) {
  if (!(await isDirector(actorUserId))) throw new HttpError(403, "Only a director can confirm or reject a bank or statutory change.", "DIRECTOR_ONLY");
  if (row.enteredByUserId === actorUserId) throw new HttpError(403, "You entered this change, so a different director decides it.", "CHECKER_IS_MAKER");
  const actor = await prisma.user.findUnique({ where: { id: actorUserId }, select: { employeeId: true } });
  if (actor?.employeeId === row.employeeId) throw new HttpError(403, "This is your own record, so the other director decides it.", "OWN_RECORD");
}

export async function confirm(id: string, meta: RequestMetaInput) {
  const row = await loadPending(id);
  await assertDecider(row, meta.actorUserId);
  await prisma.$transaction(async (tx) => {
    // Claim the row first: a second click, or the other director at the same moment, finds it decided and writes nothing.
    const claimed = await tx.identityChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "CONFIRMED", decidedByUserId: meta.actorUserId, decidedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
    await applyInTx(tx, row, meta.actorUserId);
  });
  await writeAuditLog({ ...meta, action: "employee.identity_change.confirmed", entityType: "IdentityChangeRequest", entityId: id, after: { employeeId: row.employeeId, kind: row.kind } });
  await tellEnterer(row, "confirmed");
  return { id, status: "CONFIRMED" as const };
}

export async function reject(id: string, reason: string, meta: RequestMetaInput) {
  const row = await loadPending(id);
  await assertDecider(row, meta.actorUserId);
  const claimed = await prisma.identityChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED", decidedByUserId: meta.actorUserId, decidedAt: new Date(), reason } });
  if (claimed.count !== 1) throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, action: "employee.identity_change.rejected", entityType: "IdentityChangeRequest", entityId: id, after: { employeeId: row.employeeId, kind: row.kind, reason } });
  await tellEnterer(row, "rejected");
  return { id, status: "REJECTED" as const };
}

export async function withdraw(id: string, meta: RequestMetaInput) {
  const row = await loadPending(id);
  if (row.enteredByUserId !== meta.actorUserId) throw new HttpError(403, "Only the person who entered a change can withdraw it.", "NOT_YOURS");
  const claimed = await prisma.identityChangeRequest.updateMany({ where: { id, status: "PENDING" }, data: { status: "WITHDRAWN", decidedByUserId: meta.actorUserId, decidedAt: new Date() } });
  if (claimed.count !== 1) throw new HttpError(409, "This change has already been decided.", "ALREADY_DECIDED");
  await writeAuditLog({ ...meta, action: "employee.identity_change.withdrawn", entityType: "IdentityChangeRequest", entityId: id, after: { employeeId: row.employeeId, kind: row.kind } });
  return { id, status: "WITHDRAWN" as const };
}

async function tellEnterer(row: { enteredByUserId: string; kind: string }, outcome: "confirmed" | "rejected") {
  const user = await prisma.user.findUnique({ where: { id: row.enteredByUserId }, select: { employeeId: true } });
  if (!user) return;
  await notifyEmployee(user.employeeId, {
    type: "identity.change.decided",
    title: `${row.kind === "BANK" ? "Bank account" : "Statutory number"} change ${outcome}`,
    body: outcome === "confirmed" ? "A director confirmed the change you entered; it is now in force." : "A director rejected the change you entered. The reason is on Employee → Change Requests.",
    link: "/admin/employee/change-requests",
  });
}

export interface IdentityViewer {
  userId: string;
  employeeId: string;
  dataScope: DataScope;
  permissions: ReadonlySet<string>;
}

/**
 * Held entries a viewer may see, masked: a director sees every one; anyone else sees, inside their own data scope, the kinds they may view (bank rows need
 * employee.bank.view, statutory rows employee.statutory.view). Nobody sees a whole number here.
 */
export async function list(viewer: IdentityViewer, q: { status?: "PENDING" | "CONFIRMED" | "REJECTED" | "WITHDRAWN"; employeeId?: string }) {
  const director = await isDirector(viewer.userId);
  const kinds = director ? ["BANK", "STATUTORY"] : [viewer.permissions.has("employee.bank.view") ? "BANK" : null, viewer.permissions.has("employee.statutory.view") ? "STATUTORY" : null].filter((k): k is string => k !== null);
  if (kinds.length === 0) throw new HttpError(403, "Missing permission: employee.bank.view or employee.statutory.view", "FORBIDDEN");
  if (q.employeeId && !director) await findScopedEmployee(q.employeeId, viewer.employeeId, viewer.dataScope); // 404 outside scope
  const rows = await prisma.identityChangeRequest.findMany({
    where: { kind: { in: kinds }, ...(q.status ? { status: q.status } : {}), ...(q.employeeId ? { employeeId: q.employeeId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } },
  });
  // Outside the viewer's scope (a non-director listing everyone): filtered here, row by row, never trusted from the query.
  const visible = director ? rows : await filterInScope(rows, viewer);
  const userIds = [...new Set(visible.flatMap((r) => [r.enteredByUserId, r.decidedByUserId]).filter((x): x is string => !!x))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } });
  const nameOf = new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
  const me = await prisma.user.findUnique({ where: { id: viewer.userId }, select: { employeeId: true } });
  return visible.map((r) => ({
    id: r.id,
    employeeId: r.employeeId,
    employeeCode: r.employee.employeeCode,
    employeeName: r.employee.nameHistory[0]?.fullName ?? r.employee.employeeCode,
    kind: r.kind,
    source: r.source,
    status: r.status,
    effectiveFrom: r.effectiveFrom ? r.effectiveFrom.toISOString().slice(0, 10) : null,
    masked: maskedSummary(r.kind, r.payload as Record<string, unknown>),
    enteredBy: nameOf.get(r.enteredByUserId) ?? "Someone",
    decidedBy: r.decidedByUserId ? (nameOf.get(r.decidedByUserId) ?? "A director") : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    reason: r.reason,
    createdAt: r.createdAt.toISOString(),
    mine: r.enteredByUserId === viewer.userId,
    canDecide: director && r.status === "PENDING" && r.enteredByUserId !== viewer.userId && r.employeeId !== me?.employeeId,
    canWithdraw: r.status === "PENDING" && r.enteredByUserId === viewer.userId,
  }));
}

async function filterInScope<T extends { employeeId: string }>(rows: T[], viewer: IdentityViewer): Promise<T[]> {
  const out: T[] = [];
  const seen = new Map<string, boolean>();
  for (const r of rows) {
    if (!seen.has(r.employeeId)) {
      seen.set(
        r.employeeId,
        await findScopedEmployee(r.employeeId, viewer.employeeId, viewer.dataScope).then(
          () => true,
          () => false,
        ),
      );
    }
    if (seen.get(r.employeeId)) out.push(r);
  }
  return out;
}
