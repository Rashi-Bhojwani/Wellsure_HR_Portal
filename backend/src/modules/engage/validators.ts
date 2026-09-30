import { z } from "zod";

export const idParamsSchema = z.object({ id: z.string().min(1) });

export const employeeSearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(100),
});

export const listFeedQuerySchema = z.object({
  kind: z.enum(["USER", "KUDOS", "POLL", "AUTO_BIRTHDAY", "AUTO_JOINING", "AUTO_ANNIVERSARY"]).optional(),
  groupId: z.string().min(1).optional(),
  locationId: z.string().min(1).optional(),
  departmentId: z.string().min(1).optional(),
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const listModerationQuerySchema = z.object({
  moderated: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const createPostSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  groupId: z.string().min(1).optional(),
});

export const giveKudosSchema = z.object({
  toEmployeeId: z.string().min(1),
  message: z.string().trim().min(1).max(500),
  groupId: z.string().min(1).optional(),
});

export const createPollSchema = z.object({
  question: z.string().trim().min(1).max(300),
  options: z.array(z.string().trim().min(1).max(120)).min(2).max(10),
  groupId: z.string().min(1).optional(),
  closesAt: z.string().datetime().optional(),
});

export const votePollSchema = z.object({
  pollOptionId: z.string().min(1),
});

export const addCommentSchema = z.object({
  body: z.string().trim().min(1).max(1000),
});

export const reactSchema = z.object({
  emoji: z.string().trim().min(1).max(8),
});

export const createGroupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
});

export const updateGroupSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).nullable().optional(),
  isActive: z.boolean().optional(),
});

export const groupMemberParamsSchema = z.object({ id: z.string().min(1), employeeId: z.string().min(1) });

export const updateAutoPostSettingSchema = z.object({
  enabled: z.boolean().optional(),
  template: z.string().trim().min(1).max(500).optional(),
});

export const autoPostKindParamsSchema = z.object({ kind: z.enum(["BIRTHDAY", "JOINING", "ANNIVERSARY"]) });

export const updateDailyRunHourSchema = z.object({
  dailyRunHour: z.number().int().min(0).max(23),
});
