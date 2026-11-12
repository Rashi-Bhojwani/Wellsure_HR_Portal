import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { resolveAccess } from "../../lib/permissions";
import { writeAuditLogs } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { HttpError } from "../../middleware/errorHandler";
import type { AuthenticatedUser } from "../../middleware/types";
import { memberStateFor } from "../peeps/office";
import { suppress, type Cell, type Table } from "./suppression";

// Insights (Peeps stage 2): turnover, tenure, exit reasons and the hiring funnel, aggregate only, for directors and Wellsure Office
// members holding the VIEW_INSIGHTS capability. Every definition, the window, the early-attrition threshold and the minimum group
// size are director settings, Not set until chosen; a metric refuses and names what is missing. No pay is read. Exit interviews are
// never read: exit reasons come from the resignation's reason category or the separation mode only, never free text.

export const SETTING_SCHEMAS = {
  minimumGroupSize: z.object({ n: z.number().int().min(2).max(1000) }).strict(),
  window: z.object({ months: z.number().int().min(1).max(120) }).strict(),
  earlyAttrition: z.object({ months: z.number().int().min(1).max(120) }).strict(),
  turnover: z.object({ denominator: z.enum(["AVERAGE_HEADCOUNT", "OPENING_HEADCOUNT"]) }).strict(),
  tenure: z.object({ basis: z.enum(["ACTIVE_AT_END", "LEAVERS_IN_WINDOW"]) }).strict(),
  exitReasons: z.object({ source: z.enum(["RESIGNATION_REASON_CATEGORY", "SEPARATION_MODE"]) }).strict(),
  hiringFunnel: z.object({ basis: z.enum(["FURTHEST_STAGE"]) }).strict(),
} as const;
export type SettingKey = keyof typeof SETTING_SCHEMAS;
export const keySchema = z.enum(Object.keys(SETTING_SCHEMAS) as [SettingKey, ...SettingKey[]]);
export const settingInput = z.object({ value: z.unknown(), version: z.number().int().min(0), reason: z.string().trim().min(1).max(2000) }).strict();
export const METRICS = { turnover: ["window", "minimumGroupSize", "turnover", "earlyAttrition"], tenure: ["window", "minimumGroupSize", "tenure"], "exit-reasons": ["window", "minimumGroupSize", "exitReasons"], "hiring-funnel": ["window", "minimumGroupSize", "hiringFunnel"] } as const satisfies Record<string, readonly SettingKey[]>;
export type Metric = keyof typeof METRICS;
export const metricSchema = z.object({ metric: z.enum(Object.keys(METRICS) as [Metric, ...Metric[]]) }).strict();
type Meta = { actorUserId: string; ipAddress?: string | null; userAgent?: string | null };

// ── Who may look ──
export async function viewer(actor: AuthenticatedUser) {
  const access = await resolveAccess(actor.userId);
  if (access.roleCodes.includes("DEVELOPER")) throw new HttpError(403, "Insights are unavailable to Developer.", "FORBIDDEN");
  const member = await memberStateFor(actor.employeeId);
  const isDirector = access.isSuperAdmin;
  const isMember = Boolean(member?.capabilities.includes("VIEW_INSIGHTS"));
  return { ...actor, isDirector, isMember, allowed: isDirector || isMember };
}
async function requireViewer(actor: AuthenticatedUser) {
  const v = await viewer(actor);
  if (!v.allowed) throw new HttpError(403, "Insights are for the directors and Wellsure Office members with the Insights capability.", "FORBIDDEN");
  return v;
}

// ── Settings: append-only versions, a director chooses, audited ──
const latest = (key: SettingKey) => prisma.insightsSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } });
export async function getSetting<K extends SettingKey>(key: K): Promise<z.infer<(typeof SETTING_SCHEMAS)[K]> | null> {
  const row = await latest(key);
  return row?.value == null ? null : (SETTING_SCHEMAS[key].parse(row.value) as z.infer<(typeof SETTING_SCHEMAS)[K]>);
}
export async function viewSettings(actor: AuthenticatedUser) {
  const v = await requireViewer(actor);
  return {
    canEdit: v.isDirector,
    settings: await Promise.all((Object.keys(SETTING_SCHEMAS) as SettingKey[]).map(async (key) => { const r = await latest(key); return { key, state: r?.value == null ? "NOT_SET" : "CONFIRMED", version: r?.version ?? 0, value: r?.value ?? null }; })),
  };
}
export async function setSetting(key: SettingKey, input: z.infer<typeof settingInput>, actor: AuthenticatedUser, meta: Meta) {
  const v = await viewer(actor);
  if (!v.isDirector) throw new HttpError(403, "Only a director chooses Insights settings.", "FORBIDDEN");
  const value = input.value === null ? null : SETTING_SCHEMAS[key].parse(input.value);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('peeps.insights.setting'), hashtext(${key}))::text`;
    const prior = await tx.insightsSettingVersion.findFirst({ where: { key }, orderBy: { version: "desc" } });
    if ((prior?.version ?? 0) !== input.version) throw new HttpError(409, "This setting changed. Reload before saving.", "CONFLICT");
    const row = await tx.insightsSettingVersion.create({ data: { key, version: input.version + 1, value: value === null ? Prisma.JsonNull : value, reason: input.reason, changedByUserId: actor.userId } });
    await writeAuditLogs([{ ...meta, action: "insights.setting.confirmed", entityType: "InsightsSettingVersion", entityId: row.id, after: { key, version: row.version } }], tx);
  });
  return viewSettings(actor);
}
export async function status(actor: AuthenticatedUser) {
  const v = await viewer(actor);
  if (!v.allowed) return { allowed: false, isDirector: false, missing: {} };
  const missing: Record<string, SettingKey[]> = {};
  for (const [metric, keys] of Object.entries(METRICS)) missing[metric] = (await Promise.all(keys.map(async (k) => ((await getSetting(k)) === null ? k : null)))).filter((k): k is SettingKey => k !== null);
  return { allowed: true, isDirector: v.isDirector, missing };
}
async function requireSettings(metric: Metric) {
  const missing: SettingKey[] = [];
  for (const k of METRICS[metric]) if ((await getSetting(k)) === null) missing.push(k);
  if (missing.length) throw new HttpError(409, `Insights: ${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} Not set. A director must choose ${missing.length === 1 ? "it" : "them"} first.`, "INSIGHTS_NOT_SET");
}

// ── Population helpers (no pay, no personal data leaves this module) ──
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
function windowOf(months: number) {
  const end = new Date(businessToday().getTime());
  const start = new Date(end);
  start.setUTCMonth(start.getUTCMonth() - months);
  return { start, end };
}
type Person = { id: string; joined: Date; left: Date | null; jobs: Array<{ departmentId: string; from: Date; to: Date | null }> };
async function people(): Promise<Person[]> {
  const rows = await prisma.employee.findMany({
    select: { id: true, dateOfJoining: true, separations: { where: { status: { not: "CANCELLED" } }, select: { lastWorkingDate: true }, orderBy: { lastWorkingDate: "desc" }, take: 1 }, jobHistory: { select: { departmentId: true, effectiveFrom: true, effectiveTo: true } } },
  });
  return rows.map((r) => ({ id: r.id, joined: r.dateOfJoining, left: r.separations[0]?.lastWorkingDate ?? null, jobs: r.jobHistory.map((j) => ({ departmentId: j.departmentId, from: j.effectiveFrom, to: j.effectiveTo })) }));
}
const activeOn = (p: Person, d: Date) => p.joined <= d && (!p.left || p.left >= d);
const deptOn = (p: Person, d: Date) => p.jobs.find((j) => j.from <= d && (!j.to || j.to > d))?.departmentId ?? p.jobs.sort((a, b) => +b.from - +a.from)[0]?.departmentId ?? "UNKNOWN";
const months = (from: Date, to: Date) => (to.getTime() - from.getTime()) / (DAY * 30.4375);
const pct = (num: number, den: number) => (den > 0 ? new Prisma.Decimal(num).mul(100).div(den).toDecimalPlaces(2).toFixed(2) : null);
function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return new Prisma.Decimal(s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2).toDecimalPlaces(1).toFixed(1);
}
async function departmentLabels() {
  const rows = await prisma.department.findMany({ select: { id: true, name: true } });
  return new Map(rows.map((r) => [r.id, r.name]));
}

// ── Metrics ──
type Result = { metric: Metric; window: { from: string; to: string }; minimumGroupSize: number; definition: unknown; table: Table<Record<string, string | number | null>> };
export async function compute(metric: Metric): Promise<Result> {
  await requireSettings(metric);
  const k = (await getSetting("minimumGroupSize"))!.n;
  const { start, end } = windowOf((await getSetting("window"))!.months);
  const window = { from: iso(start), to: iso(end) };
  if (metric === "hiring-funnel") return { metric, window, minimumGroupSize: k, definition: await getSetting("hiringFunnel"), table: await funnel(start, end, k) };
  if (metric === "exit-reasons") {
    const def = (await getSetting("exitReasons"))!;
    return { metric, window, minimumGroupSize: k, definition: def, table: await exitReasons(start, end, k, def.source) };
  }
  const labels = await departmentLabels();
  const all = await people();
  const groups = new Map<string, Person[]>();
  for (const p of all) {
    if (!(p.joined <= end && (!p.left || p.left >= start))) continue; // present at some point in the window
    const d = deptOn(p, p.left && p.left < end ? p.left : end);
    groups.set(d, [...(groups.get(d) ?? []), p]);
  }
  if (metric === "turnover") {
    const def = (await getSetting("turnover"))!, early = (await getSetting("earlyAttrition"))!.months;
    const figures = (ps: Person[]) => {
      const leavers = ps.filter((p) => p.left && p.left >= start && p.left <= end);
      const opening = ps.filter((p) => activeOn(p, start)).length, closing = ps.filter((p) => activeOn(p, end)).length;
      const headcount = def.denominator === "OPENING_HEADCOUNT" ? opening : (opening + closing) / 2;
      return { leavers: leavers.length, earlyLeavers: leavers.filter((p) => months(p.joined, p.left!) < early).length, headcount: new Prisma.Decimal(headcount).toFixed(1), turnoverPercent: pct(leavers.length, headcount) };
    };
    const cells: Cell<Record<string, string | number | null>>[] = [...groups].map(([id, ps]) => ({ key: id, label: labels.get(id) ?? "Unassigned", n: ps.length, value: figures(ps) }));
    return { metric, window, minimumGroupSize: k, definition: { ...def, earlyAttritionMonths: early }, table: suppress(cells, { n: cells.reduce((s, c) => s + c.n, 0), value: figures([...groups.values()].flat()) }, k) };
  }
  const def = (await getSetting("tenure"))!;
  const sample = (ps: Person[]) => (def.basis === "ACTIVE_AT_END" ? ps.filter((p) => activeOn(p, end)).map((p) => months(p.joined, end)) : ps.filter((p) => p.left && p.left >= start && p.left <= end).map((p) => months(p.joined, p.left!)));
  const cells: Cell<Record<string, string | number | null>>[] = [...groups].map(([id, ps]) => { const xs = sample(ps); return { key: id, label: labels.get(id) ?? "Unassigned", n: xs.length, value: { medianTenureMonths: median(xs) } }; });
  const allXs = sample([...groups.values()].flat());
  return { metric, window, minimumGroupSize: k, definition: def, table: suppress(cells, { n: allXs.length, value: { medianTenureMonths: median(allXs) } }, k) };
}

async function exitReasons(start: Date, end: Date, k: number, source: "RESIGNATION_REASON_CATEGORY" | "SEPARATION_MODE") {
  const counts = new Map<string, { label: string; n: number }>();
  if (source === "SEPARATION_MODE") {
    const rows = await prisma.separation.findMany({ where: { status: { not: "CANCELLED" }, lastWorkingDate: { gte: start, lte: end } }, select: { mode: { select: { code: true, label: true } } } });
    for (const r of rows) { const key = r.mode?.code ?? "NOT_RECORDED"; counts.set(key, { label: r.mode?.label ?? "Not recorded", n: (counts.get(key)?.n ?? 0) + 1 }); }
  } else {
    // Only the category code chosen from the director's list: never the free-text reason, never an exit interview.
    const rows = await prisma.resignation.findMany({ where: { status: "ACCEPTED", requestedLastDay: { gte: start, lte: end } }, select: { reasonCategory: true } });
    for (const r of rows) counts.set(r.reasonCategory, { label: r.reasonCategory, n: (counts.get(r.reasonCategory)?.n ?? 0) + 1 });
  }
  const cells = [...counts].map(([key, c]) => ({ key, label: c.label, n: c.n, value: { leavers: c.n } as Record<string, string | number | null> }));
  const total = cells.reduce((s, c) => s + c.n, 0);
  return suppress(cells, { n: total, value: { leavers: total } }, k);
}

async function funnel(start: Date, end: Date, k: number) {
  // Each application in the window counts once, at the furthest stage it reached (disjoint cells, so the suppression rule holds).
  const apps = await prisma.recruitmentApplication.findMany({ where: { createdAt: { gte: start, lte: new Date(end.getTime() + DAY) } }, select: { status: true, stage: { select: { code: true, label: true, position: true } }, moves: { select: { toStageId: true } } } });
  const stages = await prisma.recruitmentPipelineStage.findMany({ where: { id: { in: [...new Set(apps.flatMap((a) => a.moves.map((m) => m.toStageId)))] } }, select: { id: true, code: true, label: true, position: true } });
  const byId = new Map(stages.map((s) => [s.id, s]));
  const cells = new Map<string, { label: string; position: number; n: number }>();
  for (const a of apps) {
    const furthest = a.status === "HIRED" ? { code: "HIRED_STATUS", label: "Hired", position: 10_000 } : [a.stage, ...a.moves.map((m) => byId.get(m.toStageId)).filter((s): s is NonNullable<typeof s> => Boolean(s))].sort((x, y) => y.position - x.position)[0]!;
    const c = cells.get(furthest.code) ?? { label: furthest.label, position: furthest.position, n: 0 };
    c.n++; cells.set(furthest.code, c);
  }
  const list = [...cells].sort((a, b) => a[1].position - b[1].position).map(([key, c]) => ({ key, label: c.label, n: c.n, value: { applications: c.n } as Record<string, string | number | null> }));
  return suppress(list, { n: apps.length, value: { applications: apps.length } }, k);
}

export async function view(metric: Metric, actor: AuthenticatedUser, meta: Meta) {
  const v = await requireViewer(actor);
  const result = await compute(metric);
  await writeAuditLogs([{ ...meta, action: "insights.viewed", entityType: "Insights", entityId: metric, after: { as: v.isDirector ? "DIRECTOR" : "OFFICE_MEMBER" } }]);
  return result;
}

const csvCell = (v: unknown) => { const s = v === null || v === undefined ? "" : String(v); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
export async function exportCsv(metric: Metric, actor: AuthenticatedUser, meta: Meta) {
  const v = await requireViewer(actor);
  const r = await compute(metric);
  const keys = [...new Set(r.table.cells.flatMap((c) => Object.keys(c.value ?? {})).concat(Object.keys(r.table.total.value ?? {})))];
  const lines = [["group", "people", ...keys, "shown"].join(",")];
  for (const c of r.table.cells) lines.push([csvCell(c.label), csvCell(c.n), ...keys.map((k) => csvCell(c.value?.[k] ?? null)), c.suppressed ? "suppressed (small group)" : "yes"].join(","));
  lines.push(["Total", csvCell(r.table.total.n), ...keys.map((k) => csvCell((r.table.total.value as Record<string, unknown> | null)?.[k] ?? null)), r.table.total.suppressed ? "suppressed (small group)" : "yes"].join(","));
  await writeAuditLogs([{ ...meta, action: "insights.exported", entityType: "Insights", entityId: metric, after: { as: v.isDirector ? "DIRECTOR" : "OFFICE_MEMBER" } }]);
  return { filename: `insights-${metric}-${r.window.from}-to-${r.window.to}.csv`, body: lines.join("\n") + "\n" };
}
