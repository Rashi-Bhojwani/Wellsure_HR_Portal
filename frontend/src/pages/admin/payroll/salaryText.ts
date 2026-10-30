import { COMPONENT_TYPE_LABEL } from "@shared/constants/payrollSalary";
import type { ComponentValue, LineCalc } from "../../../api/payroll";
import { formatRupees } from "../../../lib/money";

// Words for the salary screens: what a component or a structure line says, in the language a person at HR would use.

export const describeComponent = (v: unknown): string => {
  const c = v as ComponentValue;
  return `${c.name}: ${COMPONENT_TYPE_LABEL[c.type].toLowerCase()}${c.taxable === null ? ", taxable: not set" : c.taxable ? ", taxable" : ""}${c.pfApplicable ? ", PF" : ""}${c.esiApplicable ? ", ESI" : ""}${c.prorates ? ", pro-rates" : ""}`;
};

export function describeCalc(calc: LineCalc, nameOf: (code: string) => string): string {
  switch (calc.method) {
    case "PERCENT":
      return `${calc.percent}% of ${calc.of === "CTC" ? "CTC" : nameOf(calc.of)}`;
    case "FIXED_AMOUNT":
      return `${formatRupees(calc.amount)} a month, for everyone`;
    case "PER_PERSON":
      return "typed in for each person";
    case "FORMULA":
      return `formula: ${calc.formula}`;
    case "BALANCE":
      return "whatever is left of CTC";
    case "SLAB":
      return `looked up in a table of ${calc.slabs.length} row${calc.slabs.length === 1 ? "" : "s"}, by ${calc.of === "CTC" ? "CTC" : nameOf(calc.of)}`;
  }
}

export const REASON_LABEL = { JOINING: "First salary", REVISION: "Revision", CORRECTION: "Correction" } as const;
