import { planHistoryRepair } from "./historyRepair";

// After migrating: if any history rows don't fit the effective-dating model,
// say so loudly (with counts) and point at the preview. Changes nothing —
// the repair only ever runs after a person approves its exact list.
export async function warnIfHistoryNeedsRepair(log: (line: string) => void): Promise<void> {
  const plan = await planHistoryRepair();
  if (plan.fixes.length === 0 && plan.manual.length === 0) return;
  log(`HISTORY NEEDS REPAIR: ${plan.fixes.length} row(s) with a clear fix, ${plan.manual.length} needing a person. Nothing was changed.`);
  log("Preview them with `npm run history:repair` (from backend/), get the list approved, then apply it with the printed command.");
}
