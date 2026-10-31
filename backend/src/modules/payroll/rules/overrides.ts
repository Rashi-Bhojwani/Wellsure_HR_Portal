import { OVERRIDABLE_RULE_KEYS, OVERRIDE_LEVELS, RULE_BY_KEY, type OverrideLevel } from "@shared/constants/payrollRules";
import { businessToday } from "../../../lib/businessDate";
import { namesOn } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { type CheckerAvailability } from "../approvals";
import { canonicalJson, payrollHash } from "../hash";
import { appendVersion, confirmVersion, editFingerprint as itemEditFingerprint, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { assertNotOwnPay } from "../salary/guards";
import { InvalidRuleValueError, parseRuleValue } from "./schemas";

// The rule hierarchy (Stage 3.4, docs/plans/PAYROLL_MODEL_PLAN.md). For the parameters of PF, ESI, professional tax and labour welfare fund: the company's rule is the
// default; a department can have its own; a person can have their own; the most specific wins. An override is a governed item of its own (versions, a confirmation by a
// different director, a source note, an effective-from date), so it is a Placeholder until a different director confirms it, and a run that used a Placeholder override
// is a test run. Nothing is preselected: there are no overrides until a director makes one.
//
// The key of an override is rule ~ level ~ target ~ effective-from, so two windows for the same person are two items and can never overlap.

const KIND = "RULE_OVERRIDE" as const;
const AUDIT = { entityType: "PayrollRuleOverride", actionPrefix: "payroll.rule_override", eventSubject: "RULE_OVERRIDE" } as const;
const SEP = "~";

export interface OverrideValue {
  ruleKey: string;
  level: OverrideLevel;
  targetId: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo: string | null;
  reason: string;
  /** The registration (PF establishment, ESI code, PT or LWF registration) this set of parameters belongs to; statutory files can later be split by it. */
  registrationRef: string | null;
}

export const overrideKey = (ruleKey: string, level: OverrideLevel, targetId: string, effectiveFrom: string): string => [ruleKey, level, targetId, effectiveFrom].join(SEP);

// ── The resolver: pure ──

export interface OverrideItem {
  itemKey: string;
  ruleKey: string;
  level: OverrideLevel;
  targetId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  valueHash: string;
  value: unknown;
  confirmed: boolean;
  registrationRef: string | null;
  sourceNote: string;
  reason: string;
}

const activeOn = (i: Pick<OverrideItem, "effectiveFrom" | "effectiveTo">, day: string): boolean => i.effectiveFrom <= day && (i.effectiveTo === null || i.effectiveTo >= day);

export const windowsOverlap = (a: { effectiveFrom: string; effectiveTo: string | null }, b: { effectiveFrom: string; effectiveTo: string | null }): boolean =>
  a.effectiveFrom <= (b.effectiveTo ?? "9999-12-31") && b.effectiveFrom <= (a.effectiveTo ?? "9999-12-31");

/**
 * The override that decides one rule for one person on one day, or null when the company's rule stands: an employee override beats a department override; an override
 * counts only inside its dates. Within a level and target the windows cannot overlap (the service refuses it), so at most one applies.
 */
export function resolveRule(items: readonly OverrideItem[], ruleKey: string, who: { employeeId: string; departmentId: string | null }, day: string): OverrideItem | null {
  const live = items.filter((i) => i.ruleKey === ruleKey && activeOn(i, day));
  return live.find((i) => i.level === "EMPLOYEE" && i.targetId === who.employeeId) ?? live.find((i) => i.level === "DEPARTMENT" && who.departmentId !== null && i.targetId === who.departmentId) ?? null;
}

export function resolveOverrides(items: readonly OverrideItem[], who: { employeeId: string; departmentId: string | null }, day: string): Map<string, OverrideItem> {
  const out = new Map<string, OverrideItem>();
  for (const key of OVERRIDABLE_RULE_KEYS) {
    const hit = resolveRule(items, key, who, day);
    if (hit) out.set(key, hit);
  }
  return out;
}

// ── Reading ──

function itemOf(key: string, s: ReturnType<typeof summarise>): OverrideItem | null {
  const cur = s.current;
  if (!cur) return null;
  const v = cur.value as OverrideValue;
  return { itemKey: key, ruleKey: v.ruleKey, level: v.level, targetId: v.targetId, effectiveFrom: v.effectiveFrom, effectiveTo: v.effectiveTo, version: cur.version, valueHash: cur.valueHash, value: v.value, confirmed: Boolean(cur.confirmation), registrationRef: v.registrationRef, sourceNote: cur.sourceNote, reason: v.reason };
}

/** Every override as it stands now (its newest version), for a run and for the screen. */
export async function loadOverrideItems(): Promise<OverrideItem[]> {
  const data = await loadItems(KIND);
  const keys = [...new Set(data.versions.map((v) => v.key))];
  return keys.map((k) => itemOf(k, summarise(data, k))).filter((i): i is OverrideItem => i !== null);
}

export interface OverrideView extends OverrideItem {
  ruleLabel: string;
  targetName: string;
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
}

export async function listOverrides(): Promise<OverrideView[]> {
  const data = await loadItems(KIND);
  const keys = [...new Set(data.versions.map((v) => v.key))];
  const views: Array<{ item: OverrideItem; s: ReturnType<typeof summarise> }> = [];
  for (const k of keys) {
    const s = summarise(data, k);
    const item = itemOf(k, s);
    if (item) views.push({ item, s });
  }
  const departments = await prisma.department.findMany({ where: { id: { in: views.filter((v) => v.item.level === "DEPARTMENT").map((v) => v.item.targetId) } }, select: { id: true, name: true } });
  const deptName = new Map(departments.map((d) => [d.id, d.name]));
  const employeeIds = views.filter((v) => v.item.level === "EMPLOYEE").map((v) => v.item.targetId);
  const people = await namesOn(employeeIds, businessToday());
  const codes = new Map((await prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true, employeeCode: true } })).map((e) => [e.id, e.employeeCode]));
  return views
    .map(({ item, s }) => ({
      ...item,
      ruleLabel: RULE_BY_KEY[item.ruleKey]?.label ?? item.ruleKey,
      targetName: item.level === "DEPARTMENT" ? (deptName.get(item.targetId) ?? item.targetId) : `${people.get(item.targetId) ?? "Unknown"} (${codes.get(item.targetId) ?? item.targetId})`,
      status: s.status,
      sourceLabel: s.sourceLabel,
      current: s.current,
    }))
    .sort((a, b) => a.ruleKey.localeCompare(b.ruleKey) || a.level.localeCompare(b.level) || a.effectiveFrom.localeCompare(b.effectiveFrom));
}

// ── Saving ──

export interface OverrideInput {
  ruleKey: string;
  level: OverrideLevel;
  targetId: string;
  value: unknown;
  effectiveFrom: string;
  effectiveTo?: string | null;
  reason: string;
  sourceNote: string;
  registrationRef?: string | null;
}

const isDay = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

async function validate(raw: OverrideInput, actorUserId: string): Promise<{ key: string; value: OverrideValue; sourceNote: string }> {
  if (!(OVERRIDABLE_RULE_KEYS as readonly string[]).includes(raw.ruleKey)) throw new HttpError(400, `${raw.ruleKey} cannot be overridden. Only the parameters of PF, ESI, professional tax and labour welfare fund can.`, "VALIDATION_ERROR");
  if (!(OVERRIDE_LEVELS as readonly string[]).includes(raw.level)) throw new HttpError(400, "An override is for a department or for a person.", "VALIDATION_ERROR");
  if (!isDay(raw.effectiveFrom)) throw new HttpError(400, "Say from which date the override applies (YYYY-MM-DD).", "EFFECTIVE_FROM_REQUIRED");
  const effectiveTo = raw.effectiveTo ? raw.effectiveTo : null;
  if (effectiveTo !== null && (!isDay(effectiveTo) || effectiveTo < raw.effectiveFrom)) throw new HttpError(400, "The last day has to be a date on or after the first day.", "VALIDATION_ERROR");
  const reason = (raw.reason ?? "").trim();
  if (reason.length < 3) throw new HttpError(400, "Say why this person or department is treated differently.", "REASON_REQUIRED");
  const sourceNote = (raw.sourceNote ?? "").trim().slice(0, 500);
  if (sourceNote.length < 10) throw new HttpError(400, "Say where this number came from (the notification, circular, order or letter, and its date): a few words at least. The director who confirms it checks it against that.", "SOURCE_NOTE_REQUIRED");
  let value: unknown;
  try {
    value = parseRuleValue(raw.ruleKey, raw.value);
  } catch (err) {
    if (err instanceof InvalidRuleValueError) throw new HttpError(400, err.message, "VALIDATION_ERROR", { issues: err.issues });
    throw err;
  }
  if (raw.level === "DEPARTMENT") {
    if (!(await prisma.department.findUnique({ where: { id: raw.targetId }, select: { id: true } }))) throw new HttpError(404, "That department was not found.", "NOT_FOUND");
  } else {
    if (!(await prisma.employee.findUnique({ where: { id: raw.targetId }, select: { id: true } }))) throw new HttpError(404, "That employee was not found.", "NOT_FOUND");
    await assertNotOwnPay(actorUserId, [raw.targetId], "This override");
  }
  const registrationRef = raw.registrationRef?.trim() ? raw.registrationRef.trim().slice(0, 64) : null;
  const key = overrideKey(raw.ruleKey, raw.level, raw.targetId, raw.effectiveFrom);
  return { key, sourceNote, value: { ruleKey: raw.ruleKey, level: raw.level, targetId: raw.targetId, value, effectiveFrom: raw.effectiveFrom, effectiveTo, reason, registrationRef } };
}

async function assertNoOverlap(key: string, v: OverrideValue): Promise<void> {
  for (const other of await loadOverrideItems()) {
    if (other.itemKey === key || other.ruleKey !== v.ruleKey || other.level !== v.level || other.targetId !== v.targetId) continue;
    if (windowsOverlap(other, v)) throw new HttpError(409, `That overlaps another override of the same rule for the same ${v.level === "EMPLOYEE" ? "person" : "department"} (${other.effectiveFrom} to ${other.effectiveTo ?? "no end date"}). End the earlier one first, or change the dates.`, "OVERRIDE_OVERLAP");
  }
}

export interface OverridePreview {
  key: string;
  isNew: boolean;
  before: { version: number; status: ItemStatus } | null;
  after: { value: OverrideValue; valueHash: string };
  unchanged: boolean;
  willResetConfirmation: boolean;
  impact: string;
  fingerprint: string;
}

const fingerprintOf = (key: string, baseVersion: number, baseHash: string | null, newHash: string) => itemEditFingerprint("RULE_OVERRIDE_EDIT", key, baseVersion, baseHash, newHash);

export async function previewOverride(raw: OverrideInput, actorUserId: string): Promise<OverridePreview> {
  const { key, value, sourceNote } = await validate(raw, actorUserId);
  await assertNoOverlap(key, value);
  const s = summarise(await loadItems(KIND, [key]), key);
  const valueHash = payrollHash({ v: value, s: sourceNote });
  return {
    key,
    isNew: !s.current,
    before: s.current ? { version: s.current.version, status: s.status } : null,
    after: { value, valueHash },
    unchanged: s.current ? payrollHash({ v: s.current.value, s: s.current.sourceNote }) === valueHash : false,
    willResetConfirmation: s.status === "CONFIRMED",
    impact: "Until a different director confirms it, a payroll run that uses this override is a TEST run. Nothing already paid changes.",
    fingerprint: fingerprintOf(key, s.current?.version ?? 0, s.current?.valueHash ?? null, valueHash),
  };
}

export async function saveOverride(raw: OverrideInput, fingerprint: string, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<OverrideView | undefined> {
  const { key, value, sourceNote } = await validate(raw, actor.userId);
  await assertNoOverlap(key, value);
  const before = summarise(await loadItems(KIND, [key]), key);
  const valueHash = payrollHash({ v: value, s: sourceNote });
  if (before.current && payrollHash({ v: before.current.value, s: before.current.sourceNote }) === valueHash) throw new HttpError(409, "That is already the current value. Nothing to change.", "NO_CHANGE");
  if (fingerprint !== fingerprintOf(key, before.current?.version ?? 0, before.current?.valueHash ?? null, valueHash)) throw new HttpError(409, "This changed since you previewed it. Preview it again.", "PREVIEW_STALE");
  await appendVersion(KIND, AUDIT, { key, value, note: value.reason, sourceNote, effectiveFrom: value.effectiveFrom, before }, actor);
  return (await listOverrides()).find((o) => o.itemKey === key);
}

// ── Confirming: a different director, who types the value in again against the source note ──

export interface OverrideConfirmPreview {
  key: string;
  version: number;
  value: OverrideValue;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  sourceNote: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export async function previewOverrideConfirm(key: string, actorUserId: string): Promise<OverrideConfirmPreview> {
  const data = await loadItems(KIND, [key]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such override.", "NOT_FOUND");
  const summary = summarise(data, key);
  const p = await previewConfirmation("RULE_CONFIRM", KIND, key, summary, actorUserId);
  return { key, ...p, value: p.value as OverrideValue, sourceNote: summary.current?.sourceNote ?? "" };
}

export async function confirmOverride(key: string, input: { version: number; typedValue?: unknown; note: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<void> {
  const data = await loadItems(KIND, [key]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such override.", "NOT_FOUND");
  const summary = summarise(data, key);
  await confirmVersion(
    "RULE_CONFIRM",
    KIND,
    AUDIT,
    {
      key,
      version: input.version,
      note: input.note,
      fingerprint: input.fingerprint,
      summary,
      auditExtra: { retyped: true },
      extraCheck: (cur) => {
        // Confirming means checking: type the figure in again, from the source note.
        if (input.typedValue === undefined || input.typedValue === null || input.typedValue === "") throw new HttpError(400, "Type the value in again to confirm it, checking it against the source note.", "RETYPE_REQUIRED");
        const ruleKey = (cur.value as OverrideValue).ruleKey;
        let typed: unknown;
        try {
          typed = parseRuleValue(ruleKey, input.typedValue);
        } catch (err) {
          if (err instanceof InvalidRuleValueError) throw new HttpError(400, `What you typed is not a valid value: ${err.issues.join("; ")}`, "RETYPE_MISMATCH");
          throw err;
        }
        if (canonicalJson(typed) !== canonicalJson((cur.value as OverrideValue).value)) throw new HttpError(400, "What you typed does not match the value on the screen. Check it against its source and try again; nothing was confirmed.", "RETYPE_MISMATCH");
      },
    },
    actor,
  );
}

export async function getOverrideHistory(key: string): Promise<VersionView[]> {
  const data = await loadItems(KIND, [key]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such override.", "NOT_FOUND");
  return [...summarise(data, key).history].reverse();
}
