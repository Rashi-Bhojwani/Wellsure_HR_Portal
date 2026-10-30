import { z } from "zod";
import { DIRECTOR_STEPS } from "@shared/constants/directorAuthority";

export const stepParamsSchema = z.object({ step: z.enum(DIRECTOR_STEPS) });
export const setSwitchSchema = z.object({ mode: z.enum(["SECOND_DIRECTOR", "DIRECTOR_AUTHORITY"]) });
export const noticeIdParamsSchema = z.object({ id: z.string().min(1) });
export const noticesQuerySchema = z.object({ status: z.enum(["open", "all"]).optional() });
export const acknowledgeNoticeSchema = z.object({ note: z.string().trim().min(3).max(500) });
