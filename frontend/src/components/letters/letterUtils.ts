import { LETTER_PLACEHOLDERS, type LetterExtraField } from "@shared/constants/letters";
import dayjs from "dayjs";
import type { PlaceholderOption } from "./LetterEditor";

// The menu: the fixed catalog, then this version's own typed fields.
export function placeholderOptions(extraFields: LetterExtraField[]): PlaceholderOption[] {
  return [
    ...Object.entries(LETTER_PLACEHOLDERS).map(([key, label]) => ({ key, label })),
    ...extraFields.filter((f) => f.key).map((f) => ({ key: `extra.${f.key}`, label: `Typed in: ${f.label || f.key}` })),
  ];
}

export function stringifyExtras(values: Record<string, unknown> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(values ?? {}).map(([k, v]) => [k, v === undefined || v === null ? "" : String(v)]));
}

// A letter stores its typed values as they were printed ("₹6,54,321", "1 January 2026"); a reissue starts from those. Turn them back into what
// the inputs (and the API) take: plain numbers and YYYY-MM-DD dates. Values already in that shape pass through unchanged.
export function toInputNumber(value: unknown): number | null | undefined {
  if (typeof value !== "string") return value as number | null | undefined;
  const digits = value.replace(/[^\d.-]/g, "");
  return digits === "" || !Number.isFinite(Number(digits)) ? null : Number(digits);
}
export function toIsoDate(value: unknown): string {
  if (typeof value !== "string" || value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value)) return typeof value === "string" ? value : "";
  const d = dayjs(value);
  return d.isValid() ? d.format("YYYY-MM-DD") : value;
}
export function rawExtras(fields: LetterExtraField[], values: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(values ?? {}) };
  for (const f of fields) {
    if (!(f.key in out)) continue;
    if (f.type === "currency" || f.type === "number") out[f.key] = toInputNumber(out[f.key]);
    else if (f.type === "date") out[f.key] = toIsoDate(out[f.key]);
  }
  return out;
}
