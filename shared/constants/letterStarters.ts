import type { LetterExtraField } from "./letters";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 11): starter letter templates. ORIGINAL placeholder wording written for this project — every one is
// marked STARTER and is meant to be rewritten by the company before use. They are loaded only when a director chooses one (an audited action), never
// automatically, and a loaded starter arrives DISABLED until a director has read it and switched it on.
//
// `carriesPay` marks the letters that, in real use, state pay. Their starter text deliberately has no figure field: the figures will come from the salary
// structure once Session A's A-3 lands (the hook is `letterFigureFields` in backend/src/modules/letters/starters.ts). The wording mentions remuneration, so the
// pay-free check refuses them for anyone but a director, whatever is granted.

export interface LetterStarter {
  code: string;
  name: string;
  description: string;
  carriesPay: boolean;
  bodyHtml: string;
  extraFields: LetterExtraField[];
}

const head = `<p style="text-align: right">Ref: {{letter.reference}}<br>Date: {{letter.date}}</p><p><strong>STARTER TEXT: rewrite before use.</strong></p>`;
const sign = `<p>Yours sincerely,</p><p>For {{company.legalName}}</p><p>{{signatory.name}}<br>{{signatory.designation}}</p>`;
const to = `<p>{{employee.fullName}}<br>Employee code {{employee.code}}</p>`;

export const LETTER_STARTERS: readonly LetterStarter[] = [
  {
    code: "STARTER_ADDRESS_PROOF",
    name: "Address confirmation (starter)",
    description: "Confirms a person's employment and the address they gave us, for a bank or a landlord.",
    carriesPay: false,
    extraFields: [{ key: "addressedTo", label: "Addressed to", type: "text", required: false }],
    bodyHtml: `${head}<p>{{extra.addressedTo}}</p><h2>To whom it may concern</h2><p>This is to confirm that {{employee.fullName}} (employee code {{employee.code}}) works with {{company.legalName}} as {{employee.designation}} in the {{employee.department}} team at our {{employee.branch}} office, and has done so since {{employee.dateOfJoining}}.</p><p>The address our records hold for them is:</p><blockquote>{{employee.currentAddress}}</blockquote><p>We issue this at their request and take no responsibility beyond what it states.</p>${sign}`,
  },
  {
    code: "STARTER_APPOINTMENT",
    name: "Appointment order (starter)",
    description: "Formal appointment after an accepted offer. Carries pay in real use: directors only.",
    carriesPay: true,
    extraFields: [{ key: "reportingTo", label: "Reports to", type: "text", required: true }],
    bodyHtml: `${head}${to}<h2>Appointment</h2><p>We are glad to appoint you as {{employee.designation}} in the {{employee.department}} team, based at {{employee.branch}}, from {{employee.dateOfJoining}}. You will report to {{extra.reportingTo}}.</p><p>Your remuneration and its parts are set out in the annexure the directors issue with this order. Your working hours, leave and conduct follow the company's policies as they stand from time to time.</p><p>Please sign and return a copy to show that you accept these terms.</p>${sign}`,
  },
  {
    code: "STARTER_CONFIRMATION",
    name: "Confirmation of employment (starter)",
    description: "Tells a person their probation is over and their employment is confirmed.",
    carriesPay: false,
    extraFields: [{ key: "confirmedFrom", label: "Confirmed from", type: "date", required: true }],
    bodyHtml: `${head}${to}<h2>Confirmation</h2><p>Following a review of your work since {{employee.dateOfJoining}}, we are pleased to confirm your employment as {{employee.designation}} from {{extra.confirmedFrom}}.</p><p>All other terms of your appointment continue unchanged. Thank you for your contribution so far.</p>${sign}`,
  },
  {
    code: "STARTER_DEPARTMENT_TRANSFER",
    name: "Department transfer (starter)",
    description: "Records a move to another team.",
    carriesPay: false,
    extraFields: [
      { key: "newDepartment", label: "New department", type: "text", required: true },
      { key: "transferFrom", label: "Effective from", type: "date", required: true },
    ],
    bodyHtml: `${head}${to}<h2>Change of department</h2><p>From {{extra.transferFrom}} you will move from the {{employee.department}} team to the {{extra.newDepartment}} team. Your designation stays {{employee.designation}} and the rest of your terms do not change.</p><p>Your new team lead will be in touch about the handover.</p>${sign}`,
  },
  {
    code: "STARTER_EXPERIENCE",
    name: "Experience letter (starter)",
    description: "States the period a former employee worked with the company and their last role.",
    carriesPay: false,
    extraFields: [],
    bodyHtml: `${head}<h2>To whom it may concern</h2><p>{{employee.fullName}} (employee code {{employee.code}}) worked with {{company.legalName}} from {{employee.dateOfJoining}} to {{employee.lastWorkingDate}}. Their last designation was {{employee.designation}} in the {{employee.department}} team.</p><p>We thank them for their time with us and wish them well.</p>${sign}`,
  },
  {
    code: "STARTER_LOCATION_TRANSFER",
    name: "Location transfer (starter)",
    description: "Records a move to another office or branch.",
    carriesPay: false,
    extraFields: [
      { key: "newLocation", label: "New location", type: "text", required: true },
      { key: "transferFrom", label: "Effective from", type: "date", required: true },
    ],
    bodyHtml: `${head}${to}<h2>Change of work location</h2><p>From {{extra.transferFrom}} your place of work will be our {{extra.newLocation}} office instead of {{employee.branch}}. Your role as {{employee.designation}} continues as before.</p><p>Please speak to the HR team about any help you need with the move.</p>${sign}`,
  },
  {
    code: "STARTER_OFFER",
    name: "Offer letter (starter)",
    description: "An offer to a candidate. Carries pay in real use: directors only.",
    carriesPay: true,
    extraFields: [{ key: "acceptBy", label: "Please reply by", type: "date", required: true }],
    bodyHtml: `${head}${to}<h2>Offer</h2><p>We are happy to offer you the role of {{employee.designation}} in our {{employee.department}} team at {{employee.branch}}, starting on {{employee.dateOfJoining}}.</p><p>Your remuneration will be as set out in the annexure the directors attach to this offer. The offer depends on the usual checks of your documents and references.</p><p>Please let us know by {{extra.acceptBy}} whether you accept.</p>${sign}`,
  },
  {
    code: "STARTER_PROBATION_EXTENSION",
    name: "Probation extension (starter)",
    description: "Extends a person's probation to a new date, with the reason kept short.",
    carriesPay: false,
    extraFields: [
      { key: "extendedTo", label: "Probation extended to", type: "date", required: true },
      { key: "focus", label: "What to work on", type: "text", required: false },
    ],
    bodyHtml: `${head}${to}<h2>Probation extended</h2><p>After reviewing your work as {{employee.designation}}, we have decided to extend your probation to {{extra.extendedTo}}.</p><p>{{extra.focus}}</p><p>We will review again before that date. All other terms stay the same.</p>${sign}`,
  },
  {
    code: "STARTER_REDESIGNATION",
    name: "Change of designation (starter)",
    description: "Records a new title. Any pay change belongs in a separate letter from the directors.",
    carriesPay: false,
    extraFields: [
      { key: "newDesignation", label: "New designation", type: "text", required: true },
      { key: "changeFrom", label: "Effective from", type: "date", required: true },
    ],
    bodyHtml: `${head}${to}<h2>New designation</h2><p>From {{extra.changeFrom}} your designation will be {{extra.newDesignation}} (it was {{employee.designation}}). You remain in the {{employee.department}} team.</p><p>Congratulations, and thank you for your work.</p>${sign}`,
  },
  {
    code: "STARTER_RELIEVING",
    name: "Relieving letter (starter)",
    description: "Confirms that a person has been relieved of their duties on their last working day.",
    carriesPay: false,
    extraFields: [],
    bodyHtml: `${head}${to}<h2>Relieving</h2><p>This confirms that you have been relieved of your duties as {{employee.designation}} at the close of business on {{employee.lastWorkingDate}}, having worked with us since {{employee.dateOfJoining}}.</p><p>Any final settlement is handled separately. We wish you every success.</p>${sign}`,
  },
  {
    code: "STARTER_TERMINATION",
    name: "Termination letter (starter)",
    description: "Ends employment. Have the wording checked before use.",
    carriesPay: false,
    extraFields: [{ key: "grounds", label: "Grounds (short)", type: "text", required: true }],
    bodyHtml: `${head}${to}<h2>End of employment</h2><p>This letter tells you that your employment as {{employee.designation}} ends on {{employee.lastWorkingDate}}, for the following reason: {{extra.grounds}}.</p><p>Please return company property and complete the handover before that date. Any final settlement will be handled separately.</p>${sign}`,
  },
];

export const letterStarter = (code: string): LetterStarter | undefined => LETTER_STARTERS.find((s) => s.code === code);
