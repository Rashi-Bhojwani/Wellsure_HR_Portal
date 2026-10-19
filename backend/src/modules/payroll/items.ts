import { Prisma, type PayrollItemKind } from "@prisma/client";
import { PLACEHOLDER_SOURCE_LABEL } from "@shared/constants/payrollRules";
import { writeAuditLog } from "../../lib/audit";
import { notifyPayrollInputsChanged } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { SYSTEM_MAKER, checkerAvailability, recordCompletedApproval, registerSubject, type CheckerAvailability } from "./approvals";
import { recordEvent, type Db } from "./events";
import { payrollHash } from "./hash";
import { namesOfUsers } from "./names";

// Governed items, the part every kind shares (docs/plans/PHASE_6.md §3): a rule, a salary component, a salary structure (and later bank and output
// layouts) is an append-only series of versions. A version is Confirmed only by a row in payroll_item_confirmations made by somebody other than its
// author, so editing never changes a version, it adds the next one with no confirmation: a Confirmed item "resets to unconfirmed" by construction and
// the last Confirmed value stays on record. What differs per kind (what a value looks like, who needs to retype it) is in the kind's own module:
// rules/governed.ts, salary/components.ts, salary/structures.ts. Everything that decides who may vouch for what is HERE, once.

export type ItemStatus = "NOT_SET" | "PLACEHOLDER" | "CONFIRMED";

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

export interface ItemSummary {
  status: ItemStatus;
  /** Where the current value came from, in words: "From memory, unverified", "Entered by A on 3 Nov; not yet confirmed", "Confirmed by B on 5 Nov". */
  sourceLabel: string | null;
  current: VersionView | null;
  /** The most recent Confirmed version, shown beside an edited one so nothing silently falls back and nothing is lost from view. */
  lastConfirmed: VersionView | null;
  /** Every version, oldest first. */
  history: VersionView[];
}

export const SYSTEM_NAME = "System (shipped placeholder)";
const day = (d: Date) => d.toISOString().slice(0, 10);

export interface ItemData {
  versions: Awaited<ReturnType<typeof loadVersionRows>>["versions"];
  confirmations: Awaited<ReturnType<typeof loadVersionRows>>["confirmations"];
  people: Map<string, string>;
}

async function loadVersionRows(kind: PayrollItemKind, keys?: readonly string[]) {
  const where = { kind, ...(keys ? { key: { in: [...keys] } } : {}) };
  const [versions, confirmations] = await Promise.all([
    prisma.payrollItemVersion.findMany({ where, orderBy: [{ key: "asc" }, { version: "asc" }] }),
    prisma.payrollItemConfirmation.findMany({ where }),
  ]);
  return { versions, confirmations };
}

export async function loadItems(kind: PayrollItemKind, keys?: readonly string[]): Promise<ItemData> {
  const { versions, confirmations } = await loadVersionRows(kind, keys);
  const people = await namesOfUsers([...versions.map((v) => v.authorUserId ?? ""), ...confirmations.map((c) => c.confirmedByUserId)]);
  return { versions, confirmations, people };
}

/** Every key that has at least one version, in key order. */
export function keysIn(data: ItemData): string[] {
  return [...new Set(data.versions.map((v) => v.key))];
}

/** What an item looks like right now: its current version, whether it is Confirmed, the last Confirmed one, and its whole history. */
export function summarise(data: ItemData, key: string): ItemSummary {
  const confirmationOf = new Map(data.confirmations.filter((c) => c.key === key).map((c) => [c.version, c]));
  const versions = data.versions.filter((v) => v.key === key);
  const viewOf = (v: (typeof versions)[number]): VersionView => {
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
  };
  const history = versions.map(viewOf);
  const currentRow = versions[versions.length - 1];
  const current = currentRow ? history[history.length - 1]! : null;
  const lastConfirmedRow = [...versions].reverse().find((v) => confirmationOf.has(v.version));
  const lastConfirmed = lastConfirmedRow && lastConfirmedRow !== currentRow ? viewOf(lastConfirmedRow) : null;
  const status: ItemStatus = !current ? "NOT_SET" : current.confirmation ? "CONFIRMED" : "PLACEHOLDER";
  let sourceLabel: string | null = null;
  if (current?.confirmation) sourceLabel = `Confirmed by ${current.confirmation.confirmedByName} on ${day(new Date(current.confirmation.confirmedAt))}`;
  else if (current) sourceLabel = current.authorUserId === null ? PLACEHOLDER_SOURCE_LABEL : `Entered by ${current.authorName} on ${day(new Date(current.createdAt))}; not yet confirmed`;
  return { status, sourceLabel, current, lastConfirmed, history };
}

// ── Subject ids and the approval adapter ──

/** Rules keep their original `KEY@version` form; every other kind is prefixed with its kind so the two can never collide. */
export const itemSubjectId = (kind: PayrollItemKind, key: string, version: number): string => (kind === "RULE" ? `${key}@${version}` : `${kind}:${key}@${version}`);

export function parseItemSubjectId(subjectId: string): { kind: PayrollItemKind; key: string; version: number } {
  const colon = subjectId.indexOf(":");
  const kind = (colon === -1 ? "RULE" : subjectId.slice(0, colon)) as PayrollItemKind;
  const rest = colon === -1 ? subjectId : subjectId.slice(colon + 1);
  const at = rest.lastIndexOf("@");
  const version = Number(rest.slice(at + 1)); // allow-number: a version number, not money
  if (at < 1 || !Number.isInteger(version)) throw new HttpError(404, "No such version.", "NOT_FOUND");
  return { kind, key: rest.slice(0, at), version };
}

// One adapter for every governed item: confirming a rule, a component or a structure goes through the same maker-checker table and checks.
registerSubject({
  subject: "RULE_CONFIRM",
  makerPermission: "payroll.rules.manage",
  checkerPermission: "payroll.rules.confirm",
  async describe(subjectId) {
    const p = parseItemSubjectId(subjectId);
    return `the ${p.kind.toLowerCase()} ${p.key}`;
  },
  async hash(subjectId) {
    const p = parseItemSubjectId(subjectId);
    const row = await prisma.payrollItemVersion.findFirst({ where: { kind: p.kind, key: p.key, version: p.version }, select: { valueHash: true } });
    if (!row) throw new HttpError(404, "No such version.", "NOT_FOUND");
    return row.valueHash;
  },
});

// ── Appending a version ──

export interface Actor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

export interface AuditNames {
  entityType: string; // "PayrollRule"
  actionPrefix: string; // "payroll.rule"
  eventSubject: string; // "RULE"
}

export const editFingerprint = (type: string, key: string, baseVersion: number, baseHash: string | null, newHash: string): string => payrollHash({ t: type, key, baseVersion, baseHash, newHash });

/** Adds version `baseVersion + 1`, unconfirmed, with the event and the audit row. Two people editing at once: the second is told to look again. */
export async function appendVersion(
  kind: PayrollItemKind,
  audit: AuditNames,
  input: { key: string; value: unknown; note: string; before: ItemSummary; auditValue?: unknown },
  actor: Actor,
): Promise<void> {
  const valueHash = payrollHash(input.value);
  const baseVersion = input.before.current?.version ?? 0;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.payrollItemVersion.create({ data: { kind, key: input.key, version: baseVersion + 1, value: input.value as Prisma.InputJsonValue, valueHash, note: input.note, authorUserId: actor.userId } });
      await recordEvent({ subjectType: audit.eventSubject, subjectId: input.key, type: "EDITED", actorUserId: actor.userId, payload: { version: baseVersion + 1, valueHash, wasConfirmed: input.before.status === "CONFIRMED" } }, tx);
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "Somebody else edited this at the same moment. Look at it again.", "PREVIEW_STALE");
    throw err;
  }
  await writeAuditLog({
    actorUserId: actor.userId,
    action: `${audit.actionPrefix}.edited`,
    entityType: audit.entityType,
    entityId: input.key,
    before: input.before.current ? { version: input.before.current.version, value: input.before.current.value, status: input.before.status } : null,
    after: { version: baseVersion + 1, value: input.auditValue ?? input.value, status: "PLACEHOLDER", note: input.note, resetConfirmation: input.before.status === "CONFIRMED" },
    ipAddress: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
  await notifyPayrollInputsChanged(`${audit.entityType === "PayrollRule" ? "a rule" : "a salary item"} was edited`, actor.userId);
}

// ── Confirming a version ──

export interface ConfirmPreviewData {
  version: number;
  value: unknown;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  /** The reason the actor cannot confirm, if they cannot. */
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export const confirmFingerprint = (type: string, key: string, version: number, valueHash: string): string => payrollHash({ t: type, key, version, valueHash });

export async function previewConfirmation(type: string, kind: PayrollItemKind, key: string, summary: ItemSummary, actorUserId: string): Promise<ConfirmPreviewData> {
  void kind;
  if (!summary.current) throw new HttpError(409, "There is no value yet, so there is nothing to confirm.", "RULE_NOT_SET");
  const cur = summary.current;
  const maker = cur.authorUserId ?? SYSTEM_MAKER;
  let blocked: string | null = null;
  if (cur.confirmation) blocked = "This value is already confirmed.";
  else if (maker === actorUserId) blocked = "You wrote this value, so a different person has to confirm it.";
  return {
    version: cur.version,
    value: cur.value,
    valueHash: cur.valueHash,
    sourceLabel: summary.sourceLabel,
    authorName: cur.authorName,
    blocked,
    checkers: await checkerAvailability("RULE_CONFIRM", { makerUserId: cur.authorUserId }),
    fingerprint: confirmFingerprint(type, key, cur.version, cur.valueHash),
  };
}

/**
 * The one place that decides whether a person may vouch for a version. In this order: the version on screen is still the current one, it is not
 * already confirmed, the confirmer did not write it, they saw exactly what is current (fingerprint), they said what they checked. Kind-specific
 * checks (a statutory figure must be typed again) run through `extraCheck`, after those. Then the approval record, the confirmation and the
 * event are written in one transaction, and the audit row after.
 */
export async function confirmVersion(
  type: string,
  kind: PayrollItemKind,
  audit: AuditNames,
  input: { key: string; version: number; note: string; fingerprint: string; summary: ItemSummary; extraCheck?: (cur: VersionView) => void; auditExtra?: Record<string, unknown> },
  actor: Actor,
): Promise<void> {
  const cur = input.summary.current;
  if (!cur) throw new HttpError(409, "There is no value yet, so there is nothing to confirm.", "RULE_NOT_SET");
  if (cur.version !== input.version) throw new HttpError(409, "A newer value has been entered since you looked. Look at it again.", "PREVIEW_STALE");
  if (cur.confirmation) throw new HttpError(409, "This value is already confirmed.", "ALREADY_CONFIRMED");
  const maker = cur.authorUserId ?? SYSTEM_MAKER;
  if (maker === actor.userId) throw new HttpError(403, "You wrote this value, so a different person has to confirm it.", "CHECKER_IS_MAKER");
  if (input.fingerprint !== confirmFingerprint(type, input.key, cur.version, cur.valueHash)) throw new HttpError(409, "This changed since you looked at it. Look at it again.", "PREVIEW_STALE");
  const note = input.note.trim();
  if (note.length < 5) throw new HttpError(400, "Say what you checked it against (a few words, for example the CA's letter and its date).", "VALIDATION_ERROR");
  input.extraCheck?.(cur);
  await prisma.$transaction(async (tx) => {
    const approval = await recordCompletedApproval(
      { subject: "RULE_CONFIRM", subjectId: itemSubjectId(kind, input.key, cur.version), hash: cur.valueHash, makerUserId: maker, checkerUserId: actor.userId, previewFingerprint: input.fingerprint, note },
      tx,
    );
    await tx.payrollItemConfirmation.create({ data: { kind, key: input.key, version: cur.version, valueHash: cur.valueHash, confirmedByUserId: actor.userId, note, approvalId: approval.id } });
    await recordEvent({ subjectType: audit.eventSubject, subjectId: input.key, type: "CONFIRMED", actorUserId: actor.userId, payload: { version: cur.version, valueHash: cur.valueHash, ...input.auditExtra } }, tx);
  });
  await writeAuditLog({
    actorUserId: actor.userId,
    action: `${audit.actionPrefix}.confirmed`,
    entityType: audit.entityType,
    entityId: input.key,
    before: { version: cur.version, value: cur.value, status: "PLACEHOLDER", source: input.summary.sourceLabel },
    after: { version: cur.version, value: cur.value, status: "CONFIRMED", note, ...input.auditExtra },
    ipAddress: actor.ip ?? null,
    userAgent: actor.userAgent ?? null,
  });
}

/** The current version of each key, for callers that only need "what is the value now". */
export async function currentVersions(kind: PayrollItemKind, keys: readonly string[], db: Db = prisma): Promise<Map<string, { version: number; value: unknown; valueHash: string }>> {
  const rows = await db.payrollItemVersion.findMany({ where: { kind, key: { in: [...keys] } }, orderBy: [{ key: "asc" }, { version: "asc" }] });
  const out = new Map<string, { version: number; value: unknown; valueHash: string }>();
  for (const r of rows) out.set(r.key, { version: r.version, value: r.value, valueHash: r.valueHash });
  return out;
}
