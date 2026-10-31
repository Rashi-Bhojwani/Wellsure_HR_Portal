import { LEAVE_RULE_LABELS } from "@shared/constants/peepsLeave";
import type { LeaveRules } from "./api";

const EMPLOYMENT: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern", CONSULTANT: "Consultant", PROBATION: "Probation" };

/** A rule version in plain words, one line per rule. */
export function describeRules(r: LeaveRules): Array<{ label: string; value: string }> {
  return [
    { label: "Paid", value: r.paid ? "Paid" : "Unpaid" },
    { label: "Entitlement", value: r.entitlement.kind === "CAP" ? `${LEAVE_RULE_LABELS[r.entitlement.period].replace("this many", r.entitlement.days)}` : LEAVE_RULE_LABELS.GRANTED_BALANCE },
    { label: "Eligibility", value: `${r.eligibility.minServiceDays} days after joining; ${r.eligibility.employmentTypes.map((t) => EMPLOYMENT[t] ?? t).join(", ")}` },
    { label: "Units", value: LEAVE_RULE_LABELS[r.units] },
    { label: "Counting", value: LEAVE_RULE_LABELS[r.counting] },
    { label: "Supporting document", value: r.document.required ? (r.document.whenMoreThanDays === 0 ? "Always required" : `Required for more than ${r.document.whenMoreThanDays} day(s)`) : "Not required" },
    { label: "Who decides", value: LEAVE_RULE_LABELS[r.approvalRoute] },
    { label: "Year end", value: r.yearEnd ? `${LEAVE_RULE_LABELS[r.yearEnd.carryForward]}; ${LEAVE_RULE_LABELS[r.yearEnd.encashment]} — not processed until the payroll side is built` : "Not set (left out of the year end)" },
  ];
}
