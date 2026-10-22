import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { businessToday } from "../../lib/businessDate";
import { inForceOn, writeBankChange } from "../../lib/effectiveDating";
import { writeAuditLog } from "../../lib/audit";
import { redact } from "../../lib/redact";
import { packBytes, unpackBytes } from "../../lib/bytesJson";
import { HttpError } from "../../middleware/errorHandler";
import { encryptBankFields, encryptStatutoryFields, type BankFieldsInput, type StatutoryFieldsInput } from "./service";
import type { RequestMetaInput } from "./types";

// changesJson never stores a raw "accountNumber"/"pan"/"aadhaar" key —
// sensitive fields are transformed into their encrypted/last4/hash shape
// (the encrypted bytes base64-encoded via lib/bytesJson, since Json columns
// can't hold a Uint8Array) up front, the same shape the live tables
// themselves use. redact() is still run over the result as defense in
// depth: it only ever masks a literal "accountNumber"/"pan"/"aadhaar" key,
// so it's a no-op on this already-renamed shape but still catches a caller
// mistake.

type BankChangeInput = BankFieldsInput & { accountNumberConfirm: string };
type StatutoryChangeInput = StatutoryFieldsInput;
interface PersonalChangeInput {
  mobile?: string;
  personalEmail?: string;
  bloodGroup?: string;
}

type CreateChangeRequestInput =
  | { fieldGroup: "bank"; changes: BankChangeInput }
  | { fieldGroup: "statutory"; changes: StatutoryChangeInput }
  | { fieldGroup: "personal"; changes: PersonalChangeInput };

function buildChangesJson(input: CreateChangeRequestInput): Record<string, unknown> {
  if (input.fieldGroup === "bank") {
    const encrypted = encryptBankFields(input.changes);
    return redact({ ...encrypted, accountNumberEncrypted: packBytes(encrypted.accountNumberEncrypted) });
  }
  if (input.fieldGroup === "statutory") {
    const encrypted = encryptStatutoryFields(input.changes);
    const packed: Record<string, unknown> = { ...encrypted };
    if (encrypted.panEncrypted) packed.panEncrypted = packBytes(encrypted.panEncrypted as Uint8Array);
    if (encrypted.aadhaarEncrypted) packed.aadhaarEncrypted = packBytes(encrypted.aadhaarEncrypted as Uint8Array);
    if (encrypted.uanEncrypted) packed.uanEncrypted = packBytes(encrypted.uanEncrypted as Uint8Array);
    return redact(packed);
  }
  return redact({ ...input.changes });
}

export async function createChangeRequest(
  requestingEmployeeId: string,
  requestingUserId: string,
  input: CreateChangeRequestInput,
  meta: RequestMetaInput,
) {
  const changesJson = buildChangesJson(input);
  const row = await prisma.profileChangeRequest.create({
    data: {
      employeeId: requestingEmployeeId,
      requestedByUserId: requestingUserId,
      fieldGroup: input.fieldGroup,
      changesJson: changesJson as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog({
    ...meta,
    action: "profile.change_request.submitted",
    entityType: "ProfileChangeRequest",
    entityId: row.id,
    after: { fieldGroup: input.fieldGroup, employeeId: requestingEmployeeId },
  });
  return { id: row.id, fieldGroup: row.status, status: row.status, createdAt: row.createdAt.toISOString() };
}

export async function listChangeRequests(viewer: { employeeId: string; canApproveAll: boolean }, status?: "PENDING" | "APPROVED" | "REJECTED") {
  const where = viewer.canApproveAll ? {} : { employeeId: viewer.employeeId };
  const rows = await prisma.profileChangeRequest.findMany({
    where: { ...where, ...(status ? { status } : {}) },
    orderBy: { createdAt: "desc" },
    include: { employee: { include: { nameHistory: { where: inForceOn() } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    employeeId: row.employeeId,
    employeeCode: row.employee.employeeCode,
    employeeName: row.employee.nameHistory[0]?.fullName ?? row.employee.employeeCode,
    fieldGroup: row.fieldGroup,
    status: row.status,
    remarks: row.remarks,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
  }));
}

async function applyBankChange(employeeId: string, changesJson: Record<string, unknown>, meta: RequestMetaInput): Promise<void> {
  // Approved today, in force from today (IST) — through the one timeline writer.
  await prisma.$transaction((tx) =>
    writeBankChange(
      tx,
      employeeId,
      businessToday(),
      {
        accountHolderName: changesJson.accountHolderName as string,
        accountNumberEncrypted: unpackBytes(changesJson.accountNumberEncrypted as string),
        accountNumberLast4: changesJson.accountNumberLast4 as string,
        accountNumberHash: changesJson.accountNumberHash as string,
        ifsc: changesJson.ifsc as string,
        bankName: changesJson.bankName as string,
        branchName: changesJson.branchName as string,
      },
      { createdByUserId: meta.actorUserId },
    ),
  );
}

async function applyStatutoryChange(employeeId: string, changesJson: Record<string, unknown>, byUserId: string): Promise<void> {
  const data: Record<string, unknown> = { updatedByUserId: byUserId };
  if (changesJson.panEncrypted) {
    data.panEncrypted = unpackBytes(changesJson.panEncrypted as string);
    data.panLast4 = changesJson.panLast4;
    data.panHash = changesJson.panHash;
  }
  if (changesJson.aadhaarEncrypted) {
    data.aadhaarEncrypted = unpackBytes(changesJson.aadhaarEncrypted as string);
    data.aadhaarLast4 = changesJson.aadhaarLast4;
    data.aadhaarHash = changesJson.aadhaarHash;
  }
  if (changesJson.uanEncrypted) {
    data.uanEncrypted = unpackBytes(changesJson.uanEncrypted as string);
    data.uanLast4 = changesJson.uanLast4;
  }
  if (changesJson.esiNumber !== undefined) {
    data.esiNumber = changesJson.esiNumber;
  }
  await prisma.employeeStatutory.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data });
}

async function applyPersonalChange(employeeId: string, changesJson: Record<string, unknown>): Promise<void> {
  await prisma.employeePersonal.update({ where: { employeeId }, data: changesJson });
}

export async function approveChangeRequest(id: string, remarks: string | undefined, meta: RequestMetaInput, viewerPermissions: ReadonlySet<string>): Promise<void> {
  const row = await prisma.profileChangeRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Change request not found.", "NOT_FOUND");
  if (row.status !== "PENDING") throw new HttpError(400, "This request has already been decided.", "ALREADY_DECIDED");
  // Approving a change to a bank account or to PAN/Aadhaar/UAN/ESI writes that data, so it needs the same permission as editing it directly (P6-6): an HR Executive,
  // who is deliberately kept away from bank and statutory data, can approve a personal-details change but not these.
  if (row.fieldGroup === "bank" && !viewerPermissions.has("employee.bank.edit")) throw new HttpError(403, "Missing permission: employee.bank.edit", "FORBIDDEN");
  if (row.fieldGroup === "statutory" && !viewerPermissions.has("employee.statutory.edit")) throw new HttpError(403, "Missing permission: employee.statutory.edit", "FORBIDDEN");

  const changesJson = row.changesJson as Record<string, unknown>;
  if (row.fieldGroup === "bank") await applyBankChange(row.employeeId, changesJson, meta);
  else if (row.fieldGroup === "statutory") await applyStatutoryChange(row.employeeId, changesJson, meta.actorUserId);
  else await applyPersonalChange(row.employeeId, changesJson);

  await prisma.profileChangeRequest.update({
    where: { id },
    data: { status: "APPROVED", remarks, decidedByUserId: meta.actorUserId, decidedAt: new Date() },
  });
  await writeAuditLog({ ...meta, action: "profile.change_request.approved", entityType: "ProfileChangeRequest", entityId: id });
}

export async function rejectChangeRequest(id: string, remarks: string | undefined, meta: RequestMetaInput): Promise<void> {
  const row = await prisma.profileChangeRequest.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "Change request not found.", "NOT_FOUND");
  if (row.status !== "PENDING") throw new HttpError(400, "This request has already been decided.", "ALREADY_DECIDED");

  await prisma.profileChangeRequest.update({
    where: { id },
    data: { status: "REJECTED", remarks, decidedByUserId: meta.actorUserId, decidedAt: new Date() },
  });
  await writeAuditLog({ ...meta, action: "profile.change_request.rejected", entityType: "ProfileChangeRequest", entityId: id });
}
