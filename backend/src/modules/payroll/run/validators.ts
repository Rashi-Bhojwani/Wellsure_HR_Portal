import { z } from "zod";

export const runIdParamsSchema = z.object({ id: z.string().min(1).max(60) });
export const runItemParamsSchema = z.object({ id: z.string().min(1).max(60), employeeId: z.string().min(1).max(60) });
export const runListQuerySchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) });
export const readinessQuerySchema = z.object({ cycleStart: z.iso.date() });
export const runCreateSchema = z.object({ cycleStart: z.iso.date() });
export const runCalculateSchema = z.object({ fingerprint: z.string().min(10).max(200) });
export const runVoidSchema = z.object({ reason: z.string().trim().min(3).max(300) });
export const varianceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  changedOnly: z.enum(["true", "false"]).default("false"),
  flaggedOnly: z.enum(["true", "false"]).default("false"),
});

// Submitting, approving, finalising, unlocking, publishing and the bank file (P6-4): one shape for all of them.
export const stepParamsSchema = z.object({ id: z.string().min(1).max(60), slug: z.enum(["run", "finalise", "unlock", "publish", "bank-file"]) });
export const stepRequestSchema = z.object({ fingerprint: z.string().min(10).max(200), note: z.string().trim().max(500).optional() });
export const stepDecisionSchema = z
  .object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional(), hash: z.string().min(10).max(200).optional() })
  .refine((b) => b.decision === "REJECT" || !!b.hash, { message: "Approving needs the hash of the figures you were shown", path: ["hash"] });
export const stepWithdrawSchema = z.object({ reason: z.string().trim().min(3).max(300), fingerprint: z.string().min(10).max(200) });

// Releases (P6-5)
export const slipIdParamsSchema = z.object({ id: z.string().min(1).max(60) });
export const previewParamsSchema = z.object({ id: z.string().min(1).max(60), employeeId: z.string().min(1).max(60) });
export const markPaidSchema = z.object({ reference: z.string().trim().min(3).max(60), paidOn: z.iso.date(), confirm: z.string().trim().min(1).max(20) });
export const outputGenerateSchema = z.object({ kind: z.enum(["PF_ECR", "ESI", "PT", "LWF", "SALARY_REGISTER"]) });
export const layoutKeyParamsSchema = z.object({ key: z.enum(["BANK_TEMPLATE", "BANK_RETURN_TEMPLATE", "PF_ECR", "ESI", "PT", "LWF"]) });
export const layoutSavePreviewSchema = z.object({ value: z.unknown() });
export const layoutSaveSchema = z.object({ value: z.unknown(), note: z.string().trim().max(500).optional(), fingerprint: z.string().min(10).max(200) });
export const layoutConfirmSchema = z.object({ version: z.number().int().min(1), note: z.string().trim().min(1).max(500), fingerprint: z.string().min(10).max(200) });
