import { Prisma } from "@prisma/client";
import { PLACEHOLDER_SOURCE_LABEL, RULE_BY_KEY, RULE_CATALOG, type RuleDef } from "@shared/constants/payrollRules";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { type CheckerAvailability } from "../approvals";
import { canonicalJson, payrollHash } from "../hash";
import { appendVersion, confirmVersion, editFingerprint as itemEditFingerprint, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { InvalidRuleValueError, parseRuleValue } from "./schemas";

// Governed rules (docs/plans/PHASE_6.md §3): a payroll rule is an append-only series of versions; a version is Confirmed only by somebody other than its
// author. The mechanics that decide that are shared with components and structures and live in ../items.ts. What is specific to a RULE is here: the
// catalog (what rules exist and what each value looks like), the retype a statutory figure needs, the shipped placeholders.

const KIND = "RULE" as const;
const AUDIT = { entityType: "PayrollRule", actionPrefix: "payroll.rule", eventSubject: "RULE" } as const;

export type RuleStatus = ItemStatus;
export type { VersionView };

export interface RuleView {
  key: string;
  group: string;
  label: string;
  description: string;
  affects: string;
  shape: RuleDef["shape"];
  origin: RuleDef["origin"];
  whoConfirms: string;
  suggestion: string | null;
  status: RuleStatus;
  /** Where the current value came from, in words: "From memory, unverified", "Entered by A on 3 Nov; not yet confirmed", "Confirmed by B on 5 Nov". */
  sourceLabel: string | null;
  /** Typing the value again is required to confirm it. */
  requiresRetype: boolean;
  current: VersionView | null;
  /** The most recent Confirmed version, shown beside an edited one so nothing silently falls back and nothing is lost from view. */
  lastConfirmed: VersionView | null;
}

function viewOf(def: RuleDef, data: Awaited<ReturnType<typeof loadItems>>): RuleView {
  const s = summarise(data, def.key);
  return {
    key: def.key,
    group: def.group,
    label: def.label,
    description: def.description,
    affects: def.affects,
    shape: def.shape,
    origin: def.origin,
    whoConfirms: def.whoConfirms,
    suggestion: def.suggestion ?? null,
    status: s.status,
    sourceLabel: s.sourceLabel,
    requiresRetype: def.origin === "STATUTORY",
    current: s.current,
    lastConfirmed: s.lastConfirmed,
  };
}

export async function listRules(): Promise<RuleView[]> {
  const data = await loadItems(KIND);
  return RULE_CATALOG.map((def) => viewOf(def, data));
}

export async function getRule(key: string): Promise<{ rule: RuleView; history: VersionView[] }> {
  const def = defOf(key);
  const data = await loadItems(KIND, [key]);
  return { rule: viewOf(def, data), history: [...summarise(data, key).history].reverse() };
}

function defOf(key: string): RuleDef {
  const def = RULE_BY_KEY[key];
  if (!def) throw new HttpError(404, "There is no such rule.", "NOT_FOUND");
  return def;
}

function canonicalValue(key: string, raw: unknown): unknown {
  try {
    return parseRuleValue(key, raw);
  } catch (err) {
    if (err instanceof InvalidRuleValueError) throw new HttpError(400, err.message, "VALIDATION_ERROR", { issues: err.issues });
    throw err;
  }
}

// ── Editing ──

export interface EditPreview {
  key: string;
  label: string;
  before: { version: number; value: unknown; status: RuleStatus } | null;
  after: { value: unknown; valueHash: string };
  unchanged: boolean;
  /** The current value is Confirmed: this edit makes it an unconfirmed value until a different person confirms it. */
  willResetConfirmation: boolean;
  lastConfirmed: VersionView | null;
  /** What it will touch. Until payroll runs exist this says so plainly. */
  impact: string;
  fingerprint: string;
}

const editFingerprint = (key: string, baseVersion: number, baseHash: string | null, newHash: string): string => itemEditFingerprint("RULE_EDIT", key, baseVersion, baseHash, newHash);

export async function previewEdit(key: string, rawValue: unknown): Promise<EditPreview> {
  const def = defOf(key);
  const value = canonicalValue(key, rawValue);
  const valueHash = payrollHash(value);
  const rule = (await getRule(key)).rule;
  const baseVersion = rule.current?.version ?? 0;
  return {
    key,
    label: def.label,
    before: rule.current ? { version: rule.current.version, value: rule.current.value, status: rule.status } : null,
    after: { value, valueHash },
    unchanged: rule.current?.valueHash === valueHash,
    willResetConfirmation: rule.status === "CONFIRMED",
    lastConfirmed: rule.status === "CONFIRMED" && rule.current ? rule.current : rule.lastConfirmed,
    impact: "No payroll run has used this value yet, so nothing changes in any figure. From now on test runs use it; real runs cannot until a different person confirms it.",
    fingerprint: editFingerprint(key, baseVersion, rule.current?.valueHash ?? null, valueHash),
  };
}

export async function editRule(key: string, input: { value: unknown; note?: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<RuleView> {
  defOf(key);
  const value = canonicalValue(key, input.value);
  const valueHash = payrollHash(value);
  const before = (await getRule(key)).rule;
  const baseVersion = before.current?.version ?? 0;
  if (before.current?.valueHash === valueHash) throw new HttpError(409, "That is already the current value. Nothing to change.", "NO_CHANGE");
  if (input.fingerprint !== editFingerprint(key, baseVersion, before.current?.valueHash ?? null, valueHash)) {
    throw new HttpError(409, "This changed since you previewed it (somebody else edited the rule, or the value is different). Preview it again.", "PREVIEW_STALE");
  }
  const note = (input.note ?? "").trim().slice(0, 500);
  await appendVersion(KIND, AUDIT, { key, value, note, before: summarise(await loadItems(KIND, [key]), key) }, actor);
  return (await getRule(key)).rule;
}

// ── Confirming ──

export interface ConfirmPreview {
  key: string;
  label: string;
  version: number;
  value: unknown;
  valueHash: string;
  /** "From memory, unverified" for a shipped figure; who entered it and when otherwise. Shown to the confirmer before they act. */
  sourceLabel: string | null;
  requiresRetype: boolean;
  authorName: string;
  /** The reason the actor cannot confirm, if they cannot. */
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export async function previewConfirm(key: string, actorUserId: string): Promise<ConfirmPreview> {
  const def = defOf(key);
  const data = await loadItems(KIND, [key]);
  const p = await previewConfirmation("RULE_CONFIRM", KIND, key, summarise(data, key), actorUserId);
  return { key, label: def.label, ...p, requiresRetype: def.origin === "STATUTORY" };
}

export async function confirmRule(
  key: string,
  input: { version: number; typedValue?: unknown; note: string; fingerprint: string },
  actor: { userId: string; ip?: string | null; userAgent?: string | null },
): Promise<RuleView> {
  const def = defOf(key);
  const summary = summarise(await loadItems(KIND, [key]), key);
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
      auditExtra: { retyped: def.origin === "STATUTORY" },
      extraCheck: (cur) => {
        if (def.origin !== "STATUTORY") return;
        // Confirming means checking, not clicking: the confirmer types the value in again, and it has to be the value on the screen.
        if (input.typedValue === undefined || input.typedValue === null || input.typedValue === "") {
          throw new HttpError(400, `Type the value in again to confirm it. It is a statutory figure (${summary.sourceLabel ?? "unverified"}), so confirming means checking it against its source.`, "RETYPE_REQUIRED");
        }
        let typed: unknown;
        try {
          typed = parseRuleValue(key, input.typedValue);
        } catch (err) {
          if (err instanceof InvalidRuleValueError) throw new HttpError(400, `What you typed is not a valid value: ${err.issues.join("; ")}`, "RETYPE_MISMATCH");
          throw err;
        }
        if (canonicalJson(typed) !== canonicalJson(cur.value)) {
          throw new HttpError(400, "What you typed does not match the value on the screen. Check it against its source and try again; nothing was confirmed.", "RETYPE_MISMATCH");
        }
      },
    },
    actor,
  );
  return (await getRule(key)).rule;
}

// ── The shipped placeholders ──

/**
 * Makes sure every statutory figure the catalog ships exists as version 1, authored by nobody (the System), unconfirmed. Idempotent and additive:
 * a rule that already has any version (someone's edit, or a confirmation) is never touched. Runs in the migrate task and `npm run db:migrate`.
 */
export async function ensurePayrollRules(): Promise<{ created: string[] }> {
  const created: string[] = [];
  for (const def of RULE_CATALOG) {
    if (def.placeholder === undefined) continue;
    const exists = await prisma.payrollItemVersion.findFirst({ where: { kind: KIND, key: def.key }, select: { id: true } });
    if (exists) continue;
    const value = parseRuleValue(def.key, def.placeholder);
    try {
      await prisma.payrollItemVersion.create({ data: { kind: KIND, key: def.key, version: 1, value: value as Prisma.InputJsonValue, valueHash: payrollHash(value), note: PLACEHOLDER_SOURCE_LABEL, authorUserId: null } });
      created.push(def.key);
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002")) throw err;
    }
  }
  return { created };
}
