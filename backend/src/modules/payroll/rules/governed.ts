import { Prisma } from "@prisma/client";
import { PLACEHOLDER_SOURCE_LABEL, RULE_BY_KEY, RULE_CATALOG, type RuleDef } from "@shared/constants/payrollRules";
import { writeAuditLog } from "../../../lib/audit";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { SYSTEM_MAKER, checkerAvailability, recordCompletedApproval, registerSubject, type CheckerAvailability } from "../approvals";
import { recordEvent } from "../events";
import { canonicalJson, payrollHash } from "../hash";
import { namesOfUsers } from "../names";
import { InvalidRuleValueError, parseRuleValue } from "./schemas";

// Governed items (docs/plans/PHASE_6.md §3): a payroll rule is an append-only series of versions; a version is Confirmed only by a row in
// payroll_item_confirmations made by somebody other than its author. Editing never changes a version, it adds the next one, which has no
// confirmation: so changing a Confirmed rule "resets it to unconfirmed" by construction, and the last Confirmed value stays on record.
// Only the RULE kind is wired in P6-1; components, structures and templates reuse the same tables in the commits that build them.

const KIND = "RULE" as const;

export type RuleStatus = "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";

export interface VersionView {
  version: number;
  value: unknown;
  valueHash: string;
  note: string;
  authorUserId: string | null;
  authorName: string;
  createdAt: string;
  confirmation: { confirmedByUserId: string; confirmedByName: string; confirmedAt: string; note: string } | null;
}

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

const SYSTEM_NAME = "System (shipped placeholder)";
const day = (d: Date) => d.toISOString().slice(0, 10);

async function loadVersions(keys?: string[]) {
  const where = { kind: KIND, ...(keys ? { key: { in: keys } } : {}) };
  const [versions, confirmations] = await Promise.all([
    prisma.payrollItemVersion.findMany({ where, orderBy: [{ key: "asc" }, { version: "asc" }] }),
    prisma.payrollItemConfirmation.findMany({ where }),
  ]);
  const people = await namesOfUsers([...versions.map((v) => v.authorUserId ?? ""), ...confirmations.map((c) => c.confirmedByUserId)]);
  return { versions, confirmations, people };
}

function buildViews(data: Awaited<ReturnType<typeof loadVersions>>, defs: readonly RuleDef[]): RuleView[] {
  const confirmationOf = new Map(data.confirmations.map((c) => [`${c.key}@${c.version}`, c]));
  const byKey = new Map<string, typeof data.versions>();
  for (const v of data.versions) byKey.set(v.key, [...(byKey.get(v.key) ?? []), v]);
  const viewOf = (v: (typeof data.versions)[number]): VersionView => {
    const c = confirmationOf.get(`${v.key}@${v.version}`);
    return {
      version: v.version,
      value: v.value,
      valueHash: v.valueHash,
      note: v.note,
      authorUserId: v.authorUserId,
      authorName: v.authorUserId ? (data.people.get(v.authorUserId) ?? "Someone") : SYSTEM_NAME,
      createdAt: v.createdAt.toISOString(),
      confirmation: c ? { confirmedByUserId: c.confirmedByUserId, confirmedByName: data.people.get(c.confirmedByUserId) ?? "Someone", confirmedAt: c.confirmedAt.toISOString(), note: c.note } : null,
    };
  };
  return defs.map((def): RuleView => {
    const versions = byKey.get(def.key) ?? [];
    const currentRow = versions[versions.length - 1];
    const current = currentRow ? viewOf(currentRow) : null;
    const lastConfirmedRow = [...versions].reverse().find((v) => confirmationOf.has(`${v.key}@${v.version}`));
    const lastConfirmed = lastConfirmedRow && lastConfirmedRow !== currentRow ? viewOf(lastConfirmedRow) : null;
    const status: RuleStatus = !current ? "NOT_SET" : current.confirmation ? "CONFIRMED" : "PLACEHOLDER";
    let sourceLabel: string | null = null;
    if (current?.confirmation) sourceLabel = `Confirmed by ${current.confirmation.confirmedByName} on ${day(new Date(current.confirmation.confirmedAt))}`;
    else if (current) sourceLabel = current.authorUserId === null ? PLACEHOLDER_SOURCE_LABEL : `Entered by ${current.authorName} on ${day(new Date(current.createdAt))}; not yet confirmed`;
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
      status,
      sourceLabel,
      requiresRetype: def.origin === "STATUTORY",
      current,
      lastConfirmed,
    };
  });
}

export async function listRules(): Promise<RuleView[]> {
  return buildViews(await loadVersions(), RULE_CATALOG);
}

export async function getRule(key: string): Promise<{ rule: RuleView; history: VersionView[] }> {
  const def = RULE_BY_KEY[key];
  if (!def) throw new HttpError(404, "There is no such rule.", "NOT_FOUND");
  const data = await loadVersions([key]);
  const rule = buildViews(data, [def])[0]!;
  const confirmationOf = new Map(data.confirmations.map((c) => [c.version, c]));
  const history = data.versions
    .map((v): VersionView => {
      const c = confirmationOf.get(v.version);
      return {
        version: v.version,
        value: v.value,
        valueHash: v.valueHash,
        note: v.note,
        authorUserId: v.authorUserId,
        authorName: v.authorUserId ? (data.people.get(v.authorUserId) ?? "Someone") : SYSTEM_NAME,
        createdAt: v.createdAt.toISOString(),
        confirmation: c ? { confirmedByUserId: c.confirmedByUserId, confirmedByName: data.people.get(c.confirmedByUserId) ?? "Someone", confirmedAt: c.confirmedAt.toISOString(), note: c.note } : null,
      };
    })
    .reverse();
  return { rule, history };
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

const editFingerprint = (key: string, baseVersion: number, baseHash: string | null, newHash: string): string => payrollHash({ t: "RULE_EDIT", key, baseVersion, baseHash, newHash });

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
  try {
    await prisma.$transaction(async (tx) => {
      await tx.payrollItemVersion.create({ data: { kind: KIND, key, version: baseVersion + 1, value: value as Prisma.InputJsonValue, valueHash, note, authorUserId: actor.userId } });
      await recordEvent({ subjectType: "RULE", subjectId: key, type: "EDITED", actorUserId: actor.userId, payload: { version: baseVersion + 1, valueHash, wasConfirmed: before.status === "CONFIRMED" } }, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "Somebody else edited this rule at the same moment. Look at it again.", "PREVIEW_STALE");
    throw err;
  }
  await writeAuditLog({
    actorUserId: actor.userId,
    action: "payroll.rule.edited",
    entityType: "PayrollRule",
    entityId: key,
    before: before.current ? { version: before.current.version, value: before.current.value, status: before.status } : null,
    after: { version: baseVersion + 1, value, status: "PLACEHOLDER", note, resetConfirmation: before.status === "CONFIRMED" },
    ipAddress: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
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

const confirmFingerprint = (key: string, version: number, valueHash: string): string => payrollHash({ t: "RULE_CONFIRM", key, version, valueHash });

export async function previewConfirm(key: string, actorUserId: string): Promise<ConfirmPreview> {
  defOf(key);
  const { rule } = await getRule(key);
  if (!rule.current) throw new HttpError(409, "This rule has no value yet, so there is nothing to confirm.", "RULE_NOT_SET");
  const cur = rule.current;
  const maker = cur.authorUserId ?? SYSTEM_MAKER;
  let blocked: string | null = null;
  if (cur.confirmation) blocked = "This value is already confirmed.";
  else if (maker === actorUserId) blocked = "You wrote this value, so a different person has to confirm it.";
  return {
    key,
    label: rule.label,
    version: cur.version,
    value: cur.value,
    valueHash: cur.valueHash,
    sourceLabel: rule.sourceLabel,
    requiresRetype: rule.requiresRetype,
    authorName: cur.authorName,
    blocked,
    checkers: await checkerAvailability("RULE_CONFIRM", { makerUserId: cur.authorUserId }),
    fingerprint: confirmFingerprint(key, cur.version, cur.valueHash),
  };
}

export async function confirmRule(
  key: string,
  input: { version: number; typedValue?: unknown; note: string; fingerprint: string },
  actor: { userId: string; ip?: string | null; userAgent?: string | null },
): Promise<RuleView> {
  const def = defOf(key);
  const before = (await getRule(key)).rule;
  const cur = before.current;
  if (!cur) throw new HttpError(409, "This rule has no value yet, so there is nothing to confirm.", "RULE_NOT_SET");
  if (cur.version !== input.version) throw new HttpError(409, "A newer value has been entered since you looked. Look at it again.", "PREVIEW_STALE");
  if (cur.confirmation) throw new HttpError(409, "This value is already confirmed.", "ALREADY_CONFIRMED");
  const maker = cur.authorUserId ?? SYSTEM_MAKER;
  if (maker === actor.userId) throw new HttpError(403, "You wrote this value, so a different person has to confirm it.", "CHECKER_IS_MAKER");
  if (input.fingerprint !== confirmFingerprint(key, cur.version, cur.valueHash)) throw new HttpError(409, "This changed since you looked at it. Look at it again.", "PREVIEW_STALE");
  const note = input.note.trim();
  if (note.length < 5) throw new HttpError(400, "Say what you checked it against (a few words, for example the CA's letter and its date).", "VALIDATION_ERROR");
  if (def.origin === "STATUTORY") {
    // Confirming means checking, not clicking: the confirmer types the value in again, and it has to be the value on the screen.
    if (input.typedValue === undefined || input.typedValue === null || input.typedValue === "") {
      throw new HttpError(400, `Type the value in again to confirm it. It is a statutory figure (${before.sourceLabel ?? "unverified"}), so confirming means checking it against its source.`, "RETYPE_REQUIRED");
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
  }
  await prisma.$transaction(async (tx) => {
    const approval = await recordCompletedApproval({ subject: "RULE_CONFIRM", subjectId: `${key}@${cur.version}`, hash: cur.valueHash, makerUserId: maker, checkerUserId: actor.userId, previewFingerprint: input.fingerprint, note }, tx);
    await tx.payrollItemConfirmation.create({ data: { kind: KIND, key, version: cur.version, valueHash: cur.valueHash, confirmedByUserId: actor.userId, note, approvalId: approval.id } });
    await recordEvent({ subjectType: "RULE", subjectId: key, type: "CONFIRMED", actorUserId: actor.userId, payload: { version: cur.version, valueHash: cur.valueHash, retyped: def.origin === "STATUTORY" } }, tx);
  });
  await writeAuditLog({
    actorUserId: actor.userId,
    action: "payroll.rule.confirmed",
    entityType: "PayrollRule",
    entityId: key,
    before: { version: cur.version, value: cur.value, status: "PLACEHOLDER", source: before.sourceLabel },
    after: { version: cur.version, value: cur.value, status: "CONFIRMED", note, retyped: def.origin === "STATUTORY" },
    ipAddress: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
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

// The adapter that lets a rule confirmation go through the same maker-checker table as the other six subjects.
registerSubject({
  subject: "RULE_CONFIRM",
  makerPermission: "payroll.rules.manage",
  checkerPermission: "payroll.rules.confirm",
  async describe(subjectId) {
    return `the rule ${subjectId.split("@")[0]}`;
  },
  async hash(subjectId) {
    const [key, v] = subjectId.split("@");
    const row = await prisma.payrollItemVersion.findFirst({ where: { kind: KIND, key: key!, version: Number(v) }, select: { valueHash: true } }); // allow-number: a version number, not money
    if (!row) throw new HttpError(404, "No such rule version.", "NOT_FOUND");
    return row.valueHash;
  },
});
