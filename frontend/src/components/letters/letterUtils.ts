import { LETTER_PLACEHOLDERS, type LetterExtraField } from "@shared/constants/letters";
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
