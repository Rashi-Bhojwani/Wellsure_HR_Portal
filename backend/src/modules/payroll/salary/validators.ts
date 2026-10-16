import { z } from "zod";
import { ITEM_CODE_PATTERN } from "@shared/constants/payrollSalary";
import { revisionInputSchema } from "./revisions";

export const codeParamsSchema = z.object({ code: z.string().regex(ITEM_CODE_PATTERN) });
export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
export const employeeParamsSchema = z.object({ employeeId: z.string().min(1).max(64) });

const fingerprint = z.string().min(10).max(200);
const note = z.string().trim().max(500).optional();

export const itemSavePreviewSchema = z.object({ value: z.unknown() });
export const componentSaveSchema = z.object({ value: z.unknown(), note, fingerprint });
export const structureSavePreviewSchema = z.object({ value: z.unknown(), sampleAnnualCtc: z.unknown() });
export const structureSaveSchema = z.object({ value: z.unknown(), sampleAnnualCtc: z.unknown(), note, fingerprint });
export const structureBreakupSchema = z.object({ value: z.unknown(), annualCtc: z.unknown(), perPerson: z.unknown().optional() });
export const itemConfirmSchema = z.object({ version: z.number().int().min(1), note: z.string().trim().min(1).max(500), fingerprint });

export const peopleSearchSchema = z.object({ q: z.string().trim().min(1).max(60) });

export const revisionPreviewSchema = z.object({ input: z.unknown() });
export const revisionCreateSchema = z.object({ input: z.unknown(), fingerprint });
export const revisionSubmitSchema = z.object({ fingerprint });
export const revisionWithdrawSchema = z.object({ reason: z.string().trim().min(1).max(300) });
export const revisionDecisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), note: z.string().trim().max(500).optional(), fingerprint });
export const revisionListSchema = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) });

export const adjustmentPreviewSchema = z.object({ input: z.unknown() });
export const adjustmentAddSchema = z.object({ input: z.unknown(), fingerprint });
export const adjustmentCancelSchema = z.object({ reason: z.string().trim().min(1).max(300) });
export const adjustmentListSchema = z.object({
  employeeId: z.string().max(64).optional(),
  status: z.enum(["PENDING", "CONSUMED", "CANCELLED"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export { revisionInputSchema };
