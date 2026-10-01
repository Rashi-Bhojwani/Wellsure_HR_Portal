import type { LetterExtraField } from "@shared/constants/letters";

// Starter letter templates (Phase 5 commit D2). Neutral wording of our own —
// never greytHR's — and every one is marked as a draft for HR to review and
// rewrite in Admin Tools → Email & Letter Templates. They pass the same
// sanitizer and placeholder validation as any HR edit (letters.test.ts).

export interface LetterTemplateSeed {
  code: string;
  name: string;
  description: string;
  bodyHtml: string;
  extraFields: LetterExtraField[];
}

const DRAFT_NOTE = "<p><em>[Draft wording — HR to review before use.]</em></p>";
const HEAD = `<p style="text-align:right">Ref: {{letter.reference}}<br />Date: {{letter.date}}</p>`;
const SIGN = `<p>For {{company.legalName}}</p><p><br /></p><p>{{signatory.name}}<br />{{signatory.designation}}</p>`;

export const LETTER_TEMPLATE_SEEDS: LetterTemplateSeed[] = [
  {
    code: "OFFER",
    name: "Offer Letter",
    description: "Issued at joining. CTC and probation period are typed in at generation until Phase 6 salary structures exist.",
    extraFields: [
      { key: "ctcAnnual", label: "Annual CTC (₹)", type: "currency", required: true },
      { key: "probationMonths", label: "Probation period (months)", type: "number", required: true },
    ],
    bodyHtml: `${DRAFT_NOTE}${HEAD}<p>{{employee.fullName}}<br />{{employee.currentAddress}}</p><h2 style="text-align:center">Offer of Employment</h2><p>Dear {{employee.fullName}},</p><p>We are pleased to offer you the position of <strong>{{employee.designation}}</strong> in the {{employee.department}} department at our {{employee.branch}} branch, with effect from {{employee.dateOfJoining}}.</p><p>Your annual cost to company will be <strong>{{extra.ctcAnnual}}</strong>. You will be on probation for {{extra.probationMonths}} months from your date of joining.</p><p>Please sign and return a copy of this letter as your acceptance.</p>${SIGN}`,
  },
  {
    code: "APPOINTMENT",
    name: "Appointment Letter",
    description: "Confirms the appointment and its terms.",
    extraFields: [],
    bodyHtml: `${DRAFT_NOTE}${HEAD}<p>{{employee.fullName}}<br />Employee Code: {{employee.code}}</p><h2 style="text-align:center">Letter of Appointment</h2><p>Dear {{employee.fullName}},</p><p>We are pleased to appoint you as <strong>{{employee.designation}}</strong> in the {{employee.department}} department, based at our {{employee.branch}} branch, with effect from {{employee.dateOfJoining}}.</p><p>Your employment is governed by the company's policies as amended from time to time.</p>${SIGN}`,
  },
  {
    code: "EXPERIENCE",
    name: "Experience Letter",
    description: "States the period of employment. Needs the employee's separation (last working day).",
    extraFields: [],
    bodyHtml: `${DRAFT_NOTE}${HEAD}<h2 style="text-align:center">To Whom It May Concern</h2><p>This is to certify that <strong>{{employee.fullName}}</strong> (Employee Code {{employee.code}}) was employed with {{company.legalName}} from {{employee.dateOfJoining}} to {{employee.lastWorkingDate}}, last holding the position of {{employee.designation}} in the {{employee.department}} department.</p><p>We wish them every success in the future.</p>${SIGN}`,
  },
  {
    code: "RELIEVING",
    name: "Relieving Letter",
    description: "Confirms the employee has been relieved. Needs the employee's separation (last working day).",
    extraFields: [],
    bodyHtml: `${DRAFT_NOTE}${HEAD}<p>{{employee.fullName}}<br />Employee Code: {{employee.code}}</p><h2 style="text-align:center">Relieving Letter</h2><p>Dear {{employee.fullName}},</p><p>This is to confirm that you have been relieved of your duties as {{employee.designation}} with effect from the close of business on {{employee.lastWorkingDate}}.</p><p>We thank you for your contribution and wish you well.</p>${SIGN}`,
  },
  {
    code: "ADDRESS_PROOF",
    name: "Address Proof Letter",
    description: "Confirms employment and current address, typically for a bank or landlord.",
    extraFields: [{ key: "addressedTo", label: "Addressed to (e.g. The Branch Manager, XYZ Bank)", type: "text", required: false }],
    bodyHtml: `${DRAFT_NOTE}${HEAD}<p>{{extra.addressedTo}}</p><h2 style="text-align:center">Address Confirmation</h2><p>This is to confirm that <strong>{{employee.fullName}}</strong> (Employee Code {{employee.code}}) has been employed with {{company.legalName}} as {{employee.designation}} since {{employee.dateOfJoining}}.</p><p>As per our records, their current residential address is:</p><p>{{employee.currentAddress}}</p><p>This letter is issued at the employee's request.</p>${SIGN}`,
  },
];
