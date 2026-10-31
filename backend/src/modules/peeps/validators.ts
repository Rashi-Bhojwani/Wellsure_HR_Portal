import { z } from "zod";
import { OFFICE_CAPABILITY_IDS, OFFICE_CHANGE_KINDS, PEEPS_SETTING_KEYS } from "@shared/constants/peeps";

export const settingKeyParams = z.object({ key: z.enum(PEEPS_SETTING_KEYS) });
export const enterSettingSchema = z.object({ value: z.unknown(), note: z.string().trim().max(500).optional() }).strict();
export const confirmSettingSchema = z.object({ version: z.number().int().min(1) }).strict();

export const idParams = z.object({ id: z.string().min(1).max(64) });
export const proposeChangeSchema = z
  .object({
    kind: z.enum(OFFICE_CHANGE_KINDS),
    employeeId: z.string().min(1).max(64),
    fromEmployeeId: z.string().min(1).max(64).optional(),
    capabilities: z.array(z.enum(OFFICE_CAPABILITY_IDS)).max(OFFICE_CAPABILITY_IDS.length).optional(),
    effectiveFrom: z.iso.datetime().optional(),
    reason: z.string().trim().min(3).max(500),
  })
  .strict();
export const peopleQuery = z.object({ q: z.string().trim().max(100).default("") }).strict();
