import { Prisma } from "@prisma/client";
import { ASSET_SETTING_KINDS, ASSET_SETTING_LABELS, type AssetSettingItem, type AssetSettingKind } from "@shared/constants/assets";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { isActiveSuperAdmin } from "../../lib/superAdminGuard";
import { HttpError } from "../../middleware/errorHandler";
import type { ActorMeta } from "./types";

// Asset categories, statuses and conditions (owner's brief: settings, Not set until chosen). Each list is a series of append-only versions; the one in
// force is the newest version a director has confirmed, and the director must not be the person who entered it (also enforced by a database trigger).
// While any of the three lists has no confirmed version, the register refuses to add, issue, transfer or change anything (assertReady).

export interface SettingVersionView {
  version: number;
  items: AssetSettingItem[];
  note: string;
  enteredByMe: boolean;
  enteredByName: string | null;
  enteredAt: string;
  confirmedByName: string | null;
  confirmedAt: string | null;
}

export interface SettingKindView {
  kind: AssetSettingKind;
  label: string;
  what: string;
  inForce: SettingVersionView | null;
  /** A newer version waiting for a director's confirmation. */
  pending: SettingVersionView | null;
}

export interface AssetSettingsView {
  ready: boolean;
  missing: AssetSettingKind[];
  kinds: SettingKindView[];
}

/** The lists in force, for validating codes and showing labels. A code from an older version keeps its last label (history never loses its words). */
export interface InForceLists {
  ready: boolean;
  missing: AssetSettingKind[];
  categories: AssetSettingItem[];
  statuses: AssetSettingItem[];
  conditions: AssetSettingItem[];
  label(kind: AssetSettingKind, code: string | null | undefined): string | null;
}

const asItems = (value: Prisma.JsonValue): AssetSettingItem[] => (Array.isArray(value) ? (value as unknown as AssetSettingItem[]) : []);

async function userNames(userIds: string[]): Promise<Map<string, string>> {
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(userIds)] } },
    select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } },
  });
  return new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
}

export async function loadInForce(client: Prisma.TransactionClient | typeof prisma = prisma): Promise<InForceLists> {
  const versions = await client.assetSettingVersion.findMany({ orderBy: [{ kind: "asc" }, { version: "desc" }], include: { confirmation: { select: { id: true } } } });
  const current = new Map<AssetSettingKind, AssetSettingItem[]>();
  const labels = new Map<string, string>();
  // Oldest first, so a newer label wins.
  for (const v of [...versions].reverse()) for (const item of asItems(v.value)) labels.set(`${v.kind}:${item.code}`, item.label);
  for (const v of versions) if (v.confirmation && !current.has(v.kind)) current.set(v.kind, asItems(v.value));
  for (const [kind, items] of current) for (const item of items) labels.set(`${kind}:${item.code}`, item.label);
  const missing = ASSET_SETTING_KINDS.filter((k) => !current.has(k));
  return {
    ready: missing.length === 0,
    missing,
    categories: current.get("CATEGORIES") ?? [],
    statuses: current.get("STATUSES") ?? [],
    conditions: current.get("CONDITIONS") ?? [],
    label: (kind, code) => (code ? (labels.get(`${kind}:${code}`) ?? code) : null),
  };
}

/** The confirmed lists only (what the register's forms offer), for readers of the register who may not see the settings screen. */
export async function inForceLists(): Promise<{ ready: boolean; missing: AssetSettingKind[]; categories: AssetSettingItem[]; statuses: AssetSettingItem[]; conditions: AssetSettingItem[] }> {
  const { ready, missing, categories, statuses, conditions } = await loadInForce();
  return { ready, missing, categories, statuses, conditions };
}

export const NOT_SET_UP_CODE = "ASSETS_NOT_SET_UP";

export function assertReady(lists: InForceLists): void {
  if (lists.ready) return;
  const names = lists.missing.map((k) => ASSET_SETTING_LABELS[k].label.toLowerCase()).join(", ");
  throw new HttpError(409, `The asset register is not set up yet: ${names} ${lists.missing.length === 1 ? "is" : "are"} Not set. HR Admin enters them and a director confirms them.`, NOT_SET_UP_CODE);
}

export async function getSettings(viewerUserId: string): Promise<AssetSettingsView> {
  const versions = await prisma.assetSettingVersion.findMany({ orderBy: [{ kind: "asc" }, { version: "desc" }], include: { confirmation: true } });
  const names = await userNames(versions.flatMap((v) => [v.enteredByUserId, ...(v.confirmation ? [v.confirmation.confirmedByUserId] : [])]));
  const view = (v: (typeof versions)[number]): SettingVersionView => ({
    version: v.version,
    items: asItems(v.value),
    note: v.note,
    enteredByMe: v.enteredByUserId === viewerUserId,
    enteredByName: names.get(v.enteredByUserId) ?? null,
    enteredAt: v.enteredAt.toISOString(),
    confirmedByName: v.confirmation ? (names.get(v.confirmation.confirmedByUserId) ?? null) : null,
    confirmedAt: v.confirmation?.confirmedAt.toISOString() ?? null,
  });
  const kinds = ASSET_SETTING_KINDS.map((kind): SettingKindView => {
    const ofKind = versions.filter((v) => v.kind === kind);
    const confirmed = ofKind.find((v) => v.confirmation);
    const latest = ofKind[0];
    return {
      kind,
      ...ASSET_SETTING_LABELS[kind],
      inForce: confirmed ? view(confirmed) : null,
      pending: latest && !latest.confirmation ? view(latest) : null,
    };
  });
  const missing = kinds.filter((k) => !k.inForce).map((k) => k.kind);
  return { ready: missing.length === 0, missing, kinds };
}

/** Codes still used by the register: a list that drops one of these is refused (a register entry must always name a live category and status). */
async function codesInUse(kind: AssetSettingKind, client: Prisma.TransactionClient | typeof prisma): Promise<Set<string>> {
  if (kind === "CATEGORIES") return new Set((await client.asset.findMany({ distinct: ["categoryCode"], select: { categoryCode: true } })).map((a) => a.categoryCode));
  if (kind === "STATUSES") return new Set((await client.asset.findMany({ distinct: ["statusCode"], select: { statusCode: true } })).map((a) => a.statusCode));
  return new Set();
}

function validateItems(kind: AssetSettingKind, items: AssetSettingItem[]): AssetSettingItem[] {
  const codes = new Set<string>();
  const labels = new Set<string>();
  for (const item of items) {
    if (codes.has(item.code)) throw new HttpError(400, `The code ${item.code} is listed twice.`, "VALIDATION_ERROR");
    const lower = item.label.toLowerCase();
    if (labels.has(lower)) throw new HttpError(400, `The label "${item.label}" is listed twice.`, "VALIDATION_ERROR");
    codes.add(item.code);
    labels.add(lower);
  }
  if (kind === "STATUSES" && !items.some((i) => i.issuable)) {
    throw new HttpError(400, "At least one status must allow an asset to be issued, or no asset could ever be issued.", "VALIDATION_ERROR");
  }
  return items.map((i) => (kind === "STATUSES" ? { code: i.code, label: i.label, issuable: Boolean(i.issuable) } : { code: i.code, label: i.label }));
}

async function assertKeepsCodesInUse(kind: AssetSettingKind, items: AssetSettingItem[], client: Prisma.TransactionClient | typeof prisma): Promise<void> {
  const keep = new Set(items.map((i) => i.code));
  const dropped = [...(await codesInUse(kind, client))].filter((c) => !keep.has(c));
  if (dropped.length > 0) {
    throw new HttpError(409, `These ${ASSET_SETTING_LABELS[kind].label.toLowerCase()} are still used by assets in the register and cannot be removed: ${dropped.join(", ")}. You can rename them.`, "ASSET_SETTING_IN_USE");
  }
}

export async function proposeSetting(kind: AssetSettingKind, input: { items: AssetSettingItem[]; note?: string }, meta: ActorMeta): Promise<SettingKindView> {
  const items = validateItems(kind, input.items);
  await prisma.$transaction(
    async (tx) => {
      await assertKeepsCodesInUse(kind, items, tx);
      const last = await tx.assetSettingVersion.findFirst({ where: { kind }, orderBy: { version: "desc" }, select: { version: true } });
      const row = await tx.assetSettingVersion.create({
        data: { kind, version: (last?.version ?? 0) + 1, value: items as unknown as Prisma.InputJsonValue, note: input.note ?? "", enteredByUserId: meta.actorUserId },
      });
      await writeAuditLogs([{ ...meta, action: "assets.setting.entered", entityType: "AssetSettingVersion", entityId: row.id, after: { kind, version: row.version, items } }], tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
  return (await getSettings(meta.actorUserId)).kinds.find((k) => k.kind === kind)!;
}

export async function confirmSetting(kind: AssetSettingKind, input: { version: number; note?: string }, meta: ActorMeta): Promise<SettingKindView> {
  if (!(await isActiveSuperAdmin(meta.actorUserId))) throw new HttpError(403, "Only a director confirms an asset setting.", "DIRECTORS_ONLY");
  await prisma.$transaction(async (tx) => {
    const row = await tx.assetSettingVersion.findUnique({ where: { kind_version: { kind, version: input.version } }, include: { confirmation: true } });
    if (!row) throw new HttpError(404, "That version does not exist.", "NOT_FOUND");
    if (row.confirmation) throw new HttpError(409, "That version is already confirmed.", "ALREADY_CONFIRMED");
    const latest = await tx.assetSettingVersion.findFirst({ where: { kind }, orderBy: { version: "desc" }, select: { version: true } });
    if (latest && latest.version !== row.version) throw new HttpError(409, "A newer version has been entered since; confirm that one instead.", "STALE_VERSION");
    if (row.enteredByUserId === meta.actorUserId) throw new HttpError(403, "The person who entered a setting cannot confirm it. Another director confirms it.", "SAME_PERSON");
    await assertKeepsCodesInUse(kind, asItems(row.value), tx);
    const confirmation = await tx.assetSettingConfirmation.create({ data: { versionId: row.id, confirmedByUserId: meta.actorUserId, note: input.note ?? "" } });
    await writeAuditLogs([{ ...meta, action: "assets.setting.confirmed", entityType: "AssetSettingVersion", entityId: row.id, after: { kind, version: row.version, confirmationId: confirmation.id } }], tx);
  });
  return (await getSettings(meta.actorUserId)).kinds.find((k) => k.kind === kind)!;
}
