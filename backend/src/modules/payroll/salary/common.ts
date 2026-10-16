import { HttpError } from "../../../middleware/errorHandler";
import { RuleContext, type RulePin } from "../rules/context";
import type { RoundingRule } from "./breakup";
import { InvalidSalaryValueError } from "./schemas";

// Small things the salary services share.

/** "Rounding of salary lines", read through RuleContext so the pin of the version used comes with it. Throws RULE_NOT_SET (with words) if it has no value. */
export async function loadLineRounding(): Promise<{ rule: RoundingRule; pin: RulePin }> {
  const ctx = await RuleContext.load();
  const rule = ctx.rule<RoundingRule>("LINE_ROUNDING");
  return { rule, pin: ctx.pins()[0]! };
}

/** An InvalidSalaryValueError as the 400 the screens show, with every problem listed. */
export function asValidationError(err: unknown): never {
  if (err instanceof InvalidSalaryValueError) throw new HttpError(400, err.issues.join("; "), "VALIDATION_ERROR", { issues: err.issues });
  throw err;
}
