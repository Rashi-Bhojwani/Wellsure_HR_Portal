import type { ExpectedDay } from "./model";

// The comparison the replay and the CLI both make: every field the plan
// expects, against what the server stored (docs/plans/PHASE_2.md "P2-G build
// design"). Pure; the caller says what the stored day is.

export interface FieldDifference {
  field: string;
  expected: unknown;
  actual: unknown;
}

/** The fields that differ between the expected day and the stored one; `null` stored means no record. */
export function differences(expected: ExpectedDay | null, stored: Record<string, unknown> | null): FieldDifference[] {
  if (!expected) return stored ? [{ field: "record", expected: "no record", actual: String(stored.status) }] : [];
  if (!stored) return [{ field: "record", expected: expected.status, actual: "no record" }];
  const out: FieldDifference[] = [];
  for (const field of Object.keys(expected) as Array<keyof ExpectedDay>) {
    if (JSON.stringify(expected[field]) !== JSON.stringify(stored[field])) out.push({ field, expected: expected[field], actual: stored[field] });
  }
  return out;
}
