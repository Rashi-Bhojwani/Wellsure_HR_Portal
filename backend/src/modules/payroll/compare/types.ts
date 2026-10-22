// Comparing two payroll registers (docs/plans/PHASE_6.md §14J): ours against greytHR's, during the months they run side by side. Everything here is in a neutral shape (a register is
// people, each with labelled amounts) so that the comparison does not care where a register came from; only the parser that turns a file into that shape is specific to a source.

export type RegisterSource = "OWN" | "GENERIC" | "GREYTHR";

export interface RegisterPerson {
  code: string;
  name: string | null;
  /** Label of the column → an exact decimal as text. */
  amounts: Map<string, string>;
}

export interface Register {
  /** What the user called it (for example "Wellsure" or "greytHR"). */
  label: string;
  source: RegisterSource;
  /** Amount columns in the order they appeared. */
  columns: string[];
  /** Columns that were not amounts (text such as a status) and were left out, so nothing disappears silently. */
  ignoredColumns: string[];
  people: Map<string, RegisterPerson>;
}

export interface CompareOptions {
  /** A difference of up to this many rupees is within tolerance. */
  toleranceAmount: string;
  /** A difference of up to this percentage of the first register's figure is within tolerance. Within either is within tolerance. */
  tolerancePercent: string;
  /** Maps a label in the second register to the label it means in the first ("Basic Salary" → "Basic"). */
  aliases: Record<string, string>;
}

export interface Difference {
  label: string;
  a: string | null;
  b: string | null;
  difference: string;
  percent: string | null;
  flagged: boolean;
}

export interface PersonResult {
  code: string;
  name: string | null;
  differences: Difference[];
  flagged: boolean;
}

export interface CompareResult {
  a: { label: string; people: number; columns: string[]; ignoredColumns: string[] };
  b: { label: string; people: number; columns: string[]; ignoredColumns: string[] };
  options: CompareOptions;
  summary: { matchedPeople: number; identical: number; differing: number; flagged: number; onlyInA: number; onlyInB: number };
  /** People in both whose figures differ at all, flagged or not. Identical people are only counted. */
  people: PersonResult[];
  onlyInA: Array<{ code: string; name: string | null }>;
  onlyInB: Array<{ code: string; name: string | null }>;
  columns: { matched: string[]; onlyInA: string[]; onlyInB: string[] };
  /** Column totals over the people in both registers. */
  totals: Array<{ label: string; a: string; b: string; difference: string }>;
}
