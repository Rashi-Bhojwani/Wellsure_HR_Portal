// Import Center (spec §10) — one row shape per dataset, shared by the
// parser, row validators, the error-report writer and the commit step.

export type ImportDatasetKey = "org-masters" | "employees" | "statutory" | "bank" | "leave-grants";

// URL-friendly kebab-case (routes/frontend) <-> Prisma's ImportDataset enum.
export const DATASET_TO_ENUM = {
  "org-masters": "ORG_MASTERS",
  employees: "EMPLOYEES",
  statutory: "STATUTORY",
  bank: "BANK",
  "leave-grants": "LEAVE_GRANTS",
} as const;

export const ENUM_TO_DATASET = {
  ORG_MASTERS: "org-masters",
  EMPLOYEES: "employees",
  STATUTORY: "statutory",
  BANK: "bank",
  LEAVE_GRANTS: "leave-grants",
} as const;

export interface RowResult {
  data: Record<string, unknown>;
  errors: string[];
  warnings: string[];
}

export interface ActorMeta {
  actorUserId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

// Column headers, in order, for each dataset's template + upload parser.
// The parser maps by header name (case-insensitive, trimmed) rather than
// position, so re-ordering columns in an uploaded file still works — but
// the header text itself must match one of these exactly.
export const DATASET_COLUMNS: Record<ImportDatasetKey, string[]> = {
  "org-masters": [
    "type", // LOCATION | DEPARTMENT | DESIGNATION | GRADE | COST_CENTRE
    "code",
    "name",
    "cityName", // LOCATION only — must match an existing City name
    "addressLine1", // LOCATION only
    "addressLine2", // LOCATION only, optional
    "city", // LOCATION only — free-text postal city
    "state", // LOCATION only
    "pincode", // LOCATION only
    "rank", // GRADE only, optional
  ],
  employees: [
    "deviceUserId",
    "employeeCode", // optional — blank pre-fills from deviceUserId, same as the wizard
    "fullName",
    "dateOfBirth", // YYYY-MM-DD
    "gender", // MALE | FEMALE | OTHER
    "personalEmail", // must be a gmail.com address
    "mobile",
    "currentAddress",
    "permanentAddress",
    "emergencyContactName",
    "emergencyContactPhone",
    "emergencyContactRelation",
    "bloodGroup", // optional
    "dateOfJoining", // YYYY-MM-DD
    "employmentType", // PERMANENT | CONTRACT | INTERN | CONSULTANT | PROBATION
    "departmentCode",
    "designationCode",
    "locationCode",
    "gradeCode", // optional
    "costCentreCode", // optional
    "reportingManagerCode", // optional — an existing employeeCode
    "officialEmail", // optional
  ],
  statutory: ["employeeCode", "pan", "aadhaar", "uan", "esiNumber"],
  bank: ["employeeCode", "accountHolderName", "accountNumber", "ifsc", "bankName", "branchName"],
  "leave-grants": [
    "employeeCode",
    "leaveTypeCode", // must be an active, non-COF type — see Leave Granter's own Comp-Off Grant action for COF
    "days", // signed: positive credits, negative debits; never zero
    "entryDate", // YYYY-MM-DD
    "remarks", // optional
  ],
};
