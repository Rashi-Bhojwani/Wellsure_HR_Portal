import { businessToday } from "../../lib/businessDate";
import type { SetupItem } from "../payroll/setup/types";
import { bandLabel, DEFAULT_RULE } from "./evaluate";
import { settingsForMonth, TITLES } from "./settings";

// Ready for First Run (docs/plans/LATE_CHECKLIST.md §7): information rows only, never blocking (each carries `behaviour`, which the readiness list shows apart).

const WHERE = { label: "Attendance, Lateness Rule", path: "/admin/workforce/attendance/lateness-rule" };

export const PENALTY_LAW_TEXT =
  "Fines deducted from wages are regulated by law (the Payment of Wages Act, 1936, and its replacement, the Code on Wages, 2019). The directors should confirm the penalty option is allowed for their case before using it. The portal does not give legal advice.";

export async function latenessSetupItems(): Promise<SetupItem[]> {
  const s = await settingsForMonth(businessToday().toISOString().slice(0, 7));
  const shown = s.ruleConfigured ?? DEFAULT_RULE;
  const base = { section: "company" as const, category: "Lateness rule", required: false, status: "CONFIRMED" as const, enteredBy: null, confirmedBy: null, where: WHERE };
  const rows: SetupItem[] = [
    {
      ...base,
      id: "lateness:rule",
      title: s.rule ? "Lateness rule: on" : "Lateness rule: off",
      why: TITLES["late.rule"].what,
      detail: s.rule ? `On from ${s.rule.effectiveFrom}.` : "Off (the default). While off, nothing changes anywhere. Two directors switch it on.",
      behaviour: { state: s.rule ? "CONFIRMED" : "DEFAULT", label: s.rule ? "On" : "Off" },
    },
  ];
  shown.bands.forEach((b, i) => {
    if (b.outcome.kind !== "NOT_SET") return;
    const label = bandLabel(shown, (i + 1) as 1 | 2 | 3);
    rows.push({ ...base, id: `lateness:band${i + 1}`, title: `Lateness band ${label}: owner to decide`, why: "What an arrival in this band costs is the owners' choice: nothing, a late mark, a salary cut in days, or a fixed penalty.", detail: "Not set: behaves as no consequence until the owners decide.", behaviour: { state: "NOT_SET", label: "Owner to decide" } });
  });
  rows.push(
    { ...base, id: "lateness:penaltyLaw", title: "Lateness penalty: owners to confirm it is allowed", why: PENALTY_LAW_TEXT, detail: PENALTY_LAW_TEXT, behaviour: { state: "NOT_SET", label: "Owner review" } },
    { ...base, id: "lateness:missingPunch", title: TITLES["late.missingPunch"].title, why: TITLES["late.missingPunch"].what, detail: s.missingPunch ? `Chosen: ${s.missingPunch.outcome} from ${s.missingPunch.effectiveFrom}.` : TITLES["late.missingPunch"].defaultText, behaviour: { state: s.missingPunch ? "CONFIRMED" : "DEFAULT", label: s.missingPunch ? "Chosen" : "Default in use" } },
    { ...base, id: "lateness:halfDay", title: TITLES["late.halfDay"].title, why: TITLES["late.halfDay"].what, detail: s.halfDay ? `Chosen: full day ${s.halfDay.fullDayMinMinutes} min, half day ${s.halfDay.halfDayMinMinutes} min, minimum not met ${s.halfDay.halfDayMinNotMetLopDays} day, from ${s.halfDay.effectiveFrom}.` : TITLES["late.halfDay"].defaultText, behaviour: { state: s.halfDay ? "CONFIRMED" : "DEFAULT", label: s.halfDay ? "Chosen" : "Default in use" } },
  );
  return rows;
}
