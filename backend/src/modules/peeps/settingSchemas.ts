import { z } from "zod";
import { GIVER_KINDS, type PeepsSettingKey } from "@shared/constants/peeps";

// The shape of each Peeps setting's value. Typed and validated, so an inverted window, a negative limit or an unknown giver is refused when entered.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
const code = z.string().trim().regex(/^[A-Z0-9_]{1,40}$/, "Use 1 to 40 capital letters, digits and underscores.");
const givers = z.array(z.enum(GIVER_KINDS)).max(GIVER_KINDS.length).refine((a) => new Set(a).size === a.length, "Listed twice.");

export const PEEPS_SETTING_SCHEMAS: Record<PeepsSettingKey, z.ZodType> = {
  "office.name": z.string().trim().min(1).max(60),
  "audience.assets": z.object({ officeManages: z.boolean(), hrOnboardingIssue: z.boolean() }).strict(),
  "assets.newJoinerWindowDays": z.number().int().min(1).max(366),
  "audience.unmute": z.object({ employeesMayBook: z.boolean() }).strict(),
  "unmute.sessionMinutes": z.number().int().min(5).max(240),
  "unmute.availability": z
    .object({ days: z.array(z.number().int().min(0).max(6)).min(1).max(7), from: hhmm, to: hhmm })
    .strict()
    .refine((v) => new Set(v.days).size === v.days.length, "A day is listed twice.")
    .refine((v) => v.from < v.to, "The window must end after it starts."),
  "unmute.bookingWindowDays": z.number().int().min(1).max(365),
  "unmute.minNoticeHours": z.number().int().min(0).max(720),
  "unmute.cancellationNoticeHours": z.number().int().min(0).max(720),
  "audience.badges": z.object({ givers }).strict(),
  "badges.catalogue": z
    .array(z.object({ code, label: z.string().trim().min(1).max(60), description: z.string().trim().max(200).optional() }).strict())
    .min(1)
    .max(100)
    .refine((a) => new Set(a.map((b) => b.code)).size === a.length, "A badge code is listed twice."),
  "badges.limits": z.object({ perGiverPerMonth: z.number().int().min(1).max(1000) }).strict(),
  "badges.durationDays": z.number().int().min(1).max(3650),
  "badges.revocation": z.object({ allowed: z.boolean() }).strict(),
  "badges.display": z.object({ profile: z.boolean(), directory: z.boolean() }).strict(),
  "audience.nudges": z.object({ senders: givers }).strict(),
  "nudges.limits": z.object({ perSenderPerMonth: z.number().int().min(1).max(1000) }).strict(),
  "nudges.revocation": z.object({ allowed: z.boolean() }).strict(),
};

export type AvailabilityWindow = { days: number[]; from: string; to: string };
export type BadgeCatalogueItem = { code: string; label: string; description?: string };
