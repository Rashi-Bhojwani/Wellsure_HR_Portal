import { Prisma } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import type { SettingKey } from "./service";

// DEMO company only: fictional Insights choices so the demo shows figures. A real company starts with every Insights setting Not set.
export async function seedDemoInsights(who: Record<string, { employeeId: string; userId: string }>) {
  if ((await prisma.systemSetting.findUnique({ where: { key: "demo.company" } }))?.value !== true) throw new Error("Insights demo requires labelled DEMO company.");
  if (await prisma.insightsSettingVersion.count()) return;
  const choices: Array<[SettingKey, unknown]> = [["window", { months: 12 }], ["minimumGroupSize", { n: 3 }], ["earlyAttrition", { months: 6 }], ["turnover", { denominator: "AVERAGE_HEADCOUNT" }], ["tenure", { basis: "ACTIVE_AT_END" }], ["exitReasons", { source: "SEPARATION_MODE" }], ["hiringFunnel", { basis: "FURTHEST_STAGE" }]];
  for (const [key, value] of choices) await prisma.insightsSettingVersion.create({ data: { key, version: 1, value: value as Prisma.InputJsonValue, reason: "DEMO COMPANY: fictional Insights choice", changedByUserId: who.DEMO001!.userId } });
}
