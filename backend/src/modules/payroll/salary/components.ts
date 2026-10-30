import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { type CheckerAvailability } from "../approvals";
import { payrollHash } from "../hash";
import { appendVersion, confirmVersion, editFingerprint as itemEditFingerprint, keysIn, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { asValidationError } from "./common";
import { InvalidSalaryValueError, isActiveOn, parseComponentValue, parseItemCode, type ComponentValue } from "./schemas";
import type { StructureValue } from "./schemas";

// Salary components as governed items (docs/plans/PHASE_6.md §14B): what a line IS. Placeholder until a different person confirms it. Editing one adds
// the next version; a structure keeps pointing at the version it pinned, so editing a component never moves anybody's pay.

const KIND = "COMPONENT" as const;
const AUDIT = { entityType: "PayrollComponent", actionPrefix: "payroll.component", eventSubject: "COMPONENT" } as const;

export interface ComponentView {
  code: string;
  value: ComponentValue | null;
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
  /** Structures whose current version uses this component, and the component version each pinned. */
  usedBy: Array<{ structure: string; structureName: string; pinnedVersion: number; behind: boolean }>;
}

async function structuresUsing(componentCodes: readonly string[]): Promise<Map<string, ComponentView["usedBy"]>> {
  const data = await loadItems("STRUCTURE");
  const out = new Map<string, ComponentView["usedBy"]>();
  for (const key of keysIn(data)) {
    const cur = summarise(data, key).current;
    if (!cur) continue;
    const value = cur.value as StructureValue;
    for (const line of value.lines) {
      if (!componentCodes.includes(line.component)) continue;
      out.set(line.component, [...(out.get(line.component) ?? []), { structure: key, structureName: value.name, pinnedVersion: line.componentVersion, behind: false }]);
    }
  }
  return out;
}

function toView(code: string, data: Awaited<ReturnType<typeof loadItems>>, used: Map<string, ComponentView["usedBy"]>): ComponentView {
  const s = summarise(data, code);
  const currentVersion = s.current?.version ?? 0;
  return {
    code,
    value: (s.current?.value as ComponentValue | undefined) ?? null,
    status: s.status,
    sourceLabel: s.sourceLabel,
    current: s.current,
    lastConfirmed: s.lastConfirmed,
    usedBy: (used.get(code) ?? []).map((u) => ({ ...u, behind: u.pinnedVersion < currentVersion })),
  };
}

export async function listComponents(): Promise<ComponentView[]> {
  const data = await loadItems(KIND);
  const codes = keysIn(data);
  const used = await structuresUsing(codes);
  return codes.map((c) => toView(c, data, used));
}

export async function getComponent(code: string): Promise<{ component: ComponentView; history: VersionView[] }> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such component.", "NOT_FOUND");
  const used = await structuresUsing([code]);
  return { component: toView(code, data, used), history: [...summarise(data, code).history].reverse() };
}

// ── Saving ──

export interface ComponentSavePreview {
  code: string;
  isNew: boolean;
  before: { version: number; value: ComponentValue; status: ItemStatus } | null;
  after: { value: ComponentValue; valueHash: string };
  unchanged: boolean;
  willResetConfirmation: boolean;
  lastConfirmed: VersionView | null;
  /** Structures that use this component keep the version they pinned; they move only when a new version of the structure is saved. */
  usedBy: ComponentView["usedBy"];
  impact: string;
  fingerprint: string;
}

const fingerprintOf = (code: string, baseVersion: number, baseHash: string | null, newHash: string) => itemEditFingerprint("COMPONENT_EDIT", code, baseVersion, baseHash, newHash);

function parse(codeRaw: unknown, valueRaw: unknown): { code: string; value: ComponentValue } {
  try {
    return { code: parseItemCode(codeRaw), value: parseComponentValue(valueRaw) };
  } catch (err) {
    return asValidationError(err);
  }
}

/**
 * The links from a head to its arrears head and its reversal head: each must be a head that exists, not the head itself, and active over the whole time this
 * head is active; and following the links must never lead back to the head you started from (a ring of links would never finish explaining a payslip line).
 */
export async function assertLinksSound(code: string, value: ComponentValue): Promise<void> {
  const links = [["arrears head", value.arrearsHead], ["reversal head", value.reversalHead]] as const;
  const wanted = links.filter(([, c]) => c !== undefined) as Array<[string, string]>;
  if (wanted.length === 0) return;
  const problems: string[] = [];
  const data = await loadItems(KIND);
  const current = new Map(keysIn(data).map((k) => [k, summarise(data, k).current?.value as ComponentValue | undefined]));
  for (const [label, target] of wanted) {
    if (target === code) {
      problems.push(`The ${label} cannot be the head itself.`);
      continue;
    }
    const t = current.get(target);
    if (!t) {
      problems.push(`The ${label} ${target} does not exist. Create it first (it is an ordinary head).`);
      continue;
    }
    if (value.activeFrom && !isActiveOn(t, value.activeFrom)) problems.push(`The ${label} ${target} is not active on ${value.activeFrom}, when this head starts.`);
    if (!value.activeFrom && (t.activeFrom || t.activeTo)) problems.push(`The ${label} ${target} has active dates, but this head has none, so ${target} would not always be there.`);
    if (value.activeTo && t.activeTo && t.activeTo < value.activeTo) problems.push(`The ${label} ${target} ends on ${t.activeTo}, before this head does (${value.activeTo}).`);
  }
  // A walk along the links from each target; reaching `code` again is a ring.
  const seen = new Set<string>();
  const queue = wanted.map(([, c]) => c).filter((c) => c !== code);
  while (queue.length) {
    const at = queue.pop()!;
    if (seen.has(at)) continue;
    seen.add(at);
    const v = current.get(at);
    for (const next of [v?.arrearsHead, v?.reversalHead]) {
      if (next === code) problems.push(`That would make a ring: ${at} links back to ${code}.`);
      else if (next) queue.push(next);
    }
  }
  if (problems.length) throw new InvalidSalaryValueError([...new Set(problems.filter(Boolean))]);
}

export async function previewComponentSave(codeRaw: string, valueRaw: unknown): Promise<ComponentSavePreview> {
  const { code, value } = parse(codeRaw, valueRaw);
  await assertLinksSound(code, value).catch(asValidationError);
  const valueHash = payrollHash(value);
  const data = await loadItems(KIND, [code]);
  const s = summarise(data, code);
  const used = (await structuresUsing([code])).get(code) ?? [];
  const baseVersion = s.current?.version ?? 0;
  return {
    code,
    isNew: !s.current,
    before: s.current ? { version: s.current.version, value: s.current.value as ComponentValue, status: s.status } : null,
    after: { value, valueHash },
    unchanged: s.current?.valueHash === valueHash,
    willResetConfirmation: s.status === "CONFIRMED",
    lastConfirmed: s.status === "CONFIRMED" ? s.current : s.lastConfirmed,
    usedBy: used.map((u) => ({ ...u, behind: true })),
    impact: used.length
      ? `${used.length} structure${used.length === 1 ? "" : "s"} use this component. They keep the version they pinned and nobody's pay moves; save a new version of the structure to use this one.`
      : "No structure uses this component yet.",
    fingerprint: fingerprintOf(code, baseVersion, s.current?.valueHash ?? null, valueHash),
  };
}

export async function saveComponent(codeRaw: string, input: { value: unknown; note?: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<ComponentView> {
  const { code, value } = parse(codeRaw, input.value);
  await assertLinksSound(code, value).catch(asValidationError);
  const valueHash = payrollHash(value);
  const before = summarise(await loadItems(KIND, [code]), code);
  if (before.current?.valueHash === valueHash) throw new HttpError(409, "That is already the current value. Nothing to change.", "NO_CHANGE");
  if (input.fingerprint !== fingerprintOf(code, before.current?.version ?? 0, before.current?.valueHash ?? null, valueHash)) {
    throw new HttpError(409, "This changed since you previewed it. Preview it again.", "PREVIEW_STALE");
  }
  await appendVersion(KIND, AUDIT, { key: code, value, note: (input.note ?? "").trim().slice(0, 500), before }, actor);
  return (await getComponent(code)).component;
}

// ── Confirming ──

export interface ComponentConfirmPreview {
  code: string;
  version: number;
  value: ComponentValue;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export async function previewComponentConfirm(code: string, actorUserId: string): Promise<ComponentConfirmPreview> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such component.", "NOT_FOUND");
  const p = await previewConfirmation("COMPONENT_CONFIRM", KIND, code, summarise(data, code), actorUserId);
  return { code, ...p, value: p.value as ComponentValue };
}

export async function confirmComponent(code: string, input: { version: number; note: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<ComponentView> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such component.", "NOT_FOUND");
  await confirmVersion("COMPONENT_CONFIRM", KIND, AUDIT, { key: code, version: input.version, note: input.note, fingerprint: input.fingerprint, summary: summarise(data, code) }, actor);
  return (await getComponent(code)).component;
}


/**
 * Heads are never deleted. A head that a finalised run used is part of that run's explanation for good; any other head is part of the version history that
 * structures pin. To stop using one, save a version with a last active day: that is retiring it, and everything already paid keeps explaining itself.
 */
export async function refuseDeleteComponent(code: string): Promise<never> {
  const data = await loadItems(KIND, [code]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such component.", "NOT_FOUND");
  const used = await prisma.payrollRunLine.findFirst({ where: { code, run: { status: "FINALISED" } }, select: { run: { select: { cycleLabel: true } } } });
  throw new HttpError(
    409,
    used
      ? `${code} was used in the finalised run for ${used.run.cycleLabel}, so it cannot be deleted. Retire it instead: save a new version with a last active day.`
      : `Pay heads are never deleted, because structures and history pin their versions. Retire ${code} instead: save a new version with a last active day.`,
    "HEAD_DELETE_REFUSED",
  );
}
