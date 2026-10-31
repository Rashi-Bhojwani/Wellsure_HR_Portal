import { z } from "zod";
import { PEEPS_LEAVE_TYPE_CODES } from "@shared/constants/peepsLeave";

export const codeParams = z.object({ code: z.enum(PEEPS_LEAVE_TYPE_CODES) });
export const versionParams = z.object({ code: z.enum(PEEPS_LEAVE_TYPE_CODES), version: z.coerce.number().int().min(1) });
// The rules themselves are checked by the typed schema in rules.ts (all required, no defaults); this only shapes the envelope.
export const prepareSchema = z.object({ rules: z.unknown(), note: z.string().trim().max(500).optional() }).strict();
export const approveSchema = z.object({ effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD."), note: z.string().trim().max(500).optional() }).strict();
export const requestParams = z.object({ requestId: z.string().min(1).max(64) });
export const documentParams = z.object({ documentId: z.string().min(1).max(64) });
