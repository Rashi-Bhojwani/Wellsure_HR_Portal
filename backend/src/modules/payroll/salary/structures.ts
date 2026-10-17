import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { type CheckerAvailability } from "../approvals";
import type { Db } from "../events";
import { payrollHash } from "../hash";
import { appendVersion, confirmVersion, editFingerprint as itemEditFingerprint, keysIn, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { ZERO, dec } from "../money";
import { annualView, computeBreakup, breakupToJson, type Breakup, type RoundingRule } from "./breakup";
import { asValidationError, loadLineRounding } from "./common";
import { InvalidSalaryValueError, parseItemCode, parseStructureValue, type ComponentValue, type StructureValue } from "./schemas";

// Salary structures as governed items (docs/plans/PHASE_6.md §14B): how much each line gets. A structure pins a component version and hash on every line;
// saving one proves it adds up to CTC for a sample CTC, using the rounding rule, so a structure that cannot produce a salary cannot be saved.

const KIND = "STRUCTURE" as const;
const AUDIT = { entityType: "PayrollStructure", actionPrefix: "payroll.structure", eventSubject: "STRUCTURE" } as const;

export interface PinnedComponent {
  version: number;
  hash: string;
  value: ComponentValue;
  status: ItemStatus;
}

/** The component versions a structure's lines pin, each checked to exist and to be the version and hash the structure says. */
export async function resolvePinnedComponents(value: StructureValue, db: Db = prisma): Promise<Map<string, PinnedComponent>> {
  const rows = await db.payrollItemVersion.findMany({ where: { kind: "COMPONENT", key: { in: value.lines.map((l) => l.component) } }, orderBy: [{ key: "asc" }, { version: "asc" }] });
  const confirmations = await db.payrollItemConfirmation.findMany({ where: { kind: "COMPONENT", key: { in: value.lines.map((l) => l.component) } }, select: { key: true, version: true, valueHash: true } });
  const confirmed = new Set(confirmations.map((c) => `${c.key}@${c.version}@${c.valueHash}`));
  const out = new Map<string, PinnedComponent>();
  const problems: string[] = [];
  for (const line of value.lines) {
    const row = rows.find((r) => r.key === line.component && r.version === line.componentVersion);
    if (!row) problems.push(`${line.component} has no version ${line.componentVersion}`);
    else if (row.valueHash !== line.componentHash) problems.push(`${line.component} version ${line.componentVersion} is not the version this structure was built against`);
    else out.set(line.component, { version: row.version, hash: row.valueHash, value: row.value as unknown as ComponentValue, status: confirmed.has(`${row.key}@${row.version}@${row.valueHash}`) ? "CONFIRMED" : "PLACEHOLDER" });
  }
  if (problems.length) throw new InvalidSalaryValueError(problems);
  return out;
}

/** Shape, references, and the pinned components. Returns the canonical value. */
export async function validateStructure(raw: unknown): Promise<{ value: StructureValue; components: Map<string, PinnedComponent> }> {
  try {
    const shaped = parseStructureValue(raw, () => undefined);
    const components = await resolvePinnedComponents(shaped);
    const value = parseStructureValue(raw, (code) => components.get(code)?.value.type);
    return { value, components };
  } catch (err) {
    return asValidationError(err);
  }
}

function toBreakupComponents(components: Map<string, PinnedComponent>): Map<string, { version: number; value: ComponentValue }> {
  return new Map([...components].map(([code, c]) => [code, { version: c.version, value: c.value }]));
}

/** Zero for every PER_PERSON line: a sample has nobody's typed amounts. */
export const samplePerPerson = (value: StructureValue): Record<string, ReturnType<typeof dec>> => Object.fromEntries(value.lines.filter((l) => l.calc.method === "PER_PERSON").map((l) => [l.component, ZERO]));

export interface SampleResult {
  annualCtc: string;
  breakup: ReturnType<typeof breakupToJson>;
  /** Each line over twelve months, the total that counts toward CTC, and its distance from the yearly CTC (rounding), to be shown beside the monthly figures. */
  annual: ReturnType<typeof annualView>;
}

function sampleCtc(raw: unknown): ReturnType<typeof dec> {
  if (typeof raw !== "string" || !/^\d+(\.\d{1,2})?$/.test(raw.trim()) || dec(raw.trim()).isZero()) throw new HttpError(400, "Give a sample yearly CTC (for example 1200000) to prove the structure adds up.", "VALIDATION_ERROR");
  return dec(raw.trim());
}

function sampleBreakup(value: StructureValue, components: Map<string, PinnedComponent>, annual: ReturnType<typeof dec>, rounding: RoundingRule): Breakup {
  return computeBreakup({ annualCtc: annual, structure: value, components: toBreakupComponents(components), perPerson: samplePerPerson(value), rounding });
}

// ── Reading ──

export interface StructureView {
  code: string;
  value: StructureValue | null;
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
  /** The components this version pins, with their own Placeholder or Confirmed status and whether a newer component version exists. */
  components: Array<{ component: string; pinnedVersion: number; status: ItemStatus; newerVersion: number | null }>;
}

async function componentStatusFor(value: StructureValue | null): Promise<StructureView["components"]> {
  if (!value) return [];
  const codes = value.lines.map((l) => l.component);
  const data = await loadItems("COMPONENT", codes);
  return value.lines.map((l) => {
    const s = summarise(data, l.component);
    const pinned = s.history.find((h) => h.version === l.componentVersion);
    const latest = s.current?.version ?? 0;
    return { component: l.component, pinnedVersion: l.componentVersion, status: (pinned?.confirmation ? "CONFIRMED" : "PLACEHOLDER") as ItemStatus, newerVersion: latest > l.componentVersion ? latest : null };
  });
}

async function toView(code: string, data: Awaited<ReturnType<typeof loadItems>>): Promise<StructureView> {
  const s = summarise(data, code);
  const value = (s.current?.value as StructureValue | undefined) ?? null;
  return { code, value, status: s.status, sourceLabel: s.sourceLabel, current: s.current, lastConfirmed: s.lastConfirmed, components: await componentStatusFor(value) };
}

export async function listStructures(): Promise<StructureView[]> {
  const data = await loadItems(KIND);
  return Promise.all(keysIn(data).map((k) => toView(k, data)));
}

export async function getStructure(code: string): Promise<{ structure: StructureView; history: VersionView[] }> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such structure.", "NOT_FOUND");
  return { structure: await toView(code, data), history: [...summarise(data, code).history].reverse() };
}

/** One version of a structure with its pinned components, for working out a salary against exactly that version. */
export async function loadStructureVersion(key: string, version: number, db: Db = prisma): Promise<{ value: StructureValue; hash: string; components: Map<string, PinnedComponent> }> {
  const row = await db.payrollItemVersion.findFirst({ where: { kind: KIND, key, version } });
  if (!row) throw new HttpError(404, `The structure ${key} has no version ${version}.`, "NOT_FOUND");
  const value = row.value as unknown as StructureValue;
  return { value, hash: row.valueHash, components: await resolvePinnedComponents(value, db) };
}

// ── Saving ──

export interface StructureSavePreview {
  code: string;
  isNew: boolean;
  before: { version: number; status: ItemStatus } | null;
  after: { value: StructureValue; valueHash: string };
  unchanged: boolean;
  willResetConfirmation: boolean;
  lastConfirmed: VersionView | null;
  /** The structure worked out for the sample CTC (per-person lines at zero), so the author sees the split before saving. */
  sample: SampleResult;
  /** Components this version uses that are not Confirmed yet. A salary built on them is a test until they are. */
  unconfirmedComponents: string[];
  impact: string;
  fingerprint: string;
}

const fingerprintOf = (code: string, baseVersion: number, baseHash: string | null, newHash: string) => itemEditFingerprint("STRUCTURE_EDIT", code, baseVersion, baseHash, newHash);

function parseCode(raw: unknown): string {
  try {
    return parseItemCode(raw);
  } catch (err) {
    return asValidationError(err);
  }
}

export async function previewStructureSave(codeRaw: string, valueRaw: unknown, sampleRaw: unknown): Promise<StructureSavePreview> {
  const code = parseCode(codeRaw);
  const { value, components } = await validateStructure(valueRaw);
  const annual = sampleCtc(sampleRaw);
  const { rule } = await loadLineRounding();
  const breakup = sampleBreakup(value, components, annual, rule);
  const valueHash = payrollHash(value);
  const s = summarise(await loadItems(KIND, [code]), code);
  return {
    code,
    isNew: !s.current,
    before: s.current ? { version: s.current.version, status: s.status } : null,
    after: { value, valueHash },
    unchanged: s.current?.valueHash === valueHash,
    willResetConfirmation: s.status === "CONFIRMED",
    lastConfirmed: s.status === "CONFIRMED" ? s.current : s.lastConfirmed,
    sample: { annualCtc: annual.toString(), breakup: breakupToJson(breakup), annual: annualView(breakup, annual, value.ctcIncludes) },
    unconfirmedComponents: [...components].filter(([, c]) => c.status !== "CONFIRMED").map(([k]) => k),
    impact: "Nobody's salary changes when a structure is saved. People move to a new version only through a salary revision, which a second person approves.",
    fingerprint: fingerprintOf(code, s.current?.version ?? 0, s.current?.valueHash ?? null, valueHash),
  };
}

export async function saveStructure(codeRaw: string, input: { value: unknown; sampleAnnualCtc: unknown; note?: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<StructureView> {
  const code = parseCode(codeRaw);
  const { value, components } = await validateStructure(input.value);
  const annual = sampleCtc(input.sampleAnnualCtc);
  const { rule } = await loadLineRounding();
  sampleBreakup(value, components, annual, rule); // refuses a structure that cannot produce a salary, with the reason
  const valueHash = payrollHash(value);
  const before = summarise(await loadItems(KIND, [code]), code);
  if (before.current?.valueHash === valueHash) throw new HttpError(409, "That is already the current value. Nothing to change.", "NO_CHANGE");
  if (input.fingerprint !== fingerprintOf(code, before.current?.version ?? 0, before.current?.valueHash ?? null, valueHash)) throw new HttpError(409, "This changed since you previewed it. Preview it again.", "PREVIEW_STALE");
  await appendVersion(KIND, AUDIT, { key: code, value, note: (input.note ?? "").trim().slice(0, 500), before }, actor);
  return (await getStructure(code)).structure;
}

/** A breakup of any (unsaved) structure value for any CTC, for the editor to show as the author types. Saves nothing. */
export async function previewBreakup(valueRaw: unknown, annualRaw: unknown, perPersonRaw: unknown): Promise<SampleResult> {
  const { value, components } = await validateStructure(valueRaw);
  const annual = sampleCtc(annualRaw);
  const typed: Record<string, ReturnType<typeof dec>> = { ...samplePerPerson(value) };
  if (perPersonRaw && typeof perPersonRaw === "object") for (const [k, v] of Object.entries(perPersonRaw as Record<string, unknown>)) if (typeof v === "string" && /^\d+(\.\d+)?$/.test(v) && k in typed) typed[k] = dec(v);
  const { rule } = await loadLineRounding();
  const breakup = computeBreakup({ annualCtc: annual, structure: value, components: toBreakupComponents(components), perPerson: typed, rounding: rule });
  return { annualCtc: annual.toString(), breakup: breakupToJson(breakup), annual: annualView(breakup, annual, value.ctcIncludes) };
}

// ── Confirming ──

export interface StructureConfirmPreview {
  code: string;
  version: number;
  value: StructureValue;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
  unconfirmedComponents: string[];
}

export async function previewStructureConfirm(code: string, actorUserId: string): Promise<StructureConfirmPreview> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such structure.", "NOT_FOUND");
  const p = await previewConfirmation("STRUCTURE_CONFIRM", KIND, code, summarise(data, code), actorUserId);
  const value = p.value as StructureValue;
  const unconfirmed = (await componentStatusFor(value)).filter((c) => c.status !== "CONFIRMED").map((c) => c.component);
  return { code, ...p, value, unconfirmedComponents: unconfirmed };
}

export async function confirmStructure(code: string, input: { version: number; note: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<StructureView> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such structure.", "NOT_FOUND");
  await confirmVersion("STRUCTURE_CONFIRM", KIND, AUDIT, { key: code, version: input.version, note: input.note, fingerprint: input.fingerprint, summary: summarise(data, code) }, actor);
  return (await getStructure(code)).structure;
}

