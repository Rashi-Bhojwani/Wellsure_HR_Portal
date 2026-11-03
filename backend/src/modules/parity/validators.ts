import { z } from "zod";

export const idParamsSchema = z.object({ id: z.string().min(1) });
export const reasonQuerySchema = z.object({ reason: z.string().trim().min(3, "Say why you need to see it (a few words)").max(200) });

// The same filters the All Employees grid takes; nothing else is stored.
export const segmentCriteriaSchema = z
  .object({
    search: z.string().trim().max(100).optional(),
    departmentId: z.string().min(1).optional(),
    designationId: z.string().min(1).optional(),
    locationId: z.string().min(1).optional(),
    cityId: z.string().min(1).optional(),
    status: z.enum(["ACTIVE", "INACTIVE", "SEPARATED"]).optional(),
    employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"]).optional(),
    population: z.enum(["current", "past", "all"]).optional(),
  })
  .strict();
export type SegmentCriteria = z.infer<typeof segmentCriteriaSchema>;

const name = z.string().trim().min(1).max(100);
const employeeIds = z.array(z.string().min(1)).min(1).max(2000);

export const createSegmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("FILTER"), name, shared: z.boolean().default(false), criteria: segmentCriteriaSchema }),
  z.object({ kind: z.literal("LIST"), name, shared: z.boolean().default(false), employeeIds }),
]);
export const updateSegmentSchema = z
  .object({ name: name.optional(), shared: z.boolean().optional(), criteria: segmentCriteriaSchema.optional(), employeeIds: employeeIds.optional() })
  .refine((b) => Object.keys(b).length > 0, { message: "Nothing to change." });
export const membersQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(25) });

export const GRID_KEYS = ["employees"] as const;
export const gridKeyParamsSchema = z.object({ gridKey: z.enum(GRID_KEYS) });
export const gridColumnsSchema = z.object({ columns: z.array(z.string().trim().min(1).max(40)).max(40) });

// G2: one attribute changed from the Position screen, through the existing writers. A reason is required here.
export const positionChangeSchema = z.object({
  attribute: z.enum(["department", "designation", "location", "grade", "costCentre", "shift"]),
  valueId: z.string().min(1).nullable(),
  effectiveFrom: z.iso.date(),
  reason: z.string().trim().min(3, "Say why (a few words)").max(300),
});

// G4: the form fields that come with a bulk upload (multipart, so booleans arrive as text).
export const bulkDocumentsSchema = z.object({
  categoryId: z.string().trim().min(1),
  title: z.string().trim().max(200).optional(),
  visibleToEmployee: z.stringbool().default(false),
});
