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

// P7-3 (docs/plans/PHASE_7.md §6) and A-3's letter hook: pay figures a letter takes from the person's applied salary rows, never typed. A template that uses
// any of them can never be proved pay-free, so only a director can issue it. The revision is the salary row in force on the letter date and the row before it;
// the offer is the row in force on the date of joining.
export const LETTER_PAY_PLACEHOLDERS = {
  "revision.effectiveDate": "Revision: the date the current salary applies from",
  "revision.previousCtc": "Revision: annual CTC before",
  "revision.newCtc": "Revision: annual CTC now",
  "revision.breakup": "Revision: monthly breakup now, one pay head per line",
  "offer.ctc": "Offer: annual CTC at joining",
  "offer.breakup": "Offer: monthly breakup at joining, one pay head per line",
} as const;
export type LetterPayPlaceholder = keyof typeof LETTER_PAY_PLACEHOLDERS;
export const isPayPlaceholder = (key: string): key is LetterPayPlaceholder => key in LETTER_PAY_PLACEHOLDERS;

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
