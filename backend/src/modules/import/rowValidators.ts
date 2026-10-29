import { prisma } from "../../lib/prisma";
import { addCalendarDays } from "../../lib/businessDate";
import { encryptBankFields, encryptStatutoryFields } from "../employee/service";
import { packBytes } from "../../lib/bytesJson";
import { blindIndex, normalizeAadhaar, normalizeAccountNumber, normalizePan } from "../../lib/fieldHash";
import { PAN_REGEX, AADHAAR_REGEX, MOBILE_REGEX, IFSC_REGEX, ACCOUNT_NUMBER_REGEX } from "../employee/validators";
import { isNearDuplicate } from "../../lib/levenshtein";
import type { ParsedRow } from "./parse";
import type { RowResult } from "./types";
import { inForceOn } from "../../lib/effectiveDating";

const ORG_MASTER_TYPES = ["LOCATION", "DEPARTMENT", "DESIGNATION", "GRADE", "COST_CENTRE"] as const;
const GENDERS = ["MALE", "FEMALE", "OTHER"];
const EMPLOYMENT_TYPES = ["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Today's business date (Asia/Kolkata) as YYYY-MM-DD.
function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(s);
  return !Number.isNaN(d.getTime());
}

// ── Reference data, loaded once per upload (not per row) ───────────────────

export interface ReferenceData {
  cityNames: Set<string>; // lowercased
  existing: Record<"LOCATION" | "DEPARTMENT" | "DESIGNATION" | "GRADE" | "COST_CENTRE", { codes: Set<string>; names: Map<string, string> }>; // names: lowercased -> original casing, for near-dup messages
  departmentCodeToId: Map<string, string>;
  designationCodeToId: Map<string, string>;
  locationCodeToId: Map<string, string>;
  gradeCodeToId: Map<string, string>;
  costCentreCodeToId: Map<string, string>;
  employeeCodeToId: Map<string, string>;
  activeManagerCodes: Set<string>; // lowercased; active MANAGER holders (E2: the only valid reporting managers)
  officialEmails: Set<string>; // lowercased
  activeDeviceUserIds: Set<string>;
  deviceMappingRanges: Map<string, Array<{ from: Date; to: Date | null; employeeCode: string }>>;
  panHashes: Set<string>;
  aadhaarHashes: Set<string>;
  activeAccountNumberHashes: Set<string>;
  activeLeaveTypeCodeToId: Map<string, string>; // lowercased code -> id, isActive types only, COF excluded
}

export async function loadReferenceData(): Promise<ReferenceData> {
  const [cities, locations, departments, designations, grades, costCentres, employees, deviceMappings, statutories, bankAccounts, leaveTypes] =
    await Promise.all([
      prisma.city.findMany({ select: { name: true } }),
      prisma.location.findMany({ select: { id: true, code: true, name: true } }),
      prisma.department.findMany({ select: { id: true, code: true, name: true } }),
      prisma.designation.findMany({ select: { id: true, code: true, name: true } }),
      prisma.grade.findMany({ select: { id: true, code: true, name: true } }),
      prisma.costCentre.findMany({ select: { id: true, code: true, name: true } }),
      prisma.employee.findMany({
        select: { id: true, employeeCode: true, officialEmail: true, status: true, user: { select: { roles: { select: { role: { select: { code: true } } } } } } },
      }),
      prisma.deviceUserMapping.findMany({ select: { deviceUserId: true, validFrom: true, validTo: true, employee: { select: { employeeCode: true } } } }),
      prisma.employeeStatutory.findMany({ select: { panHash: true, aadhaarHash: true } }),
      prisma.employeeBankAccount.findMany({ where: inForceOn(), select: { accountNumberHash: true } }),
      prisma.leaveType.findMany({ where: { isActive: true, code: { not: "COF" } }, select: { id: true, code: true } }),
    ]);

  return {
    cityNames: new Set(cities.map((c) => c.name.toLowerCase())),
    existing: {
      LOCATION: { codes: new Set(locations.map((l) => l.code.toLowerCase())), names: new Map(locations.map((l) => [l.name.toLowerCase(), l.name])) },
      DEPARTMENT: { codes: new Set(departments.map((d) => d.code.toLowerCase())), names: new Map(departments.map((d) => [d.name.toLowerCase(), d.name])) },
      DESIGNATION: { codes: new Set(designations.map((d) => d.code.toLowerCase())), names: new Map(designations.map((d) => [d.name.toLowerCase(), d.name])) },
      GRADE: { codes: new Set(grades.map((g) => g.code.toLowerCase())), names: new Map(grades.map((g) => [g.name.toLowerCase(), g.name])) },
      COST_CENTRE: { codes: new Set(costCentres.map((c) => c.code.toLowerCase())), names: new Map(costCentres.map((c) => [c.name.toLowerCase(), c.name])) },
    },
    departmentCodeToId: new Map(departments.map((d) => [d.code.toLowerCase(), d.id])),
    designationCodeToId: new Map(designations.map((d) => [d.code.toLowerCase(), d.id])),
    locationCodeToId: new Map(locations.map((l) => [l.code.toLowerCase(), l.id])),
    gradeCodeToId: new Map(grades.map((g) => [g.code.toLowerCase(), g.id])),
    costCentreCodeToId: new Map(costCentres.map((c) => [c.code.toLowerCase(), c.id])),
    employeeCodeToId: new Map(employees.map((e) => [e.employeeCode.toLowerCase(), e.id])),
    activeManagerCodes: new Set(employees.filter((e) => e.status === "ACTIVE" && e.user?.roles.some((r) => r.role.code === "MANAGER")).map((e) => e.employeeCode.toLowerCase())),
    officialEmails: new Set(employees.filter((e) => e.officialEmail).map((e) => e.officialEmail!.toLowerCase())),
    activeDeviceUserIds: new Set(deviceMappings.filter((m) => m.validTo === null).map((m) => m.deviceUserId)),
    // Every mapping's date range per device ID: one ID is never two people
    // on the same day (the device_user_mappings_device_no_overlap constraint).
    deviceMappingRanges: deviceMappings.reduce((acc, m) => {
      acc.set(m.deviceUserId, [...(acc.get(m.deviceUserId) ?? []), { from: m.validFrom, to: m.validTo, employeeCode: m.employee.employeeCode }]);
      return acc;
    }, new Map<string, Array<{ from: Date; to: Date | null; employeeCode: string }>>()),
    panHashes: new Set(statutories.filter((s) => s.panHash).map((s) => s.panHash!)),
    aadhaarHashes: new Set(statutories.filter((s) => s.aadhaarHash).map((s) => s.aadhaarHash!)),
    activeAccountNumberHashes: new Set(bankAccounts.map((b) => b.accountNumberHash)),
    activeLeaveTypeCodeToId: new Map(leaveTypes.map((t) => [t.code.toLowerCase(), t.id])),
  };
}

// Per-batch accumulators, separate from ReferenceData (which is DB state as
// of upload time) — catches duplicates *within* the same file, which the DB
// alone can't see until commit.
export interface BatchTracker {
  orgCodes: Record<(typeof ORG_MASTER_TYPES)[number], Set<string>>;
  orgNames: Record<(typeof ORG_MASTER_TYPES)[number], Set<string>>;
  employeeCodes: Set<string>;
  deviceUserIds: Set<string>;
  officialEmails: Set<string>;
  statutoryEmployeeCodes: Set<string>;
  bankEmployeeCodes: Set<string>;
  panHashes: Set<string>;
  aadhaarHashes: Set<string>;
  accountNumberHashes: Set<string>;
}

export function newBatchTracker(): BatchTracker {
  const emptySets = () => ({
    LOCATION: new Set<string>(),
    DEPARTMENT: new Set<string>(),
    DESIGNATION: new Set<string>(),
    GRADE: new Set<string>(),
    COST_CENTRE: new Set<string>(),
  });
  return {
    orgCodes: emptySets(),
    orgNames: emptySets(),
    employeeCodes: new Set(),
    deviceUserIds: new Set(),
    officialEmails: new Set(),
    statutoryEmployeeCodes: new Set(),
    bankEmployeeCodes: new Set(),
    panHashes: new Set(),
    aadhaarHashes: new Set(),
    accountNumberHashes: new Set(),
  };
}

// ── org-masters ──────────────────────────────────────────────────────────

export function validateOrgMasterRow(row: ParsedRow, refs: ReferenceData, tracker: BatchTracker): RowResult {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];
  const type = v.type!.toUpperCase();

  if (!ORG_MASTER_TYPES.includes(type as (typeof ORG_MASTER_TYPES)[number])) {
    errors.push(`type must be one of ${ORG_MASTER_TYPES.join(", ")} (got "${v.type}").`);
    return { data: { ...v, type }, errors, warnings };
  }
  const t = type as (typeof ORG_MASTER_TYPES)[number];
  const code = v.code!.trim();
  const name = v.name!.trim();

  if (!code) errors.push("code is required.");
  if (!name) errors.push("name is required.");

  if (code) {
    const codeLc = code.toLowerCase();
    if (refs.existing[t].codes.has(codeLc)) errors.push(`A ${t.toLowerCase()} with code "${code}" already exists.`);
    else if (tracker.orgCodes[t].has(codeLc)) errors.push(`Duplicate code "${code}" elsewhere in this file.`);
    else tracker.orgCodes[t].add(codeLc);
  }
  if (name) {
    const nameLc = name.toLowerCase();
    if (refs.existing[t].names.has(nameLc)) {
      errors.push(`A ${t.toLowerCase()} named "${name}" already exists.`);
    } else if (tracker.orgNames[t].has(nameLc)) {
      errors.push(`Duplicate name "${name}" elsewhere in this file.`);
    } else {
      tracker.orgNames[t].add(nameLc);
      if (t === "LOCATION" || t === "DEPARTMENT") {
        for (const existingName of refs.existing[t].names.values()) {
          if (isNearDuplicate(name, existingName)) {
            warnings.push(`"${name}" is very close to the existing ${t.toLowerCase()} "${existingName}" — check this isn't a typo before committing (Organisation Setup has a merge tool if it turns out to be one).`);
            break;
          }
        }
      }
    }
  }

  if (t === "LOCATION") {
    if (!v.addressLine1) errors.push("addressLine1 is required for a LOCATION row.");
    if (!v.city) errors.push("city is required for a LOCATION row.");
    if (!v.state) errors.push("state is required for a LOCATION row.");
    if (!v.pincode) errors.push("pincode is required for a LOCATION row.");
    if (v.cityName && !refs.cityNames.has(v.cityName.toLowerCase())) {
      errors.push(`Unknown city "${v.cityName}" — create it in Organisation Setup first, or leave cityName blank.`);
    }
  }
  if (t === "GRADE" && v.rank && !/^\d+$/.test(v.rank)) {
    errors.push("rank must be a whole number.");
  }

  return { data: { ...v, type: t, code, name }, errors, warnings };
}

// ── employees ────────────────────────────────────────────────────────────

export function validateEmployeeRow(row: ParsedRow, refs: ReferenceData, tracker: BatchTracker): RowResult {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];

  const deviceUserId = (v.deviceUserId ?? "").trim();
  const employeeCode = ((v.employeeCode ?? "").trim() || deviceUserId).trim();
  // Phase 2 (D2): DEVICE (the default when blank) needs a Device User ID;
  // MANUAL means attendance is marked manually and there's no device ID.
  const attendanceCapture = ((v.attendanceCapture ?? "").trim().toUpperCase() || "DEVICE") as "DEVICE" | "MANUAL";
  // An ex-employee being migrated from greytHR (lastWorkingDate set): they
  // arrive already separated, with no Separation row (docs/PROGRESS.md
  // Phase 1.5 migration notes).
  const lastWorkingDate = (v.lastWorkingDate ?? "").trim();
  const isFormer = lastWorkingDate !== "";

  if (attendanceCapture !== "DEVICE" && attendanceCapture !== "MANUAL") {
    errors.push(`attendanceCapture must be DEVICE or MANUAL (got "${v.attendanceCapture}").`);
  } else if (attendanceCapture === "DEVICE" && !deviceUserId) {
    errors.push("deviceUserId is required for attendanceCapture DEVICE — or set attendanceCapture to MANUAL if this person has no biometric machine.");
  } else if (attendanceCapture === "MANUAL" && deviceUserId) {
    errors.push("attendanceCapture MANUAL has no deviceUserId — clear it, or set attendanceCapture to DEVICE.");
  }
  if (attendanceCapture === "MANUAL" && !employeeCode) errors.push("employeeCode is required for MANUAL (there is no deviceUserId to reuse).");
  const REQUIRED_FIELDS = [
    "fullName",
    "dateOfBirth",
    "gender",
    "personalEmail",
    "mobile",
    "currentAddress",
    "permanentAddress",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "dateOfJoining",
    "employmentType",
    "departmentCode",
    "designationCode",
    "locationCode",
  ] as const;
  for (const field of REQUIRED_FIELDS) {
    if (!v[field]) errors.push(`${field} is required.`);
  }

  // One device ID is never two people on the same day. A leaver's ID may
  // already belong to someone current (the reuse convention, spec §3) — fine
  // as long as that person started after the leaver's last working day.
  if (deviceUserId && v.dateOfJoining && isValidDate(v.dateOfJoining) && (!isFormer || isValidDate(lastWorkingDate))) {
    const from = new Date(v.dateOfJoining);
    const to = isFormer ? addCalendarDays(new Date(lastWorkingDate), 1) : null;
    const FAR = new Date(8640000000000000);
    // For a current hire, an open mapping is reported by the "actively
    // assigned" check below; here, a leaver whose time runs past their start.
    const ranges = (refs.deviceMappingRanges.get(deviceUserId) ?? []).filter((r) => isFormer || r.to !== null);
    const clash = ranges.find((r) => r.from < (to ?? FAR) && from < (r.to ?? FAR));
    if (clash) {
      errors.push(
        `Device User ID "${deviceUserId}" belongs to ${clash.employeeCode} from ${clash.from.toISOString().slice(0, 10)}${clash.to ? ` to ${addCalendarDays(clash.to, -1).toISOString().slice(0, 10)}` : ""}, which overlaps this person's time (${v.dateOfJoining} to ${isFormer ? lastWorkingDate : "now"}). One device ID can't be two people on the same day.`,
      );
    }
  }
  if (deviceUserId && isFormer) {
    // Within this file a leaver's ID isn't tracked: their reuse is checked by date above.
  } else if (deviceUserId) {
    if (refs.activeDeviceUserIds.has(deviceUserId)) errors.push(`Device User ID "${deviceUserId}" is already actively assigned to another employee.`);
    else if (tracker.deviceUserIds.has(deviceUserId)) errors.push(`Duplicate Device User ID "${deviceUserId}" elsewhere in this file.`);
    else tracker.deviceUserIds.add(deviceUserId);
  }
  if (employeeCode) {
    const codeLc = employeeCode.toLowerCase();
    if (refs.employeeCodeToId.has(codeLc)) errors.push(`Employee Code "${employeeCode}" is already in use.`);
    else if (tracker.employeeCodes.has(codeLc)) errors.push(`Duplicate Employee Code "${employeeCode}" elsewhere in this file.`);
    else tracker.employeeCodes.add(codeLc);
  }

  if (v.dateOfBirth && !isValidDate(v.dateOfBirth)) errors.push("dateOfBirth must be a valid YYYY-MM-DD date.");
  if (v.dateOfJoining && !isValidDate(v.dateOfJoining)) errors.push("dateOfJoining must be a valid YYYY-MM-DD date.");
  if (isFormer) {
    if (!isValidDate(lastWorkingDate)) errors.push("lastWorkingDate must be a valid YYYY-MM-DD date.");
    else if (v.dateOfJoining && isValidDate(v.dateOfJoining) && lastWorkingDate < v.dateOfJoining) errors.push("lastWorkingDate is before dateOfJoining.");
    else if (lastWorkingDate > todayIso()) errors.push("lastWorkingDate is in the future — a leaver who hasn't left yet is separated in the app (Employee → Separations), not imported as one.");
    if (!(v.exitReason ?? "").trim()) warnings.push("No exitReason — this ex-employee will show without a reason in the Leavers report.");
  } else if ((v.exitReason ?? "").trim()) {
    errors.push("exitReason is only for ex-employees — set lastWorkingDate too, or leave exitReason blank.");
  }
  if (v.gender && !GENDERS.includes(v.gender.toUpperCase())) errors.push(`gender must be one of ${GENDERS.join(", ")}.`);
  if (v.employmentType && !EMPLOYMENT_TYPES.includes(v.employmentType.toUpperCase())) {
    errors.push(`employmentType must be one of ${EMPLOYMENT_TYPES.join(", ")}.`);
  }
  if (v.personalEmail && !/^[^\s@]+@gmail\.com$/i.test(v.personalEmail)) errors.push("personalEmail must be a Gmail address.");
  if (v.mobile && !MOBILE_REGEX.test(v.mobile)) errors.push("mobile is not a valid phone number.");
  if (v.emergencyContactPhone && !MOBILE_REGEX.test(v.emergencyContactPhone)) errors.push("emergencyContactPhone is not a valid phone number.");
  if (v.officialEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.officialEmail)) {
      errors.push("officialEmail is not a valid email address.");
    } else {
      const emailLc = v.officialEmail.toLowerCase();
      if (refs.officialEmails.has(emailLc)) errors.push(`officialEmail "${v.officialEmail}" is already in use.`);
      else if (tracker.officialEmails.has(emailLc)) errors.push(`Duplicate officialEmail "${v.officialEmail}" elsewhere in this file.`);
      else tracker.officialEmails.add(emailLc);
    }
  }

  if (v.departmentCode && !refs.departmentCodeToId.has(v.departmentCode.toLowerCase())) errors.push(`Unknown department code "${v.departmentCode}".`);
  if (v.designationCode && !refs.designationCodeToId.has(v.designationCode.toLowerCase())) errors.push(`Unknown designation code "${v.designationCode}".`);
  if (v.locationCode && !refs.locationCodeToId.has(v.locationCode.toLowerCase())) errors.push(`Unknown location code "${v.locationCode}".`);
  if (v.gradeCode && !refs.gradeCodeToId.has(v.gradeCode.toLowerCase())) errors.push(`Unknown grade code "${v.gradeCode}".`);
  if (v.costCentreCode && !refs.costCentreCodeToId.has(v.costCentreCode.toLowerCase())) errors.push(`Unknown cost centre code "${v.costCentreCode}".`);
  if (v.reportingManagerCode && !refs.employeeCodeToId.has(v.reportingManagerCode.toLowerCase())) {
    errors.push(`Unknown reporting manager code "${v.reportingManagerCode}" — the manager must already exist on record (import managers in an earlier batch).`);
  } else if (v.reportingManagerCode && !isFormer && !refs.activeManagerCodes.has(v.reportingManagerCode.toLowerCase())) {
    // E2 (model A): imported people are plain employees, so they report to
    // an active Manager — or leave it blank (they then show as Unassigned).
    errors.push(`Reporting manager "${v.reportingManagerCode}" isn't an active Manager — appoint them in Manager Management first, or leave the column blank.`);
  }

  return { data: { ...v, attendanceCapture, deviceUserId, employeeCode, lastWorkingDate: isFormer ? lastWorkingDate : "", exitReason: isFormer ? (v.exitReason ?? "").trim() : "" }, errors, warnings };
}

// ── statutory ────────────────────────────────────────────────────────────

export function validateStatutoryRow(row: ParsedRow, refs: ReferenceData, tracker: BatchTracker): RowResult {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];
  const employeeCode = v.employeeCode!.trim();
  const data: Record<string, unknown> = { employeeCode };

  if (!employeeCode) {
    errors.push("employeeCode is required.");
    return { data, errors, warnings };
  }
  const codeLc = employeeCode.toLowerCase();
  if (!refs.employeeCodeToId.has(codeLc)) {
    errors.push(`Unknown employee code "${employeeCode}" — import the Employees dataset first.`);
  } else if (tracker.statutoryEmployeeCodes.has(codeLc)) {
    errors.push(`Duplicate employeeCode "${employeeCode}" elsewhere in this file.`);
  } else {
    tracker.statutoryEmployeeCodes.add(codeLc);
  }

  if (v.pan) {
    const norm = normalizePan(v.pan);
    if (!PAN_REGEX.test(norm)) {
      errors.push("pan is not a valid PAN.");
    } else {
      const hash = blindIndex(norm);
      if (refs.panHashes.has(hash)) errors.push("This PAN is already on record for another employee.");
      else if (tracker.panHashes.has(hash)) errors.push("Duplicate PAN elsewhere in this file.");
      else tracker.panHashes.add(hash);
    }
    const enc = encryptStatutoryFields({ pan: v.pan });
    data.panEncrypted = packBytes(enc.panEncrypted as Uint8Array);
    data.panLast4 = enc.panLast4;
    data.panHash = enc.panHash;
  }
  if (v.aadhaar) {
    const norm = normalizeAadhaar(v.aadhaar);
    if (!AADHAAR_REGEX.test(norm)) {
      errors.push("aadhaar must be 12 digits.");
    } else {
      const hash = blindIndex(norm);
      if (refs.aadhaarHashes.has(hash)) errors.push("This Aadhaar is already on record for another employee.");
      else if (tracker.aadhaarHashes.has(hash)) errors.push("Duplicate Aadhaar elsewhere in this file.");
      else tracker.aadhaarHashes.add(hash);
    }
    const enc = encryptStatutoryFields({ aadhaar: v.aadhaar });
    data.aadhaarEncrypted = packBytes(enc.aadhaarEncrypted as Uint8Array);
    data.aadhaarLast4 = enc.aadhaarLast4;
    data.aadhaarHash = enc.aadhaarHash;
  }
  if (v.uan) {
    const enc = encryptStatutoryFields({ uan: v.uan });
    data.uanEncrypted = packBytes(enc.uanEncrypted as Uint8Array);
    data.uanLast4 = enc.uanLast4;
  }
  if (v.esiNumber) {
    const enc = encryptStatutoryFields({ esiNumber: v.esiNumber });
    data.esiEncrypted = packBytes(enc.esiEncrypted as Uint8Array);
    data.esiLast4 = enc.esiLast4;
  }

  return { data, errors, warnings };
}

// ── bank ─────────────────────────────────────────────────────────────────

export function validateBankRow(row: ParsedRow, refs: ReferenceData, tracker: BatchTracker): RowResult {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];
  const employeeCode = v.employeeCode!.trim();
  const data: Record<string, unknown> = { employeeCode, accountHolderName: v.accountHolderName, bankName: v.bankName, branchName: v.branchName };

  if (!employeeCode) errors.push("employeeCode is required.");
  else {
    const codeLc = employeeCode.toLowerCase();
    if (!refs.employeeCodeToId.has(codeLc)) errors.push(`Unknown employee code "${employeeCode}" — import the Employees dataset first.`);
    else if (tracker.bankEmployeeCodes.has(codeLc)) errors.push(`Duplicate employeeCode "${employeeCode}" elsewhere in this file.`);
    else tracker.bankEmployeeCodes.add(codeLc);
  }
  if (!v.accountHolderName) errors.push("accountHolderName is required.");
  if (!v.bankName) errors.push("bankName is required.");
  if (!v.branchName) errors.push("branchName is required.");

  const ifsc = (v.ifsc ?? "").toUpperCase();
  if (!v.ifsc) errors.push("ifsc is required.");
  else if (!IFSC_REGEX.test(ifsc)) errors.push("ifsc is not a valid IFSC code.");
  data.ifsc = ifsc;

  if (!v.accountNumber) {
    errors.push("accountNumber is required.");
  } else {
    const norm = normalizeAccountNumber(v.accountNumber);
    if (!ACCOUNT_NUMBER_REGEX.test(norm)) {
      errors.push("accountNumber is not valid.");
    } else {
      const hash = blindIndex(norm);
      if (refs.activeAccountNumberHashes.has(hash)) errors.push("This bank account is already active on another employee's record.");
      else if (tracker.accountNumberHashes.has(hash)) errors.push("Duplicate account number elsewhere in this file.");
      else tracker.accountNumberHashes.add(hash);
    }
    // Encrypted regardless of format validity, same as statutory above —
    // the plaintext never gets a chance to linger in `data` either way.
    const enc = encryptBankFields({
      accountHolderName: v.accountHolderName ?? "",
      accountNumber: v.accountNumber,
      ifsc,
      bankName: v.bankName ?? "",
      branchName: v.branchName ?? "",
    });
    data.accountNumberEncrypted = packBytes(enc.accountNumberEncrypted);
    data.accountNumberLast4 = enc.accountNumberLast4;
    data.accountNumberHash = enc.accountNumberHash;
  }

  return { data, errors, warnings };
}

// ── leave-grants ─────────────────────────────────────────────────────────
// Bulk PL/LOP/WFH/RH grants and debits (Leave Granter's Excel path). COF is
// deliberately out of scope here — it needs hoursWorked to compute
// eligibility/expiry (see compOff.ts's creditCompOff), not just a day
// count, so a COF row is rejected with a pointer to Leave Granter's own
// Comp-Off Grant action instead of silently mis-handling it.

const DAYS_RE = /^-?\d+(\.\d{1,2})?$/;

export function validateLeaveGrantRow(row: ParsedRow, refs: ReferenceData, _tracker: BatchTracker): RowResult {
  const v = row.values;
  const errors: string[] = [];
  const warnings: string[] = [];
  const employeeCode = v.employeeCode!.trim();
  const leaveTypeCode = v.leaveTypeCode!.trim().toUpperCase();
  const data: Record<string, unknown> = { employeeCode, leaveTypeCode, days: v.days, entryDate: v.entryDate, remarks: v.remarks || undefined };

  if (!employeeCode) {
    errors.push("employeeCode is required.");
  } else if (!refs.employeeCodeToId.has(employeeCode.toLowerCase())) {
    errors.push(`Unknown employee code "${employeeCode}" — import the Employees dataset first.`);
  }

  if (!v.leaveTypeCode) {
    errors.push("leaveTypeCode is required.");
  } else if (leaveTypeCode === "COF") {
    errors.push("COF is not supported here — use Leave Granter's Comp-Off Grant action (it needs hours worked, not just a day count).");
  } else if (!refs.activeLeaveTypeCodeToId.has(leaveTypeCode.toLowerCase())) {
    errors.push(`Unknown or inactive leave type code "${leaveTypeCode}".`);
  }

  if (!v.days) {
    errors.push("days is required.");
  } else if (!DAYS_RE.test(v.days)) {
    errors.push("days must be a whole or half number, e.g. 1, -0.5, 2.5 (positive credits, negative debits).");
  } else if (Number(v.days) === 0) {
    errors.push("days must not be zero.");
  }

  if (!v.entryDate) errors.push("entryDate is required.");
  else if (!isValidDate(v.entryDate)) errors.push("entryDate must be a valid YYYY-MM-DD date.");

  // Duplicate-in-file tracking (the tracker param other validators use)
  // deliberately omitted: two grants for the same employee+date are a
  // legitimate correction pattern (e.g. a same-day credit then a same-day
  // debit), not an error signal the way a repeated PAN or account number
  // would be.

  return { data, errors, warnings };
}
