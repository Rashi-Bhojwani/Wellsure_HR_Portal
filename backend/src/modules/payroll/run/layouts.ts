import { HttpError } from "../../../middleware/errorHandler";
import { decryptField, encryptField } from "../../../lib/encryption";
import { blindIndex, last4, normalizeAccountNumber } from "../../../lib/fieldHash";
import { type CheckerAvailability } from "../approvals";
import { payrollHash } from "../hash";
import { HIDDEN, isSealed, keyedHash, seal, unseal } from "../sealed";
import { appendVersion, confirmVersion, editFingerprint, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { LAYOUT_FIELDS, parseLayout, FILE_TOKENS, type Layout, type LayoutKind } from "./layout";

// The layouts of the bank file and of the four statutory files, as governed items (docs/plans/PHASE_6.md §14H). Each starts EMPTY ("Not set") and is a Placeholder until
// a different person confirms it; a file cannot be made from a layout that is not Confirmed. Nothing here knows any bank's or portal's format: the layout is typed in from
// the specification. The bank layout also holds the company's debit account, encrypted; it is shown only as its last four digits.

export interface LayoutItem {
  /** The governed item's key. */
  key: string;
  itemKind: "BANK_TEMPLATE" | "OUTPUT_TEMPLATE";
  layoutKind: LayoutKind;
  label: string;
  description: string;
  whoConfirms: string;
}

export const LAYOUT_ITEMS: readonly LayoutItem[] = [
  { key: "BANK_TEMPLATE", itemKind: "BANK_TEMPLATE", layoutKind: "BANK", label: "Bank file", description: "The layout of the file HR uploads to the bank's net banking, from the bank's own specification or a sample file.", whoConfirms: "HR, against the bank's specification" },
  { key: "PF_ECR", itemKind: "OUTPUT_TEMPLATE", layoutKind: "PF_ECR", label: "PF return (ECR)", description: "The provident fund file, from the layout the PF portal currently accepts.", whoConfirms: "Your CA, against a file the portal accepted" },
  { key: "ESI", itemKind: "OUTPUT_TEMPLATE", layoutKind: "ESI", label: "ESI contribution file", description: "The ESI file, from the layout the ESI portal currently accepts.", whoConfirms: "Your CA, against a file the portal accepted" },
  { key: "PT", itemKind: "OUTPUT_TEMPLATE", layoutKind: "PT", label: "Professional tax statement", description: "The professional tax statement, in the layout your state asks for.", whoConfirms: "Your CA" },
  { key: "LWF", itemKind: "OUTPUT_TEMPLATE", layoutKind: "LWF", label: "Labour welfare fund statement", description: "The labour welfare fund statement, in the layout your state asks for.", whoConfirms: "Your CA" },
];

const itemOf = (key: string): LayoutItem => {
  const item = LAYOUT_ITEMS.find((i) => i.key === key);
  if (!item) throw new HttpError(404, "There is no such layout.", "NOT_FOUND");
  return item;
};
const AUDIT = (item: LayoutItem) => ({ entityType: "PayrollLayout", actionPrefix: "payroll.layout", eventSubject: item.itemKind });

// The bank layout (and with it the company's debit account) is one of the owners' secrets: its whole version is stored sealed (encrypted), its hash is keyed, and what a screen sees depends on
// who is asking (docs/plans/PHASE_6.md §14J). The four statutory layouts are not secret; they are stored and shown as before.
const isSealedItem = (item: LayoutItem): boolean => item.layoutKind === "BANK";
const openRaw = (value: unknown): Layout => (isSealed(value) ? unseal<Layout>(value) : (value as Layout));

export interface Viewer {
  /** Holds payroll.banklayout.manage or payroll.banklayout.confirm: may see the bank layout itself. Everyone else sees that it exists, its status, who confirmed it and when. */
  seesBankLayout: boolean;
}
export const viewerOf = (permissions: ReadonlySet<string>): Viewer => ({ seesBankLayout: permissions.has("payroll.banklayout.manage") || permissions.has("payroll.banklayout.confirm") });
const GATED: Viewer = { seesBankLayout: true };

const logicalHashOf = (item: LayoutItem, layout: Layout): string => {
  const { debitAccountEnc: _drop, ...logical } = layout;
  void _drop;
  return isSealedItem(item) ? keyedHash(`layout:${item.key}`, logical) : payrollHash(logical);
};

/** What a screen or an audit row may see of a stored layout: the encrypted debit account and its hash are removed, the last four digits stay. */
export function redactLayout(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const rest = { ...(value as Record<string, unknown>) };
  const hasDebitAccount = Boolean(rest.debitAccountEnc);
  delete rest.debitAccountEnc;
  delete rest.debitAccountHash;
  return { ...rest, hasDebitAccount };
}
const openVersion = (item: LayoutItem, v: VersionView | null, viewer: Viewer): VersionView | null => {
  if (!v) return v;
  if (isSealedItem(item) && !viewer.seesBankLayout) return { ...v, value: { restricted: true } };
  return { ...v, value: redactLayout(openRaw(v.value)) };
};

/** The debit account number out of a stored bank layout, for the one place that needs it: writing the file. */
export function debitAccountOf(layout: Layout): string | undefined {
  return layout.debitAccountEnc ? decryptField(Buffer.from(layout.debitAccountEnc, "base64")) : undefined;
}

export interface LayoutView {
  key: string;
  label: string;
  description: string;
  whoConfirms: string;
  layoutKind: LayoutKind;
  fields: Array<{ name: string; description: string; isAmount: boolean; isDate: boolean }>;
  tokens: readonly string[];
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
}

function viewOf(item: LayoutItem, data: Awaited<ReturnType<typeof loadItems>>, viewer: Viewer): LayoutView {
  const s = summarise(data, item.key);
  const spec = LAYOUT_FIELDS[item.layoutKind];
  return {
    key: item.key,
    label: item.label,
    description: item.description,
    whoConfirms: item.whoConfirms,
    layoutKind: item.layoutKind,
    fields: spec.fields.map((name) => ({ name, description: spec.description[name] ?? name, isAmount: spec.amounts.includes(name), isDate: spec.dates.includes(name) })),
    tokens: FILE_TOKENS,
    status: s.status,
    sourceLabel: s.sourceLabel,
    current: openVersion(item, s.current, viewer),
    lastConfirmed: openVersion(item, s.lastConfirmed, viewer),
  };
}

export async function listLayouts(viewer: Viewer = GATED): Promise<LayoutView[]> {
  const bank = await loadItems("BANK_TEMPLATE");
  const outputs = await loadItems("OUTPUT_TEMPLATE");
  return LAYOUT_ITEMS.map((i) => viewOf(i, i.itemKind === "BANK_TEMPLATE" ? bank : outputs, viewer));
}

export async function getLayout(key: string, viewer: Viewer = GATED): Promise<{ layout: LayoutView; history: VersionView[] }> {
  const item = itemOf(key);
  const data = await loadItems(item.itemKind, [key]);
  return { layout: viewOf(item, data, viewer), history: [...summarise(data, key).history].reverse().map((v) => openVersion(item, v, viewer)!) };
}

/** Whether this reading shows the bank layout's content to someone, so the caller can record that it was looked at. */
export const showsBankLayout = (viewer: Viewer, layouts: readonly LayoutView[]): boolean => viewer.seesBankLayout && layouts.some((l) => l.key === "BANK_TEMPLATE" && l.current !== null);

/** The stored (unredacted) current value and its status, for generation. Null when nothing has ever been saved. */
export async function currentLayout(key: string): Promise<{ version: number; valueHash: string; value: unknown; status: ItemStatus } | null> {
  const item = itemOf(key);
  const s = summarise(await loadItems(item.itemKind, [key]), key);
  return s.current ? { version: s.current.version, valueHash: s.current.valueHash, value: openRaw(s.current.value), status: s.status } : null;
}

// ── Saving ──

interface Prepared {
  /** What is stored: the layout with the debit account encrypted. */
  stored: Layout;
  /** What is hashed for the fingerprint: the layout with the debit account as its hash only, so a fresh encryption does not change it. */
  logicalHash: string;
}

function prepare(item: LayoutItem, raw: unknown, current: Layout | null): Prepared {
  if (!raw || typeof raw !== "object") throw new HttpError(400, "Send the layout.", "VALIDATION_ERROR");
  const { debitAccountNumber, ...rest } = raw as Record<string, unknown>;
  // What the client may not set (the encrypted account, its hash, its last four) is dropped; it can only come from the number it types.
  for (const k of ["debitAccountEnc", "debitAccountLast4", "debitAccountHash", "hasDebitAccount"]) delete rest[k];
  let debit: Pick<Layout, "debitAccountEnc" | "debitAccountLast4" | "debitAccountHash"> = current?.debitAccountEnc ? { debitAccountEnc: current.debitAccountEnc, debitAccountLast4: current.debitAccountLast4 ?? "", debitAccountHash: current.debitAccountHash ?? "" } : {};
  if (typeof debitAccountNumber === "string" && debitAccountNumber.trim() !== "") {
    if (item.layoutKind !== "BANK") throw new HttpError(400, "Only the bank layout has a debit account.", "VALIDATION_ERROR");
    const digits = normalizeAccountNumber(debitAccountNumber);
    if (!/^\d{6,20}$/.test(digits)) throw new HttpError(400, "Enter the debit account number as digits only (6 to 20).", "VALIDATION_ERROR");
    const hash = blindIndex(digits);
    debit = current?.debitAccountHash === hash && current.debitAccountEnc ? { debitAccountEnc: current.debitAccountEnc, debitAccountLast4: current.debitAccountLast4 ?? last4(digits), debitAccountHash: hash } : { debitAccountEnc: Buffer.from(encryptField(digits)).toString("base64"), debitAccountLast4: last4(digits), debitAccountHash: hash };
  }
  const stored = parseLayout(item.layoutKind, { ...rest, ...debit });
  return { stored, logicalHash: logicalHashOf(item, stored) };
}

/** What stands in an audit row for a stored layout value: nothing at all for the bank layout, the layout without its encrypted debit account for the others. */
const auditMask = (item: LayoutItem) => (value: unknown): unknown => (isSealedItem(item) || isSealed(value) ? HIDDEN : redactLayout(value));

const fingerprintOf = (key: string, baseVersion: number, baseHash: string | null, logicalHash: string) => editFingerprint("LAYOUT_EDIT", key, baseVersion, baseHash, logicalHash);

export interface LayoutSavePreview {
  key: string;
  isNew: boolean;
  before: { version: number; value: unknown; status: ItemStatus } | null;
  after: { value: unknown };
  unchanged: boolean;
  willResetConfirmation: boolean;
  lastConfirmed: VersionView | null;
  fingerprint: string;
}

async function load(item: LayoutItem) {
  const before = summarise(await loadItems(item.itemKind, [item.key]), item.key);
  const currentLayout = before.current ? openRaw(before.current.value) : null;
  return { before, currentLayout };
}

export async function previewLayoutSave(key: string, raw: unknown): Promise<LayoutSavePreview> {
  const item = itemOf(key);
  const { before, currentLayout } = await load(item);
  const { stored, logicalHash } = prepare(item, raw, currentLayout);
  const currentLogical = currentLayout ? logicalHashOf(item, currentLayout) : null;
  return {
    key,
    isNew: !before.current,
    before: before.current ? { version: before.current.version, value: redactLayout(currentLayout), status: before.status } : null,
    after: { value: redactLayout(stored) },
    unchanged: currentLogical === logicalHash,
    willResetConfirmation: before.status === "CONFIRMED",
    lastConfirmed: before.status === "CONFIRMED" ? openVersion(item, before.current, GATED) : openVersion(item, before.lastConfirmed, GATED),
    fingerprint: fingerprintOf(key, before.current?.version ?? 0, before.current?.valueHash ?? null, logicalHash),
  };
}

export async function saveLayout(key: string, input: { value: unknown; note?: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<LayoutView> {
  const item = itemOf(key);
  const { before, currentLayout } = await load(item);
  const { stored, logicalHash } = prepare(item, input.value, currentLayout);
  if (input.fingerprint !== fingerprintOf(key, before.current?.version ?? 0, before.current?.valueHash ?? null, logicalHash)) throw new HttpError(409, "This changed since you previewed it. Preview it again.", "PREVIEW_STALE");
  const currentLogical = currentLayout ? logicalHashOf(item, currentLayout) : null;
  if (currentLogical === logicalHash) throw new HttpError(409, "That is already the current layout. Nothing to change.", "NO_CHANGE");
  await appendVersion(
    item.itemKind,
    AUDIT(item),
    { key, value: isSealedItem(item) ? seal(stored) : stored, ...(isSealedItem(item) ? { valueHash: logicalHash } : {}), note: (input.note ?? "").trim().slice(0, 500), before, auditValue: isSealedItem(item) ? HIDDEN : redactLayout(stored), maskForAudit: auditMask(item) },
    actor,
  );
  return (await getLayout(key)).layout;
}

// ── Confirming ──

export interface LayoutConfirmPreview {
  key: string;
  version: number;
  value: unknown;
  valueHash: string;
  sourceLabel: string | null;
  authorName: string;
  blocked: string | null;
  checkers: CheckerAvailability;
  fingerprint: string;
}

export async function previewLayoutConfirm(key: string, actorUserId: string): Promise<LayoutConfirmPreview> {
  const item = itemOf(key);
  const data = await loadItems(item.itemKind, [key]);
  const p = await previewConfirmation("LAYOUT_CONFIRM", item.itemKind, key, summarise(data, key), actorUserId, isSealedItem(item) ? "payroll.banklayout.confirm" : undefined);
  // The confirmer is shown the layout: checking it against the bank's specification is what confirming is.
  return { key, ...p, value: redactLayout(openRaw(p.value)) };
}

export async function confirmLayout(key: string, input: { version: number; note: string; fingerprint: string }, actor: { userId: string; ip?: string | null; userAgent?: string | null }): Promise<LayoutView> {
  const item = itemOf(key);
  const data = await loadItems(item.itemKind, [key]);
  await confirmVersion("LAYOUT_CONFIRM", item.itemKind, AUDIT(item), { key, version: input.version, note: input.note, fingerprint: input.fingerprint, summary: summarise(data, key), maskForAudit: auditMask(item) }, actor);
  return (await getLayout(key)).layout;
}

/** What the Setup Checklist needs to know about the bank layout without ever seeing it: whether a debit account has been entered with it. */
export async function bankLayoutFacts(): Promise<{ hasDebitAccount: boolean; columns: number }> {
  const cur = await currentLayout("BANK_TEMPLATE");
  const layout = cur ? (cur.value as Layout) : null;
  return { hasDebitAccount: Boolean(layout?.debitAccountEnc), columns: layout?.columns?.length ?? 0 };
}

/** Whether a layout exists and its current version is Confirmed, for the gates; never throws. */
export async function layoutReady(key: string): Promise<{ ready: boolean; version: number | null; valueHash: string | null; status: ItemStatus | "NOT_SET" }> {
  const cur = await currentLayout(key);
  if (!cur) return { ready: false, version: null, valueHash: null, status: "NOT_SET" };
  return { ready: cur.status === "CONFIRMED", version: cur.version, valueHash: cur.valueHash, status: cur.status };
}
