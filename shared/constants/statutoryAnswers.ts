// FIX-M5 (independent audit 2026-11-20). For professional tax, the labour welfare fund and minimum wages the two directors give one of two answers (one proposes,
// the other confirms, like every Default behaviour): "Does not apply to us" (nothing is deducted or checked, and Ready for First Run is green and says so) or
// "Applies" (they enter the values: the PT and LWF tables under Rules and setup, the minimum wage rates and compared heads under Payroll, Minimum Wages).
// "Not set" is the starting state: it shows as open, and a REAL monthly run cannot be submitted until all three have an answer (the demo company is exempt).
// This replaces the earlier "deducts nothing with a notice" behaviour.

export const STATUTORY_ANSWER_KEYS = ["statutory.professionalTax", "statutory.labourWelfareFund", "statutory.minimumWages"] as const;
export type StatutoryAnswerKey = (typeof STATUTORY_ANSWER_KEYS)[number];
export const STATUTORY_ANSWERS = ["NOT_APPLICABLE", "APPLIES"] as const;
export type StatutoryAnswer = (typeof STATUTORY_ANSWERS)[number];

export const STATUTORY_ANSWER_LABEL: Record<StatutoryAnswerKey, string> = {
  "statutory.professionalTax": "Professional Tax",
  "statutory.labourWelfareFund": "Labour Welfare Fund",
  "statutory.minimumWages": "Minimum wages",
};
export const STATUTORY_ANSWER_TEXT: Record<StatutoryAnswer, string> = { NOT_APPLICABLE: "Does not apply to us", APPLIES: "Applies" };

/**
 * The researched reference values (docs/STATUTORY_DEFAULTS.md, "Reference values, not loaded"), shown beside the form. Never loaded and never used by a
 * calculation: the directors enter their own values. Every line is marked UNVERIFIED there and needs the directors' own check.
 */
export const STATUTORY_ANSWER_REFERENCE: Record<StatutoryAnswerKey, string> = {
  "statutory.professionalTax": "Reference (Rajasthan, unverified): not levied. A Government of Rajasthan training note says professional tax is not applicable in Rajasthan; not confirmed from a gazette. Other states levy it by slab.",
  "statutory.labourWelfareFund": "Reference (Rajasthan, unverified): not levied. The Labour Department lists no Labour Welfare Fund Act; a few older secondary sources mention Rs 20 / Rs 40 a year. Not confirmed from a gazette.",
  "statutory.minimumWages": "Reference (Rajasthan shops and commercial establishments, from 13 Dec 2024, secondary sources, unverified): unskilled Rs 285/day (Rs 7,410/month), semi-skilled Rs 297 (7,722), skilled Rs 309 (8,034), highly skilled Rs 359 (9,334).",
};
