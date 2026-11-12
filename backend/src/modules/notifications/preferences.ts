import { prisma } from "../../lib/prisma";
import { NOTIFICATION_CATEGORIES, categoryOfType, type NotificationCategory } from "@shared/constants/notificationPreferences";

// NT-09 (M session): a person's own notification choices. Only the categories in shared/constants/notificationPreferences.ts can be switched off;
// anything else (approvals, decisions, security, payroll, helpdesk) is always delivered.

export async function myPreferences(userId: string) {
  const rows = await prisma.notificationPreference.findMany({ where: { userId } });
  const muted = new Set(rows.filter((r) => r.muted).map((r) => r.category));
  return NOTIFICATION_CATEGORIES.map((c) => ({ key: c.key, label: c.label, on: !muted.has(c.key) }));
}

export async function setPreference(userId: string, category: NotificationCategory, on: boolean) {
  await prisma.notificationPreference.upsert({ where: { userId_category: { userId, category } }, create: { userId, category, muted: !on }, update: { muted: !on } });
  return myPreferences(userId);
}

/** False when this person switched off the category this notification type belongs to. */
export async function wantsNotification(userId: string, type: string): Promise<boolean> {
  const category = categoryOfType(type);
  if (!category) return true;
  const row = await prisma.notificationPreference.findUnique({ where: { userId_category: { userId, category } }, select: { muted: true } });
  return !row?.muted;
}
