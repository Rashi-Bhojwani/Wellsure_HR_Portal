import { HttpError } from "../../../middleware/errorHandler";
import { type CheckerAvailability } from "../approvals";
import { payrollHash } from "../hash";
import { appendVersion, confirmVersion, editFingerprint as itemEditFingerprint, keysIn, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { asValidationError } from "./common";
import { parseComponentValue, parseItemCode, type ComponentValue } from "./schemas";
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

export async function previewComponentSave(codeRaw: string, valueRaw: unknown): Promise<ComponentSavePreview> {
  const { code, value } = parse(codeRaw, valueRaw);
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

