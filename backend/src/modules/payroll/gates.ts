import type { NextFunction, Request, Response } from "express";
import { RULE_BY_KEY } from "@shared/constants/payrollRules";
import { HttpError } from "../../middleware/errorHandler";
import { tagGate } from "../../middleware/rbac";

// Route gates whose permission depends on WHAT is being changed (docs/plans/PHASE_6.md §14J). An owner's secret (the company identifiers, the bank layout and debit account) is
// entered and confirmed with its own permissions, not with payroll.rules.manage / payroll.rules.confirm, so the person who builds the system and edits ordinary rules can never
// enter or confirm them. Each gate lists both keys, so the route inventory and the manager-reach audit still read the real keys from it.

const RULES = { manage: "payroll.rules.manage", confirm: "payroll.rules.confirm" } as const;
const IDENTIFIERS = { manage: "payroll.identifiers.manage", confirm: "payroll.identifiers.confirm" } as const;
const BANK_LAYOUT = { manage: "payroll.banklayout.manage", confirm: "payroll.banklayout.confirm" } as const;

function gate(action: "manage" | "confirm", pick: (req: Request) => { manage: string; confirm: string }) {
  return tagGate(
    (req: Request, _res: Response, next: NextFunction): void => {
      if (!req.user) return next(new HttpError(401, "Authentication required", "UNAUTHENTICATED"));
      const need = pick(req)[action];
      if (!req.user.permissions.has(need)) return next(new HttpError(403, `Missing permission: ${need}`, "FORBIDDEN"));
      next();
    },
    [RULES[action], IDENTIFIERS[action], BANK_LAYOUT[action]],
  );
}

/** For /rules/:key: the identifiers' permission for a sealed rule, the ordinary one for every other. */
export const ruleGate = (action: "manage" | "confirm") => gate(action, (req) => (RULE_BY_KEY[String(req.params.key)]?.sensitiveClass ? IDENTIFIERS : RULES));
/** For /layouts/:key: the bank layout's permission for the bank file, the ordinary one for the four statutory layouts. */
export const layoutGate = (action: "manage" | "confirm") => gate(action, (req) => (req.params.key === "BANK_TEMPLATE" ? BANK_LAYOUT : RULES));
