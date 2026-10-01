// Letters (Phase 5 commit D2). The placeholder catalog is a closed list —
// a template can only reference these (plus its own typed `extra.*` fields),
// checked when the template is saved, the same allowlist idea as the
// People directory's field policy.

export const LETTER_PLACEHOLDERS = {
  "employee.fullName": "Employee's full name (as on the letter date)",
  "employee.code": "Employee Code",
  "employee.designation": "Designation",
  "employee.department": "Department",
  "employee.branch": "Branch",
  "employee.dateOfJoining": "Date of joining",
  "employee.lastWorkingDate": "Last working day (from the separation)",
  "employee.currentAddress": "Current address",
  "company.legalName": "Company legal name",
  "company.address": "Company registered address",
  "letter.date": "Letter date",
  "letter.reference": "Letter reference (e.g. LTR-000123)",
  "signatory.name": "Signatory's name",
  "signatory.designation": "Signatory's designation",
} as const;
export type LetterPlaceholder = keyof typeof LETTER_PLACEHOLDERS;

// Typed fields a template version asks HR for at generation time (e.g. an
// offer letter's CTC until Phase 6 can pull it from salary structures).
export const LETTER_EXTRA_FIELD_TYPES = ["text", "number", "currency", "date"] as const;
export type LetterExtraFieldType = (typeof LETTER_EXTRA_FIELD_TYPES)[number];
export interface LetterExtraField {
  key: string; // referenced as {{extra.<key>}}
  label: string;
  type: LetterExtraFieldType;
  required: boolean;
}
export const LETTER_EXTRA_FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9]{0,39}$/;

// {{ path }} — the only placeholder syntax.
export const LETTER_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export const SEEDED_LETTER_CODES = ["OFFER", "APPOINTMENT", "EXPERIENCE", "RELIEVING", "ADDRESS_PROOF"] as const;

export function formatLetterNumber(n: number): string {
  return `LTR-${String(n).padStart(6, "0")}`;
}
