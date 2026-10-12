import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { resolveAttendanceDefaults } from "../../lib/attendanceSettings";
import { businessToday } from "../../lib/businessDate";
import { deviceCapturedOn, firstHistoryDay, inForceOn, rowStatus, writeBankChange, writeJobChange, writeNameChange } from "../../lib/effectiveDating";
import { logger } from "../../lib/logger";
import { HttpError } from "../../middleware/errorHandler";
import { reResolveUnmapped } from "../biometric/adminService";
import { encryptField, decryptField } from "../../lib/encryption";
import { blindIndex, last4, normalizeAadhaar, normalizeAccountNumber, normalizePan } from "../../lib/fieldHash";
import { buildEmployeeScopeWhere, type DataScope } from "../../lib/dataScope";
import { createInvitation, resendInvitation as resendInvitationEmail } from "../auth/service";
import { assertReportingLine, assertReportingLineFor } from "../managers/hierarchy";
import { emitPlacementRooms, emitTeamChanged } from "../../realtime/emit";
import { notifyScheduledMove } from "./scheduledChanges";
import type { RequestMetaInput } from "./types";
import type { createEmployeeSchema } from "./validators";
import type { z } from "zod";

type CreateEmployeeInput = z.infer<typeof createEmployeeSchema>;

// Translates Prisma's unique-constraint violations (P2002) — including the
// hand-added partial unique indexes from the commit A migration (one open
// job-history/bank-account/name-history row per employee, one active
// device mapping per device user ID, no two employees sharing an active
// bank account, global-unique PAN/Aadhaar hashes) — into a friendly 409
// instead of a raw 500.
async function runConflictSafe<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const target = Array.isArray(err.meta?.target) ? err.meta.target.join(",") : String(err.meta?.target ?? "");
      if (target.includes("employee_code")) throw new HttpError(409, "Employee Code is already in use.", "CONFLICT");
      if (target.includes("official_email")) throw new HttpError(409, "This official email is already in use.", "CONFLICT");
      if (target.includes("device_user_id")) {
        throw new HttpError(409, "This Device User ID is already actively assigned to another employee.", "CONFLICT");
      }
      if (target.includes("account_number_hash")) {
        throw new HttpError(409, "This bank account is already active on another employee's record.", "CONFLICT");
      }
      if (target.includes("pan_hash")) throw new HttpError(409, "This PAN is already on record for another employee.", "CONFLICT");
      if (target.includes("aadhaar_hash")) throw new HttpError(409, "This Aadhaar is already on record for another employee.", "CONFLICT");
      if (target.includes("employee_id")) throw new HttpError(409, "A conflicting record already exists for this employee.", "CONFLICT");
      throw new HttpError(409, "A record with these details already exists.", "CONFLICT");
    }
    // The effective-dating overlap constraints (lib/effectiveDating.ts).
    if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes("device_user_mappings_device_no_overlap")) {
      throw new HttpError(409, "This Device User ID belongs to someone else for part of this period — one device ID can't be two people on the same day.", "CONFLICT");
    }
    if (err instanceof Prisma.PrismaClientUnknownRequestError && err.message.includes("_no_overlap")) {
      throw new HttpError(409, "That would give this person two overlapping records for the same days.", "CONFLICT");
    }
    throw err;
  }
}

async function assertEmployeeCodeAvailable(employeeCode: string): Promise<void> {
  const existing = await prisma.employee.findUnique({ where: { employeeCode } });
  if (existing) {
    throw new HttpError(409, `Employee Code "${employeeCode}" is already in use.`, "EMPLOYEE_CODE_TAKEN");
  }
}

export interface StatutoryFieldsInput {
  pan?: string;
  aadhaar?: string;
  uan?: string;
  esiNumber?: string | null;
}

export function encryptStatutoryFields(input: StatutoryFieldsInput) {
  const data: Record<string, unknown> = {};
  if (input.pan !== undefined) {
    const norm = normalizePan(input.pan);
    data.panEncrypted = encryptField(norm);
    data.panLast4 = last4(norm);
    data.panHash = blindIndex(norm);
  }
  if (input.aadhaar !== undefined) {
    const norm = normalizeAadhaar(input.aadhaar);
    data.aadhaarEncrypted = encryptField(norm);
    data.aadhaarLast4 = last4(norm);
    data.aadhaarHash = blindIndex(norm);
  }
  if (input.uan !== undefined) {
    data.uanEncrypted = encryptField(input.uan);
    data.uanLast4 = input.uan.slice(-4);
  }
  if (input.esiNumber !== undefined) {
    data.esiNumber = input.esiNumber;
  }
  return data;
}

export interface BankFieldsInput {
  accountHolderName: string;
  accountNumber: string;
  ifsc: string;
  bankName: string;
  branchName: string;
}

export function encryptBankFields(input: BankFieldsInput) {
  const norm = normalizeAccountNumber(input.accountNumber);
  return {
    accountHolderName: input.accountHolderName,
    accountNumberEncrypted: encryptField(norm),
    accountNumberLast4: last4(norm),
    accountNumberHash: blindIndex(norm),
    ifsc: input.ifsc,
    bankName: input.bankName,
    branchName: input.branchName,
  };
}

// ── Create (Add Employee wizard, spec §3) ───────────────────────────────

// The row-creation core, factored out so the Import Center's employee-
// dataset commit (spec §10: "commit in one transaction") can run it inside
// *its own* outer `prisma.$transaction` across every row in a batch,
// instead of each employee getting its own separate transaction — Prisma
// doesn't support nesting `$transaction` calls, so the only way to compose
// this is to accept the transaction client as a parameter. createEmployee
// below (the wizard's single-employee path) is just this plus its own
// wrapping transaction, invitation email and audit log.
export async function createEmployeeInTx(
  tx: Prisma.TransactionClient,
  input: CreateEmployeeInput,
  meta: RequestMetaInput,
  // Import only: an ex-employee's device mapping is created already ended on
  // their last working day, so it never collides with the current holder of
  // a reused device ID (the active-mapping unique index).
  opts: { deviceMappingValidTo?: Date } = {},
): Promise<{ employee: { id: string }; userId: string }> {
  const { official, personal, statutory, bank } = input;

  const employeeRow = await tx.employee.create({
    data: {
      employeeCode: official.employeeCode,
      officialEmail: official.officialEmail ?? null,
      dateOfJoining: new Date(official.dateOfJoining),
      employmentType: official.employmentType,
      status: "ACTIVE",
    },
  });

  const userRow = await tx.user.create({ data: { employeeId: employeeRow.id, status: "INVITED" } });
  const employeeRole = await tx.role.findUnique({ where: { code: "EMPLOYEE" } });
  if (employeeRole) {
    await tx.userRole.create({ data: { userId: userRow.id, roleId: employeeRole.id, assignedByUserId: meta.actorUserId } });
  }

  await tx.employeePersonal.create({
    data: {
      employeeId: employeeRow.id,
      dateOfBirth: new Date(personal.dateOfBirth),
      gender: personal.gender,
      personalEmail: personal.personalEmail,
      mobile: personal.mobile,
      currentAddress: personal.currentAddress,
      permanentAddress: personal.permanentAddress,
      emergencyContactName: personal.emergencyContactName,
      emergencyContactPhone: personal.emergencyContactPhone,
      emergencyContactRelation: personal.emergencyContactRelation,
      bloodGroup: personal.bloodGroup ?? null,
    },
  });

  // Name, placement and bank start on the date of joining — or today, for
  // someone joining later (a pre-joiner), so they're in force from the day
  // they're added: in their manager's team, named on every screen. Joiner
  // and headcount figures come from dateOfJoining, never from these rows.
  // The device mapping stays from the date of joining: only punches use it.
  const firstRowsFrom = firstHistoryDay(new Date(official.dateOfJoining));
  await tx.employeeNameHistory.create({
    data: {
      employeeId: employeeRow.id,
      fullName: personal.fullName,
      effectiveFrom: firstRowsFrom,
      createdByUserId: meta.actorUserId,
    },
  });

  await tx.employeeJobHistory.create({
    data: {
      employeeId: employeeRow.id,
      departmentId: official.departmentId,
      designationId: official.designationId,
      locationId: official.locationId,
      gradeId: official.gradeId ?? null,
      costCentreId: official.costCentreId ?? null,
      reportingManagerId: official.reportingManagerId ?? null,
      effectiveFrom: firstRowsFrom,
      createdByUserId: meta.actorUserId,
    },
  });

  // Phase 2 (D2): a device mapping only for "Biometric device" capture. No
  // mapping = manual capture: their attendance is marked by whoever marks
  // their branch (docs/plans/PHASE_2.md §4.3).
  if (official.attendanceCapture === "DEVICE" && official.deviceUserId) {
    await tx.deviceUserMapping.create({
      data: {
        employeeId: employeeRow.id,
        deviceUserId: official.deviceUserId,
        validFrom: new Date(official.dateOfJoining),
        validTo: opts.deviceMappingValidTo ?? null,
        createdByUserId: meta.actorUserId,
      },
    });
  }

  // The company default shift, week-off pattern and policy, from the same
  // first day as their placement — ended like it for an imported leaver.
  const end = opts.deviceMappingValidTo ?? null;
  if (!end || end > firstRowsFrom) {
    await tx.attendanceAssignment.create({
      data: {
        employeeId: employeeRow.id,
        ...(await resolveAttendanceDefaults(tx)),
        effectiveFrom: firstRowsFrom,
        effectiveTo: end,
        changeReason: "Company default",
        createdByUserId: meta.actorUserId,
      },
    });
  }

  if (statutory && (statutory.pan ?? statutory.aadhaar ?? statutory.uan ?? statutory.esiNumber)) {
    await tx.employeeStatutory.create({
      data: { employeeId: employeeRow.id, ...encryptStatutoryFields(statutory) },
    });
  }

  if (bank) {
    await tx.employeeBankAccount.create({
      data: {
        employeeId: employeeRow.id,
        ...encryptBankFields(bank),
        effectiveFrom: firstRowsFrom,
        createdByUserId: meta.actorUserId,
      },
    });
  }

  return { employee: employeeRow, userId: userRow.id };
}

// `sendInvitation: false` is used only by the Import Center's employee-
// dataset commit (spec §10: "invitations are sent in batches, HR-triggered,
// never automatically on import") — the wizard's own call site never passes
// it, so a bulk import can't silently email hundreds of new hires.
export async function createEmployee(input: CreateEmployeeInput, meta: RequestMetaInput, options?: { sendInvitation?: boolean }) {
  const { official, personal, statutory, bank } = input;
  await assertEmployeeCodeAvailable(official.employeeCode);
  // E2 (model A): a new hire is a plain employee, so their reporting manager
  // must be an active Manager (or none — they then show as Unassigned).
  await assertReportingLine({ code: official.employeeCode, roleCodes: ["EMPLOYEE"] }, official.reportingManagerId ?? null);

  const { employee, userId } = await runConflictSafe(() => prisma.$transaction((tx) => createEmployeeInTx(tx, input, meta)));

  // Punches this ID made before the record existed (day one, before HR added them) sit unmapped
  // until someone gives them an owner; the new mapping is that owner (docs/plans/PHASE_2.md §4.3).
  if (official.attendanceCapture === "DEVICE" && official.deviceUserId) {
    await reResolveUnmapped(official.deviceUserId).catch((err: unknown) => logger.warn({ err, employeeId: employee.id }, "Could not attach earlier punches to the new employee; map them from the Unmapped queue"));
  }

  if (options?.sendInvitation ?? true) {
    await createInvitation({
      userId,
      email: personal.personalEmail,
      fullName: personal.fullName,
      employeeCode: official.employeeCode,
    });
  }

  await writeAuditLog({
    actorUserId: meta.actorUserId,
    action: "employee.created",
    entityType: "Employee",
    entityId: employee.id,
    after: { official, personal, statutory, bank },
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });

  return { id: employee.id, employeeCode: official.employeeCode };
}

export async function resendInvite(employeeId: string, meta: RequestMetaInput): Promise<void> {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: { user: true, personal: true, nameHistory: { where: inForceOn() } },
  });
  if (!employee?.user) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (employee.user.status !== "INVITED") {
    throw new HttpError(400, "This employee has already activated their account.", "ALREADY_ACTIVE");
  }
  const fullName = employee.nameHistory[0]?.fullName ?? employee.employeeCode;
  await resendInvitationEmail(employee.user.id, employee.personal!.personalEmail, fullName, employee.employeeCode);
  await writeAuditLog({ ...meta, action: "employee.invite_resent", entityType: "Employee", entityId: employeeId });
}

// ── Scope helpers ────────────────────────────────────────────────────────

export async function findScopedEmployee(employeeId: string, requestingEmployeeId: string, scope: DataScope) {
  const scopeWhere = await buildEmployeeScopeWhere(requestingEmployeeId, scope);
  // AND, not a spread merge: scopeWhere's own "id" key (SELF/TEAM scope
  // both produce one) would otherwise silently overwrite this "id:
  // employeeId" filter in a plain object spread, turning this into "find
  // ANY employee in my scope" instead of "is THIS employee in my scope" —
  // a real IDOR this test suite caught.
  const employee = await prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scopeWhere] } });
  if (!employee) {
    // Same 404 whether out of scope or truly absent — never confirm another
    // employee's id exists to a caller who can't see them (IDOR).
    throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  }
  return employee;
}

// ── Profile ──────────────────────────────────────────────────────────────

async function loadProfileCore(employeeId: string) {
  const employee = await prisma.employee.findUnique({
    where: { id: employeeId },
    include: {
      personal: true,
      nameHistory: { where: inForceOn() },
      user: { select: { status: true, totpEnabled: true, lastLoginAt: true } },
      jobHistory: {
        where: inForceOn(),
        include: { department: true, designation: true, location: true, grade: true, costCentre: true, reportingManager: { include: { nameHistory: { where: inForceOn() } } } },
      },
    },
  });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");

  const job = employee.jobHistory[0];
  // Phase 2: manual capture = no device mapping in force (PHASE_2.md §4.3) —
  // judged on today, or on their first/last day for a joiner/leaver.
  const today = businessToday();
  const captureDay = employee.dateOfJoining > today ? employee.dateOfJoining : employee.lastWorkingDate && employee.lastWorkingDate < today ? employee.lastWorkingDate : today;
  const attendanceCapture = (await deviceCapturedOn([employee.id], captureDay)).has(employee.id) ? "DEVICE" : "MANUAL";
  return {
    id: employee.id,
    employeeCode: employee.employeeCode,
    fullName: employee.nameHistory[0]?.fullName ?? employee.employeeCode,
    officialEmail: employee.officialEmail,
    dateOfJoining: employee.dateOfJoining.toISOString().slice(0, 10),
    lastWorkingDate: employee.lastWorkingDate?.toISOString().slice(0, 10) ?? null,
    employmentType: employee.employmentType,
    status: employee.status,
    attendanceCapture,
    accountStatus: employee.user?.status ?? null,
    totpEnabled: employee.user?.totpEnabled ?? false,
    personal: employee.personal
      ? {
          dateOfBirth: employee.personal.dateOfBirth.toISOString().slice(0, 10),
          gender: employee.personal.gender,
          personalEmail: employee.personal.personalEmail,
          mobile: employee.personal.mobile,
          currentAddress: employee.personal.currentAddress,
          permanentAddress: employee.personal.permanentAddress,
          emergencyContactName: employee.personal.emergencyContactName,
          emergencyContactPhone: employee.personal.emergencyContactPhone,
          emergencyContactRelation: employee.personal.emergencyContactRelation,
          bloodGroup: employee.personal.bloodGroup,
          // The storage key itself stays server-side; clients build photo
          // URLs from the version (see modules/people/photos.ts).
          photoVersion: employee.personal.photoVersion,
        }
      : null,
    job: job
      ? {
          department: { id: job.department.id, name: job.department.name },
          designation: { id: job.designation.id, name: job.designation.name },
          location: { id: job.location.id, name: job.location.name },
          grade: job.grade ? { id: job.grade.id, name: job.grade.name } : null,
          costCentre: job.costCentre ? { id: job.costCentre.id, name: job.costCentre.name } : null,
          reportingManager: job.reportingManager
            ? { id: job.reportingManager.id, fullName: job.reportingManager.nameHistory[0]?.fullName ?? job.reportingManager.employeeCode }
            : null,
          effectiveFrom: job.effectiveFrom.toISOString().slice(0, 10),
        }
      : null,
  };
}

async function loadMaskedStatutory(employeeId: string) {
  const row = await prisma.employeeStatutory.findUnique({ where: { employeeId } });
  if (!row) return null;
  return {
    panLast4: row.panLast4,
    aadhaarLast4: row.aadhaarLast4,
    uanLast4: row.uanLast4,
    esiNumber: row.esiNumber,
    hasPan: row.panEncrypted !== null,
    hasAadhaar: row.aadhaarEncrypted !== null,
    hasUan: row.uanEncrypted !== null,
  };
}

async function loadMaskedBank(employeeId: string) {
  const row = await prisma.employeeBankAccount.findFirst({ where: { employeeId, ...inForceOn() } });
  if (!row) return null;
  return {
    accountHolderName: row.accountHolderName,
    accountNumberLast4: row.accountNumberLast4,
    ifsc: row.ifsc,
    bankName: row.bankName,
    branchName: row.branchName,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
  };
}

// HR-facing profile (All Employees -> employee profile, spec §7.2). Bank/
// statutory sections are omitted entirely (not just masked) when the
// caller lacks the corresponding view permission.
export async function getEmployeeProfile(
  employeeId: string,
  viewer: { employeeId: string; roleCodes: string[]; permissions: Set<string> },
  scope: DataScope,
) {
  await findScopedEmployee(employeeId, viewer.employeeId, scope);
  const core = await loadProfileCore(employeeId);
  return {
    ...core,
    statutory: viewer.permissions.has("employee.statutory.view") ? await loadMaskedStatutory(employeeId) : undefined,
    bank: viewer.permissions.has("employee.bank.view") ? await loadMaskedBank(employeeId) : undefined,
  };
}

// Self-service "View My Info" (spec §6) — always includes the caller's own
// masked statutory/bank, independent of employee.statutory.view/bank.view
// (which EMPLOYEE never holds). Full reveal still requires those
// permissions even for your own record — see revealStatutory/revealBank.
export async function getMyProfile(requestingEmployeeId: string) {
  const core = await loadProfileCore(requestingEmployeeId);
  return {
    ...core,
    statutory: await loadMaskedStatutory(requestingEmployeeId),
    bank: await loadMaskedBank(requestingEmployeeId),
  };
}

// ── Audited reveal endpoints (spec §9) ──────────────────────────────────

export async function revealStatutory(employeeId: string, viewerEmployeeId: string, scope: DataScope, meta: RequestMetaInput) {
  await findScopedEmployee(employeeId, viewerEmployeeId, scope);
  const row = await prisma.employeeStatutory.findUnique({ where: { employeeId } });
  if (!row) throw new HttpError(404, "No statutory details on file.", "NOT_FOUND");
  const result = {
    pan: row.panEncrypted ? decryptField(row.panEncrypted) : null,
    aadhaar: row.aadhaarEncrypted ? decryptField(row.aadhaarEncrypted) : null,
    uan: row.uanEncrypted ? decryptField(row.uanEncrypted) : null,
    esiNumber: row.esiNumber,
  };
  await writeAuditLog({ ...meta, action: "employee.statutory.revealed", entityType: "Employee", entityId: employeeId });
  return result;
}

export async function revealBank(employeeId: string, viewerEmployeeId: string, scope: DataScope, meta: RequestMetaInput) {
  await findScopedEmployee(employeeId, viewerEmployeeId, scope);
  const row = await prisma.employeeBankAccount.findFirst({ where: { employeeId, ...inForceOn() } });
  if (!row) throw new HttpError(404, "No active bank account on file.", "NOT_FOUND");
  const result = { accountHolderName: row.accountHolderName, accountNumber: decryptField(row.accountNumberEncrypted), ifsc: row.ifsc, bankName: row.bankName, branchName: row.branchName };
  await writeAuditLog({ ...meta, action: "employee.bank.revealed", entityType: "Employee", entityId: employeeId });
  return result;
}

// ── History timelines ────────────────────────────────────────────────────

export async function getJobHistory(employeeId: string, viewerEmployeeId: string, scope: DataScope) {
  await findScopedEmployee(employeeId, viewerEmployeeId, scope);
  const rows = await prisma.employeeJobHistory.findMany({
    where: { employeeId },
    orderBy: { effectiveFrom: "desc" },
    include: { department: true, designation: true, location: true, grade: true, costCentre: true, reportingManager: { include: { nameHistory: { where: inForceOn() } } } },
  });
  return rows.map((row) => ({
    id: row.id,
    department: row.department.name,
    designation: row.designation.name,
    location: row.location.name,
    grade: row.grade?.name ?? null,
    costCentre: row.costCentre?.name ?? null,
    reportingManager: row.reportingManager ? row.reportingManager.nameHistory[0]?.fullName ?? row.reportingManager.employeeCode : null,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    status: rowStatus(row.effectiveFrom, row.effectiveTo), // past | current | scheduled (EF3)
    changeReason: row.changeReason,
  }));
}

export async function getNameHistory(employeeId: string, viewerEmployeeId: string, scope: DataScope) {
  await findScopedEmployee(employeeId, viewerEmployeeId, scope);
  const rows = await prisma.employeeNameHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    fullName: row.fullName,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    status: rowStatus(row.effectiveFrom, row.effectiveTo), // past | current | scheduled (EF3)
    changeReason: row.changeReason,
  }));
}

// Masked even in history — last-4 only, same rule as the live record.
export async function getBankHistory(employeeId: string, viewerEmployeeId: string, scope: DataScope, viewerPermissions: Set<string>) {
  if (!viewerPermissions.has("employee.bank.view")) {
    throw new HttpError(403, "Missing permission: employee.bank.view", "FORBIDDEN");
  }
  await findScopedEmployee(employeeId, viewerEmployeeId, scope);
  const rows = await prisma.employeeBankAccount.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } });
  return rows.map((row) => ({
    id: row.id,
    accountHolderName: row.accountHolderName,
    accountNumberLast4: row.accountNumberLast4,
    ifsc: row.ifsc,
    bankName: row.bankName,
    branchName: row.branchName,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    status: rowStatus(row.effectiveFrom, row.effectiveTo), // past | current | scheduled (EF3)
  }));
}

// ── Effective-dated updates ──────────────────────────────────────────────

interface JobUpdateInput {
  departmentId?: string;
  designationId?: string;
  locationId?: string;
  gradeId?: string | null;
  costCentreId?: string | null;
  reportingManagerId?: string | null;
  effectiveFrom: string;
  changeReason?: string;
}

export async function updateJob(employeeId: string, input: JobUpdateInput, meta: RequestMetaInput) {
  const latest = await prisma.employeeJobHistory.findFirst({ where: { employeeId }, orderBy: { effectiveFrom: "desc" } });
  if (input.reportingManagerId !== undefined && input.reportingManagerId !== (latest?.reportingManagerId ?? null)) {
    // E2: the three-level rules. A move may be scheduled ahead (EF3).
    await assertReportingLineFor(employeeId, input.reportingManagerId);
  }
  if (!latest && !(await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } }))) throw new HttpError(404, "Employee not found.", "NOT_FOUND");

  // One writer for all job history (lib/effectiveDating.ts): appended at
  // the end, never rewriting older history. An employee created by the
  // Super Admin bootstrap CLI has no placement yet; their first one is set
  // here, so department, designation and location are then all required.
  const write = await runConflictSafe(() =>
    prisma.$transaction((tx) =>
      writeJobChange(
        tx,
        employeeId,
        new Date(input.effectiveFrom),
        {
          departmentId: input.departmentId,
          designationId: input.designationId,
          locationId: input.locationId,
          gradeId: input.gradeId,
          costCentreId: input.costCentreId,
          reportingManagerId: input.reportingManagerId,
        },
        { createdByUserId: meta.actorUserId, changeReason: input.changeReason ?? null },
      ),
    ),
  );

  await writeAuditLog({ ...meta, action: "employee.job.changed", entityType: "Employee", entityId: employeeId, before: write.before, after: { ...write.after, timeline: write.plan } });
  const before = write.before;
  if (write.after.effectiveFrom <= businessToday()) {
    // In force now: live rooms and team screens follow at once.
    emitPlacementRooms(employeeId, { departmentId: before?.departmentId ?? null, locationId: before?.locationId ?? null }, write.after);
    if (before?.reportingManagerId !== write.after.reportingManagerId) emitTeamChanged([before?.reportingManagerId, write.after.reportingManagerId]);
  } else {
    // Scheduled: the daily rollover refreshes live state on the day; people are told now.
    await notifyScheduledMove(employeeId, before?.reportingManagerId ?? null, write.after.reportingManagerId, write.after.effectiveFrom);
  }
  return write.after;
}

interface BankUpdateInput extends BankFieldsInput {
  effectiveFrom?: string;
}

export async function updateBank(employeeId: string, input: BankUpdateInput, meta: RequestMetaInput) {
  // businessToday(), never new Date(): between 00:00 and 05:30 IST a UTC
  // timestamp lands on yesterday's date.
  const effectiveFrom = input.effectiveFrom ? new Date(input.effectiveFrom) : businessToday();
  const write = await runConflictSafe(() =>
    prisma.$transaction((tx) => writeBankChange(tx, employeeId, effectiveFrom, encryptBankFields(input), { createdByUserId: meta.actorUserId })),
  );
  const current = write.before;
  const after = write.after;

  await writeAuditLog({
    ...meta,
    action: "employee.bank.changed",
    entityType: "Employee",
    entityId: employeeId,
    before: current ? { accountNumber: "REDACTED", ifsc: current.ifsc, bankName: current.bankName } : null,
    after: { accountNumber: input.accountNumber, ifsc: input.ifsc, bankName: input.bankName },
  });
  return { id: after.id, accountNumberLast4: after.accountNumberLast4, ifsc: after.ifsc, bankName: after.bankName, branchName: after.branchName };
}

interface NameUpdateInput {
  fullName: string;
  effectiveFrom: string;
  changeReason?: string;
}

export async function updateName(employeeId: string, input: NameUpdateInput, meta: RequestMetaInput) {
  if (!(await prisma.employeeNameHistory.findFirst({ where: { employeeId }, select: { id: true } }))) throw new HttpError(404, "This employee has no current name on record.", "NOT_FOUND");
  const write = await runConflictSafe(() =>
    prisma.$transaction((tx) => writeNameChange(tx, employeeId, new Date(input.effectiveFrom), input.fullName, { createdByUserId: meta.actorUserId, changeReason: input.changeReason ?? null })),
  );

  await writeAuditLog({ ...meta, action: "employee.name.changed", entityType: "Employee", entityId: employeeId, before: write.before, after: { ...write.after, timeline: write.plan } });
  return write.after;
}

export async function updateStatutory(employeeId: string, input: StatutoryFieldsInput, meta: RequestMetaInput) {
  const employee = await prisma.employee.findUnique({ where: { id: employeeId } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");

  const data = encryptStatutoryFields(input);
  await runConflictSafe(() => prisma.employeeStatutory.upsert({ where: { employeeId }, create: { employeeId, ...data }, update: data }));
  await writeAuditLog({ ...meta, action: "employee.statutory.updated", entityType: "Employee", entityId: employeeId, after: input });
  return loadMaskedStatutory(employeeId);
}

interface PersonalUpdateInput {
  mobile?: string;
  personalEmail?: string;
  bloodGroup?: string | null;
  currentAddress?: string;
  permanentAddress?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  emergencyContactRelation?: string;
}

async function updatePersonalFields(employeeId: string, input: PersonalUpdateInput, meta: RequestMetaInput, action: string): Promise<void> {
  const before = await prisma.employeePersonal.findUnique({ where: { employeeId } });
  if (!before) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const after = await prisma.employeePersonal.update({ where: { employeeId }, data: input });
  await writeAuditLog({ ...meta, action, entityType: "Employee", entityId: employeeId, before, after });
}

// HR direct edit — any personal field.
export async function updatePersonal(employeeId: string, input: PersonalUpdateInput, meta: RequestMetaInput): Promise<void> {
  await updatePersonalFields(employeeId, input, meta, "employee.personal.updated");
}

// Employee self-service — address/emergency-contact/photo only (schema's
// EmployeePersonal comment); the caller's own record, resolved server-side
// from the JWT, never from a client-supplied id.
export async function updateSelfService(requestingEmployeeId: string, input: PersonalUpdateInput, meta: RequestMetaInput): Promise<void> {
  await updatePersonalFields(requestingEmployeeId, input, meta, "employee.self_service.updated");
}
