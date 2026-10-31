import { Prisma } from "@prisma/client";
import { z } from "zod";
import { LEAVE_CAP_PERIODS, LEAVE_COUNTING, LEAVE_EMPLOYMENT_TYPES, LEAVE_ENCASHMENT, LEAVE_ROUTES, LEAVE_UNITS, LEAVE_YEAR_END_BALANCE } from "@shared/constants/peepsLeave";

// The owner-entered rules of one new leave type (docs/plans/PEEPS_PLAN.md, "Final instructions", Module 2). A version is complete or refused: every
// required rule is chosen by a person, nothing here has a default. Days are exact decimals, kept as strings ("2" or "1.5").

const days = z
  .string()
  .trim()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, "Use a number of days such as 3 or 1.5.")
  .refine((v) => new Prisma.Decimal(v).gt(0), "More than zero days.");
const unique = <T>(a: T[]) => new Set(a).size === a.length;

export const leaveRulesSchema = z
  .object({
    paid: z.boolean(),
    entitlement: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("CAP"), period: z.enum(LEAVE_CAP_PERIODS), days }).strict(),
      z.object({ kind: z.literal("GRANTED_BALANCE") }).strict(),
    ]),
    eligibility: z
      .object({
        minServiceDays: z.number().int().min(0).max(3650),
        employmentTypes: z.array(z.enum(LEAVE_EMPLOYMENT_TYPES)).min(1, "Choose at least one employment type.").refine(unique, "Listed twice."),
      })
      .strict(),
    units: z.enum(LEAVE_UNITS),
    counting: z.enum(LEAVE_COUNTING),
    document: z.object({ required: z.boolean(), whenMoreThanDays: z.number().int().min(0).max(365) }).strict(),
    approvalRoute: z.enum(LEAVE_ROUTES),
    // Year end (carry-forward and encashment): an interface for the payroll session only. Null = Not set; the type stays out of year end either way.
    yearEnd: z.object({ carryForward: z.enum(LEAVE_YEAR_END_BALANCE), encashment: z.enum(LEAVE_ENCASHMENT) }).strict().nullable(),
  })
  .strict()
  .refine((r) => r.entitlement.kind !== "GRANTED_BALANCE" || r.yearEnd !== null, { message: "A granted balance needs its year-end rule (lapse or carry forward).", path: ["yearEnd"] });

export type LeaveRules = z.infer<typeof leaveRulesSchema>;

/** Whether a request of `totalDays` needs a supporting document under these rules. */
export const documentNeeded = (rules: LeaveRules, totalDays: Prisma.Decimal): boolean => rules.document.required && totalDays.gt(rules.document.whenMoreThanDays);
