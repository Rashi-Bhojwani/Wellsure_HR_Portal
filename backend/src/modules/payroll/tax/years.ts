import { parseFinancialYearLabel } from "@shared/utils/financialYear";
import { requireDirector } from "../../../lib/directorAuthority";
import { HttpError } from "../../../middleware/errorHandler";
import { payrollHash } from "../hash";
import { appendVersion, confirmVersion, editFingerprint, keysIn, loadItems, previewConfirmation, summarise, type ItemStatus, type VersionView } from "../items";
import { InvalidTaxValueError, missingForTds, parseTaxYearValue, type TaxYearValue } from "./schema";

// A tax year as a governed item (docs/plans/STAGE_7_PLAN.md). Directors only: HR, managers, employees and the Developer role never see it. An entry is a Placeholder until a different
// director confirms it; editing adds the next version and the confirmed one stays on record. Nothing is shipped: a year that nobody entered does not exist.

const KIND = "TAX_YEAR" as const;
const AUDIT = { entityType: "PayrollTaxYear", actionPrefix: "payroll.taxyear", eventSubject: "TAX_YEAR" } as const;
type Actor = { userId: string; ip?: string | null; userAgent?: string | null };

export interface TaxYearView {
  year: string;
  start: string;
  end: string;
  value: TaxYearValue | null;
  status: ItemStatus;
  sourceLabel: string | null;
  current: VersionView | null;
  lastConfirmed: VersionView | null;
  /** What the year still lacks before a TDS can be worked out under both regimes, in words. */
  missing: string[];
}

const label = (raw: string): string => {
  try {
    return parseFinancialYearLabel(raw).label;
  } catch (err) {
    throw new HttpError(400, (err as Error).message, "VALIDATION_ERROR");
  }
};

function parse(valueRaw: unknown): TaxYearValue {
  try {
    return parseTaxYearValue(valueRaw);
  } catch (err) {
    if (err instanceof InvalidTaxValueError) throw new HttpError(400, `The tax year cannot be saved: ${err.issues.join("; ")}.`, "VALIDATION_ERROR", { problems: err.issues });
    throw err;
  }
}

function toView(year: string, data: Awaited<ReturnType<typeof loadItems>>): TaxYearView {
  const fy = parseFinancialYearLabel(year);
  const s = summarise(data, year);
  const value = (s.current?.value as TaxYearValue | undefined) ?? null;
  return { year, start: fy.start, end: fy.end, value, status: s.status, sourceLabel: s.sourceLabel, current: s.current, lastConfirmed: s.lastConfirmed, missing: missingForTds(value) };
}

export async function listTaxYears(actor: Actor): Promise<TaxYearView[]> {
  await requireDirector(actor.userId, "see the tax years");
  const data = await loadItems(KIND);
  return keysIn(data).map((k) => toView(k, data));
}

export async function getTaxYear(yearRaw: string, actor: Actor): Promise<{ year: TaxYearView; history: VersionView[] }> {
  await requireDirector(actor.userId, "see a tax year");
  const year = label(yearRaw);
  const data = await loadItems(KIND, [year]);
  return { year: toView(year, data), history: [...summarise(data, year).history].reverse() };
}

const fingerprintOf = (year: string, baseVersion: number, baseHash: string | null, newHash: string) => editFingerprint("TAX_YEAR_EDIT", year, baseVersion, baseHash, newHash);

export async function previewTaxYearSave(yearRaw: string, valueRaw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "change a tax year");
  const year = label(yearRaw);
  const value = parse(valueRaw);
  const valueHash = payrollHash(value);
  const s = summarise(await loadItems(KIND, [year]), year);
  return {
    year,
    isNew: !s.current,
    after: { value, valueHash },
    unchanged: s.current?.valueHash === valueHash,
    willResetConfirmation: s.status === "CONFIRMED",
    missing: missingForTds(value),
    fingerprint: fingerprintOf(year, s.current?.version ?? 0, s.current?.valueHash ?? null, valueHash),
  };
}

export async function saveTaxYear(yearRaw: string, input: { value: unknown; note?: string; fingerprint: string }, actor: Actor): Promise<TaxYearView> {
  await requireDirector(actor.userId, "change a tax year");
  const year = label(yearRaw);
  const value = parse(input.value);
  const valueHash = payrollHash(value);
  const before = summarise(await loadItems(KIND, [year]), year);
  if (before.current?.valueHash === valueHash) throw new HttpError(409, "That is already the current value. Nothing to change.", "NO_CHANGE");
  if (input.fingerprint !== fingerprintOf(year, before.current?.version ?? 0, before.current?.valueHash ?? null, valueHash)) throw new HttpError(409, "This changed since you previewed it. Preview it again.", "PREVIEW_STALE");
  // Each value carries its own source note and date; the version's note is what the editor says about this change.
  await appendVersion(KIND, AUDIT, { key: year, value, note: (input.note ?? "").trim().slice(0, 500), sourceNote: "See the note on each value", effectiveFrom: parseFinancialYearLabel(year).start, before }, actor);
  return (await getTaxYear(year, actor)).year;
}

export async function previewTaxYearConfirm(yearRaw: string, actor: Actor) {
  await requireDirector(actor.userId, "confirm a tax year");
  const year = label(yearRaw);
  const data = await loadItems(KIND, [year]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such tax year.", "NOT_FOUND");
  const p = await previewConfirmation("TAX_YEAR_CONFIRM", KIND, year, summarise(data, year), actor.userId);
  return { year, ...p, value: p.value as TaxYearValue };
}

export async function confirmTaxYear(yearRaw: string, input: { version: number; note: string; fingerprint: string }, actor: Actor): Promise<TaxYearView> {
  await requireDirector(actor.userId, "confirm a tax year");
  const year = label(yearRaw);
  const data = await loadItems(KIND, [year]);
  if (data.versions.length === 0) throw new HttpError(404, "There is no such tax year.", "NOT_FOUND");
  await confirmVersion("TAX_YEAR_CONFIRM", KIND, AUDIT, { key: year, version: input.version, note: input.note, fingerprint: input.fingerprint, summary: summarise(data, year) }, actor);
  return (await getTaxYear(year, actor)).year;
}

/** The year as the engine reads it: the current version if it is confirmed, with its version and hash for pinning. Null when nobody entered it, or when the current version is only a Placeholder. */
export async function taxYearForEngine(year: string): Promise<{ value: TaxYearValue; version: number; valueHash: string; confirmed: boolean } | null> {
  const s = summarise(await loadItems(KIND, [year]), year);
  if (!s.current) return null;
  return { value: s.current.value as TaxYearValue, version: s.current.version, valueHash: s.current.valueHash, confirmed: s.status === "CONFIRMED" };
}
