import type { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";

// Admin Dashboard tab's "Edit" button (spec §7.1) — one row per user,
// widget visibility + order. Every known dashboard widget key, so the
// frontend always has a full, ordered list to render the Edit modal from
// even before the user has ever customised anything.
export const DASHBOARD_WIDGET_KEYS = [
  "yearsInService",
  "additionsAttrition",
  "headcountByLocation",
  "headcountByCity",
  "ageDistribution",
  "genderSplit",
  "departmentHeadcount",
] as const;

export interface WidgetLayoutEntry {
  key: string;
  visible: boolean;
}

function defaultLayout(): WidgetLayoutEntry[] {
  return DASHBOARD_WIDGET_KEYS.map((key) => ({ key, visible: true }));
}

export async function getLayout(userId: string): Promise<WidgetLayoutEntry[]> {
  const row = await prisma.dashboardLayout.findUnique({ where: { userId } });
  return row ? (row.layout as unknown as WidgetLayoutEntry[]) : defaultLayout();
}

export async function saveLayout(userId: string, layout: WidgetLayoutEntry[]): Promise<WidgetLayoutEntry[]> {
  const row = await prisma.dashboardLayout.upsert({
    where: { userId },
    create: { userId, layout: layout as unknown as Prisma.InputJsonValue },
    update: { layout: layout as unknown as Prisma.InputJsonValue },
  });
  return row.layout as unknown as WidgetLayoutEntry[];
}
