import { z } from "zod";

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const deviceCodeCheckQuerySchema = z.object({
  deviceUserId: z.string().trim().min(1).max(30),
});

// Exported so the Import Center's row validators (spec §10) enforce the
// exact same format rules as this wizard — one source of truth for what
// counts as a valid PAN/IFSC/mobile/Aadhaar, never a second copy that can
// drift out of sync.
export const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const AADHAAR_REGEX = /^\d{12}$/;
export const MOBILE_REGEX = /^[0-9+\-\s]{7,15}$/;
export const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_NUMBER_REGEX = /^\d{6,20}$/;

export const gmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email("Enter a valid email address.")
  .refine((v) => v.endsWith("@gmail.com"), "Personal email must be a Gmail address.");

export const ifscSchema = z.string().trim().toUpperCase().regex(IFSC_REGEX, "Enter a valid IFSC code (e.g. SBIN0001234).");

const dateSchema = z.iso.date(); // YYYY-MM-DD, matches @db.Date columns

const officialSchema = z.object({
  // Phase 2 (D2, user 2026-10-08): attendance capture is a deliberate choice.
  // DEVICE needs the biometric machine's Device User ID; MANUAL means this
  // person's attendance is marked manually (no machine at their branch) and
  // they get no device mapping. Defaults to DEVICE for older clients.
  attendanceCapture: z.enum(["DEVICE", "MANUAL"]).default("DEVICE"),
  deviceUserId: z.string().trim().max(30).optional().transform((v) => (v ? v : undefined)),
  employeeCode: z.string().trim().min(1).max(30),
  dateOfJoining: dateSchema,
  departmentId: z.string().min(1),
  designationId: z.string().min(1),
  locationId: z.string().min(1),
  gradeId: z.string().min(1).nullable().optional(),
  costCentreId: z.string().min(1).nullable().optional(),
  reportingManagerId: z.string().min(1).nullable().optional(),
  employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"]),
  officialEmail: z.string().trim().toLowerCase().email().nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.attendanceCapture === "DEVICE" && !v.deviceUserId) {
    ctx.addIssue({ code: "custom", path: ["deviceUserId"], message: "Enter the Device User ID from the biometric machine — or choose \"No device: attendance is marked manually\"." });
  }
  if (v.attendanceCapture === "MANUAL" && v.deviceUserId) {
    ctx.addIssue({ code: "custom", path: ["deviceUserId"], message: "Manual attendance has no Device User ID — clear it, or choose \"Biometric device\"." });
  }
});

const personalSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  dateOfBirth: dateSchema,
  gender: z.enum(["MALE", "FEMALE", "OTHER"]),
  personalEmail: gmailSchema,
  mobile: z.string().trim().regex(MOBILE_REGEX, "Enter a valid mobile number."),
  currentAddress: z.string().trim().min(1).max(300),
  permanentAddress: z.string().trim().min(1).max(300),
  emergencyContactName: z.string().trim().min(1).max(150),
  emergencyContactPhone: z.string().trim().regex(MOBILE_REGEX, "Enter a valid phone number."),
  emergencyContactRelation: z.string().trim().min(1).max(50),
  bloodGroup: z.string().trim().max(5).nullable().optional(),
});

const statutorySchema = z
  .object({
    pan: z
      .string()
      .trim()
      .toUpperCase()
      .regex(PAN_REGEX, "Enter a valid PAN.")
      .optional(),
    aadhaar: z
      .string()
      .trim()
      .regex(AADHAAR_REGEX, "Aadhaar must be 12 digits.")
      .optional(),
    uan: z.string().trim().max(20).optional(),
    esiNumber: z.string().trim().max(20).optional(),
  })
  .optional();

const bankSchema = z
  .object({
    accountHolderName: z.string().trim().min(1).max(150),
    accountNumber: z.string().trim().regex(ACCOUNT_NUMBER_REGEX, "Enter a valid account number."),
    accountNumberConfirm: z.string().trim(),
    ifsc: ifscSchema,
    bankName: z.string().trim().min(1).max(150),
    branchName: z.string().trim().min(1).max(150),
  })
  .refine((v) => v.accountNumber === v.accountNumberConfirm, {
    message: "Account numbers don't match.",
    path: ["accountNumberConfirm"],
  })
  .optional();

export const createEmployeeSchema = z.object({
  official: officialSchema,
  personal: personalSchema,
  statutory: statutorySchema,
  bank: bankSchema,
});

export const jobUpdateSchema = z.object({
  departmentId: z.string().min(1).optional(),
  designationId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  gradeId: z.string().min(1).nullable().optional(),
  costCentreId: z.string().min(1).nullable().optional(),
  reportingManagerId: z.string().min(1).nullable().optional(),
  effectiveFrom: dateSchema,
  changeReason: z.string().trim().max(300).optional(),
});

export const bankUpdateSchema = z.object({
  accountHolderName: z.string().trim().min(1).max(150),
  accountNumber: z.string().trim().regex(ACCOUNT_NUMBER_REGEX, "Enter a valid account number."),
  accountNumberConfirm: z.string().trim(),
  ifsc: ifscSchema,
  bankName: z.string().trim().min(1).max(150),
  branchName: z.string().trim().min(1).max(150),
  effectiveFrom: dateSchema.optional(),
}).refine((v) => v.accountNumber === v.accountNumberConfirm, {
  message: "Account numbers don't match.",
  path: ["accountNumberConfirm"],
});

export const nameUpdateSchema = z.object({
  fullName: z.string().trim().min(1).max(150),
  effectiveFrom: dateSchema,
  changeReason: z.string().trim().max(300).optional(),
});

export const statutoryUpdateSchema = z.object({
  pan: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PAN_REGEX)
    .optional(),
  aadhaar: z
    .string()
    .trim()
    .regex(AADHAAR_REGEX)
    .optional(),
  uan: z.string().trim().max(20).optional(),
  esiNumber: z.string().trim().max(20).nullable().optional(),
});

export const personalUpdateSchema = z.object({
  mobile: z.string().trim().regex(MOBILE_REGEX).optional(),
  personalEmail: gmailSchema.optional(),
  bloodGroup: z.string().trim().max(5).nullable().optional(),
  currentAddress: z.string().trim().min(1).max(300).optional(),
  permanentAddress: z.string().trim().min(1).max(300).optional(),
  emergencyContactName: z.string().trim().min(1).max(150).optional(),
  emergencyContactPhone: z.string().trim().regex(MOBILE_REGEX).optional(),
  emergencyContactRelation: z.string().trim().min(1).max(50).optional(),
});

// The employee's own direct-edit path — address, emergency contact, photo
// only (schema.prisma's EmployeePersonal comment). Everything else must go
// through a ProfileChangeRequest instead.
export const selfServiceUpdateSchema = z.object({
  currentAddress: z.string().trim().min(1).max(300).optional(),
  permanentAddress: z.string().trim().min(1).max(300).optional(),
  emergencyContactName: z.string().trim().min(1).max(150).optional(),
  emergencyContactPhone: z.string().trim().regex(MOBILE_REGEX).optional(),
  emergencyContactRelation: z.string().trim().min(1).max(50).optional(),
});

export const changeRequestFieldGroupSchema = z.enum(["bank", "statutory", "personal"]);

const changeRequestBankChanges = z
  .object({
    accountHolderName: z.string().trim().min(1).max(150),
    accountNumber: z.string().trim().regex(ACCOUNT_NUMBER_REGEX),
    accountNumberConfirm: z.string().trim(),
    ifsc: ifscSchema,
    bankName: z.string().trim().min(1).max(150),
    branchName: z.string().trim().min(1).max(150),
  })
  .refine((v) => v.accountNumber === v.accountNumberConfirm, { message: "Account numbers don't match.", path: ["accountNumberConfirm"] });

const changeRequestStatutoryChanges = z.object({
  pan: z.string().trim().toUpperCase().regex(PAN_REGEX).optional(),
  aadhaar: z.string().trim().regex(AADHAAR_REGEX).optional(),
  uan: z.string().trim().max(20).optional(),
  esiNumber: z.string().trim().max(20).optional(),
});

const changeRequestPersonalChanges = z.object({
  mobile: z.string().trim().regex(MOBILE_REGEX).optional(),
  personalEmail: gmailSchema.optional(),
  bloodGroup: z.string().trim().max(5).optional(),
});

export const createChangeRequestSchema = z.discriminatedUnion("fieldGroup", [
  z.object({ fieldGroup: z.literal("bank"), changes: changeRequestBankChanges }),
  z.object({ fieldGroup: z.literal("statutory"), changes: changeRequestStatutoryChanges }),
  z.object({ fieldGroup: z.literal("personal"), changes: changeRequestPersonalChanges }),
]);

export const decideChangeRequestSchema = z.object({
  remarks: z.string().trim().max(300).optional(),
});

export const initiateSeparationSchema = z.object({
  lastWorkingDate: dateSchema,
  reason: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(500).optional(),
});

export const employeeListQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  departmentId: z.string().optional(),
  designationId: z.string().optional(),
  locationId: z.string().optional(),
  cityId: z.string().optional(),
  status: z.enum(["ACTIVE", "INACTIVE", "SEPARATED"]).optional(),
  employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  sortBy: z.enum(["employeeCode", "fullName", "dateOfJoining", "status"]).default("employeeCode"),
  sortDir: z.enum(["asc", "desc"]).default("asc"),
});

export const exportQuerySchema = employeeListQuerySchema.omit({ page: true, pageSize: true }).extend({
  // z.coerce.boolean() would parse the string "false" as `true` (any
  // non-empty string is truthy) — since axios serialises a JS `false`
  // param as the literal query string "?includeSensitive=false", that bug
  // meant clicking the *plain* Export button (which explicitly passes
  // includeSensitive: false) could silently produce a sensitive export for
  // anyone holding bank/statutory view permission, bypassing the typed
  // confirmation modal this exact flag gates. z.stringbool() parses
  // "true"/"false" (and "1"/"0", "yes"/"no") the way a query string
  // actually needs.
  includeSensitive: z.stringbool().default(false),
});

export const savedViewCreateSchema = z.object({
  gridKey: z.string().trim().min(1).max(50).default("employees"),
  name: z.string().trim().min(1).max(100),
  config: z.record(z.string(), z.unknown()),
});
