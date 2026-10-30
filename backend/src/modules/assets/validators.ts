import { z } from "zod";
import { ASSET_CODE_PATTERN, ASSET_SETTING_KINDS, MAX_ASSET_SETTING_ITEMS } from "@shared/constants/assets";

const code = z.string().trim().regex(ASSET_CODE_PATTERN, "Use 1 to 40 capital letters, digits and underscores.");
const note = z.string().trim().max(1000);
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

export const idParamsSchema = z.object({ id: z.string().min(1).max(64) });
export const employeeParamsSchema = z.object({ employeeId: z.string().min(1).max(64) });
export const kindParamsSchema = z.object({ kind: z.enum(ASSET_SETTING_KINDS) });

export const proposeSettingSchema = z
  .object({
    items: z
      .array(z.object({ code, label: z.string().trim().min(1).max(80), issuable: z.boolean().optional() }).strict())
      .min(1)
      .max(MAX_ASSET_SETTING_ITEMS),
    note: note.optional(),
  })
  .strict();

export const confirmSettingSchema = z.object({ version: z.number().int().min(1), note: note.optional() }).strict();

export const listQuerySchema = z
  .object({
    q: z.string().trim().max(100).optional(),
    categoryCode: code.optional(),
    statusCode: code.optional(),
    holder: z.enum(["any", "assigned", "unassigned"]).default("any"),
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();

export const holdersQuerySchema = z.object({ q: z.string().trim().max(100).default("") }).strict();

export const createAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    categoryCode: code,
    statusCode: code,
    serialNumber: optionalText(120),
    model: optionalText(120),
    notes: optionalText(1000),
  })
  .strict();

export const updateAssetSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    categoryCode: code.optional(),
    statusCode: code.optional(),
    serialNumber: optionalText(120),
    model: optionalText(120),
    notes: optionalText(1000),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change.");

export const issueSchema = z.object({ employeeId: z.string().min(1).max(64), conditionCode: code, note: note.optional() }).strict();
export const returnSchema = z.object({ assignmentId: z.string().min(1).max(64), conditionCode: code, statusCode: code.optional(), note: note.optional() }).strict();
export const transferSchema = z.object({ toEmployeeId: z.string().min(1).max(64), conditionCode: code, note: note.optional() }).strict();
export const lostSchema = z.object({ statusCode: code, note: z.string().trim().min(3).max(1000) }).strict();
export const damagedSchema = z.object({ conditionCode: code, statusCode: code.optional(), note: z.string().trim().min(3).max(1000) }).strict();
