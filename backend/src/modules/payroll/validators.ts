import { z } from "zod";

export const ruleKeyParamsSchema = z.object({ key: z.string().regex(/^[A-Z][A-Z0-9_]{2,60}$/) });

export const ruleEditPreviewSchema = z.object({ value: z.unknown() });
export const ruleEditSchema = z.object({ value: z.unknown(), note: z.string().trim().max(500).optional(), fingerprint: z.string().min(10).max(200) });

export const ruleConfirmSchema = z.object({
  version: z.number().int().min(1),
  typedValue: z.unknown().optional(),
  note: z.string().trim().min(1).max(500),
  fingerprint: z.string().min(10).max(200),
});

export const checkersQuerySchema = z.object({
  subject: z.enum(["RUN_APPROVAL", "PERIOD_FINALISE", "PAYSLIP_PUBLISH", "BANK_FILE", "PERIOD_UNLOCK", "RULE_CONFIRM", "SALARY_REVISION"]),
});

export const payrollAuditQuerySchema = z.object({
  action: z.string().trim().max(100).optional(),
  entityType: z.string().trim().max(100).optional(),
  dateFrom: z.iso.date().optional(),
  dateTo: z.iso.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
});

export const setupAreaParamsSchema = z.object({ area: z.enum(["SALARIES", "BANK_ACCOUNTS", "STATUTORY_IDS"]) });
export const setupSignoffSchema = z.object({ fingerprint: z.string().min(10).max(200), note: z.string().trim().min(1).max(500) });
