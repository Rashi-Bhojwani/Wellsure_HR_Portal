import type { RuleShape } from "@shared/constants/payrollRules";

// Showing a rule's value, and entering one, for every shape in the catalog (shared/constants/payrollRules.ts). The same input is used to edit a rule and,
// blank, to type a statutory value again when confirming it.

export const ROUNDING_LABEL: Record<string, string> = {
  HALF_UP: "Half up (0.5 goes up)",
  HALF_EVEN: "Half even (banker's)",
  UP: "Always up (to the next higher)",
  DOWN: "Always down",
  CEIL: "Ceiling",
  FLOOR: "Floor",
  NONE: "None (no rounding)",
};
export const TYPE_LABEL: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern", CONSULTANT: "Consultant", PROBATION: "Probation" };
const rupees = (s: string) => `₹${Number(s).toLocaleString("en-IN")}`; // display only: nothing is computed from this string

export const HIDDEN_TEXT = "Entered. Hidden for safety";
export const isHidden = (value: unknown): boolean => typeof value === "object" && value !== null && (value as { hidden?: unknown }).hidden === true;

export function formatRuleValue(shape: RuleShape, value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  if (isHidden(value)) return HIDDEN_TEXT;
  switch (shape.kind) {
    case "percent":
      return `${String(value)}%`;
    case "money":
      return rupees(String(value));
    case "boolean":
      return value ? "Yes" : "No";
    case "rounding": {
      const v = value as { mode: string; scale: number };
      return v.mode === "NONE" ? "No rounding" : `${ROUNDING_LABEL[v.mode] ?? v.mode}, to ${v.scale} decimal place${v.scale === 1 ? "" : "s"}`;
    }
    case "paymentDate": {
      const v = value as { monthOffset: number; day: number | "LAST" };
      return `${v.day === "LAST" ? "Last day" : `Day ${v.day}`} of ${v.monthOffset === 0 ? "the same month" : "the next month"}`;
    }
    case "employmentTypes":
      return (value as string[]).map((t) => TYPE_LABEL[t] ?? t).join(", ");
    case "json": {
      const text = JSON.stringify(value);
      return text.length > 70 ? `${text.slice(0, 70)}…` : text;
    }
    default:
      return String(value);
  }
}

/** The state an input holds for a value (strings for text boxes; structured values as they are; JSON as pretty text). */
export type InputState = string | number | boolean | null | string[] | { mode: string; scale: number } | { monthOffset: number; day: number | "LAST" };

export function initialInputState(shape: RuleShape, current: unknown | null, blank = false): InputState {
  switch (shape.kind) {
    case "percent":
    case "money":
    case "text":
    case "formula":
    case "choice":
      return blank || current === null ? "" : String(current);
    case "integer":
      return blank || current === null ? null : (current as number);
    case "boolean":
      return blank || current === null ? null : (current as boolean);
    case "rounding":
      return blank || current === null ? { mode: "", scale: 0 } : (current as { mode: string; scale: number });
    case "paymentDate":
      return blank || current === null ? { monthOffset: 1, day: 1 } : (current as { monthOffset: number; day: number | "LAST" });
    case "employmentTypes":
      return blank || current === null ? [] : (current as string[]);
    case "json":
      return blank || current === null ? "" : JSON.stringify(current, null, 2);
  }
}

/** The value to send, or a problem in words. The server validates again and its message is shown too. */
export function toSubmitValue(shape: RuleShape, state: InputState): { ok: true; value: unknown } | { ok: false; problem: string } {
  switch (shape.kind) {
    case "percent":
    case "money":
    case "text":
    case "formula":
    case "choice":
      return typeof state === "string" && state.trim() !== "" ? { ok: true, value: state.trim() } : { ok: false, problem: "Enter a value." };
    case "integer":
      return typeof state === "number" ? { ok: true, value: state } : { ok: false, problem: "Enter a whole number." };
    case "boolean":
      return typeof state === "boolean" ? { ok: true, value: state } : { ok: false, problem: "Choose Yes or No." };
    case "rounding": {
      const s = state as { mode: string; scale: number };
      return s.mode ? { ok: true, value: s } : { ok: false, problem: "Choose a rounding mode." };
    }
    case "paymentDate":
      return { ok: true, value: state };
    case "employmentTypes":
      return (state as string[]).length > 0 ? { ok: true, value: state } : { ok: false, problem: "Choose at least one." };
    case "json":
      try {
        return typeof state === "string" && state.trim() ? { ok: true, value: JSON.parse(state) } : { ok: false, problem: "Enter the table." };
      } catch {
        return { ok: false, problem: "That is not valid JSON. Check the brackets, quotes and commas." };
      }
  }
}

