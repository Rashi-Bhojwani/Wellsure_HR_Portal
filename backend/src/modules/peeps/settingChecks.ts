import type { PeepsSettingKey } from "@shared/constants/peeps";
import { writeAuditLogs } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { getSetting } from "./settings";
import type { BadgeCatalogueItem, NudgeTagItem } from "./settingSchemas";
import type { ActorMeta, PeepsActor } from "./types";

// Checks a new setting version against what is already recorded (Peeps Stage 3), before it is entered:
//   - a badge or nudge tag that has ever been given cannot be deleted from its catalogue, only retired (past awards keep their name);
//   - a nudge tag name may not contain an off-limits word (whole word, any case).

/** Whole-word, case-insensitive match of any off-limits word in a tag name. */
export function offLimitsWordIn(label: string, words: readonly string[]): string | null {
  const tokens = label.toLowerCase().split(/[^a-z']+/).filter(Boolean);
  const joined = ` ${tokens.join(" ")} `;
  for (const w of words) if (joined.includes(` ${w.toLowerCase().trim()} `)) return w;
  return null;
}

async function droppedButGiven(previous: Array<{ code: string }>, next: Array<{ code: string }>, given: (codes: string[]) => Promise<string[]>): Promise<string[]> {
  const kept = new Set(next.map((x) => x.code));
  const dropped = previous.map((x) => x.code).filter((c) => !kept.has(c));
  return dropped.length ? given(dropped) : [];
}

export async function checkSettingChange(key: PeepsSettingKey, value: unknown): Promise<void> {
  if (key === "badges.catalogue") {
    const prev = (await getSetting<BadgeCatalogueItem[]>("badges.catalogue")) ?? [];
    const blocked = await droppedButGiven(prev, value as BadgeCatalogueItem[], async (codes) =>
      (await prisma.badgeAward.findMany({ where: { badgeCode: { in: codes } }, distinct: ["badgeCode"], select: { badgeCode: true } })).map((r) => r.badgeCode),
    );
    if (blocked.length) throw new HttpError(400, `Already given, so it can only be retired, not deleted: ${blocked.join(", ")}.`, "RETIRE_INSTEAD");
  }
  if (key === "nudges.catalogue") {
    const tags = value as NudgeTagItem[];
    const words = (await getSetting<string[]>("nudges.offLimitsWords")) ?? [];
    const bad = tags.filter((t) => !t.retired).map((t) => [t.label, offLimitsWordIn(t.label, words)] as const).filter(([, w]) => w);
    if (bad.length) throw new HttpError(400, `These tag names use an off-limits word: ${bad.map(([l]) => l).join(", ")}.`, "OFF_LIMITS_WORD");
    const prev = (await getSetting<NudgeTagItem[]>("nudges.catalogue")) ?? [];
    const blocked = await droppedButGiven(prev, tags, async (codes) =>
      (await prisma.nudgeTagAward.findMany({ where: { tagCode: { in: codes } }, distinct: ["tagCode"], select: { tagCode: true } })).map((r) => r.tagCode),
    );
    if (blocked.length) throw new HttpError(400, `Already given, so it can only be retired, not deleted: ${blocked.join(", ")}.`, "RETIRE_INSTEAD");
  }
}

/** After a catalogue version is confirmed: one audit entry per badge or tag newly retired, renamed or added, so each change is findable on its own. */
export async function auditCatalogueRetirements(key: PeepsSettingKey, previous: unknown, actor: PeepsActor, meta: ActorMeta): Promise<void> {
  if (key !== "badges.catalogue" && key !== "nudges.catalogue") return;
  const before = new Map(((previous as Array<{ code: string; label: string; retired?: boolean }>) ?? []).map((x) => [x.code, x]));
  const after = (await getSetting<Array<{ code: string; label: string; retired?: boolean }>>(key)) ?? [];
  const what = key === "badges.catalogue" ? "badges" : "nudges";
  const rows = [];
  for (const item of after) {
    const old = before.get(item.code);
    if (!old) rows.push({ ...meta, action: `${what}.catalogue.added`, entityType: "PeepsSetting", entityId: key, after: { code: item.code, label: item.label } });
    else {
      if (!old.retired && item.retired) rows.push({ ...meta, action: `${what}.catalogue.retired`, entityType: "PeepsSetting", entityId: key, after: { code: item.code } });
      if (old.retired && !item.retired) rows.push({ ...meta, action: `${what}.catalogue.restored`, entityType: "PeepsSetting", entityId: key, after: { code: item.code } });
      if (old.label !== item.label) rows.push({ ...meta, action: `${what}.catalogue.renamed`, entityType: "PeepsSetting", entityId: key, before: { label: old.label }, after: { code: item.code, label: item.label } });
    }
  }
  if (rows.length) await writeAuditLogs(rows);
  void actor;
}
