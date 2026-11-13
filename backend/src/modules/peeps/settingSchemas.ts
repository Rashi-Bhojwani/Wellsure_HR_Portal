import { z } from "zod";
import { BADGE_DURATIONS, DIRECTORY_CONTACT_FIELDS, type PeepsSettingKey } from "@shared/constants/peeps";

// The shape of each Peeps setting's value. Typed and validated, so an inverted window, a negative limit or an unknown giver is refused when entered.
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).");
const code = z.string().trim().regex(/^[A-Z0-9_]{1,40}$/, "Use 1 to 40 capital letters, digits and underscores.");

export const PEEPS_SETTING_SCHEMAS: Record<PeepsSettingKey, z.ZodType> = {
  "office.name": z.string().trim().min(1).max(60),
  "leave.calendarShowsType": z.object({ showType: z.boolean() }).strict(),
  "leave.showSensitiveTypes": z.object({ show: z.boolean() }).strict(),
  "directory.contactFields": z.array(z.enum(DIRECTORY_CONTACT_FIELDS)).max(DIRECTORY_CONTACT_FIELDS.length).refine((a) => new Set(a).size === a.length, "Listed twice."),
  "audience.assets": z.object({ officeManages: z.boolean(), hrOnboardingIssue: z.boolean().optional() }).strict(), // hrOnboardingIssue: only in versions entered before the onboarding route was retired; ignored
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
  "badges.catalogue": z
    .array(z.object({ code, label: z.string().trim().min(1).max(60), description: z.string().trim().max(200).optional(), duration: z.enum(BADGE_DURATIONS), retired: z.boolean().optional() }).strict())
    .min(1)
    .max(100)
    .refine((a) => new Set(a.map((b) => b.code)).size === a.length, "A badge code is listed twice.")
    .refine((a) => a.some((b) => !b.retired), "Keep at least one badge that is not retired."),
  // perPairPerMonth: absent only in versions entered before Stage 3; the service then uses the shipped default.
  "badges.limits": z.object({ perGiverPerMonth: z.number().int().min(1).max(1000), perPairPerMonth: z.number().int().min(1).max(100).optional() }).strict(),
  "badges.repeat": z.object({ allowed: z.boolean() }).strict(),
  "badges.noManagerFallback": z.object({ upTo: z.enum(["DIRECTORS", "NOBODY"]) }).strict(),
  "badges.publicDetails": z.object({ giver: z.boolean(), reason: z.boolean() }).strict(),
  "nudges.catalogue": z
    .array(z.object({ code, label: z.string().trim().min(1).max(40), retired: z.boolean().optional() }).strict())
    .min(1)
    .max(100)
    .refine((a) => new Set(a.map((b) => b.code)).size === a.length, "A tag code is listed twice.")
    .refine((a) => a.some((b) => !b.retired), "Keep at least one tag that is not retired."),
  "nudges.offLimitsWords": z
    .array(z.string().trim().toLowerCase().regex(/^[a-z][a-z' -]{0,39}$/, "Words use letters only (up to 40)."))
    .max(500)
    .refine((a) => new Set(a).size === a.length, "A word is listed twice."),
};

export type AvailabilityWindow = { days: number[]; from: string; to: string };
export type BadgeCatalogueItem = { code: string; label: string; description?: string; duration: "WEEK" | "MONTH" | "PERMANENT"; retired?: boolean };
export type NudgeTagItem = { code: string; label: string; retired?: boolean };
