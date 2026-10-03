import { prisma } from "../src/lib/prisma";
import { applyHistoryRepair, planHistoryRepair, RepairRefused, type RepairPlan } from "../src/lib/historyRepair";
import { confirmOrExit, parseArgs, printTarget } from "./lib/cli";

// `npm run history:repair` — the effective-dating data repair (EF1,
// docs/plans/EFFECTIVE_DATES.md). Two steps, never one (user decision
// 2026-10-03: show exactly what would change, let a person approve, then
// apply):
//
//   npm run history:repair
//       PREVIEW. Changes nothing. Lists every row it would fix (current
//       value → new value, and why), every row that needs a person instead,
//       and a fingerprint of the exact fix list.
//
//   npm run history:repair -- --apply --fingerprint <from the preview> \
//       --approved-by "<who approved the preview>" --operator "<your name>"
//       APPLY exactly that list. Refused if anything changed since the
//       preview (the fingerprint no longer matches). One audit-log entry per
//       row. Add --yes when not running in a terminal.

const text = (args: Record<string, string | true>, key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");

function printPlan(plan: RepairPlan): void {
  if (plan.fixes.length === 0) {
    console.log("Rows to fix: none.");
  } else {
    console.log(`Rows to fix (${plan.fixes.length}) — nothing has been changed yet:\n`);
    for (const f of plan.fixes) {
      console.log(`  ${f.employeeCode}  ${f.table} ${f.rowId} (from ${f.rowFrom})`);
      console.log(`      ${f.column}: ${f.current ?? "(open)"}  →  ${f.proposed}`);
      console.log(`      why: ${f.reason}`);
    }
  }
  console.log("");
  if (plan.manual.length === 0) {
    console.log("Rows needing a person to decide: none.");
  } else {
    console.log(`Rows needing a person to decide (${plan.manual.length}) — never changed by this tool:\n`);
    for (const m of plan.manual) console.log(`  ${m.employeeCode}  ${m.table} ${m.rowIds.join(", ")}\n      ${m.reason}`);
  }
  console.log("");
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  printTarget("Wellsure HR — history repair (effective dating)");
  const plan = await planHistoryRepair();
  printPlan(plan);

  if (!args.apply) {
    if (plan.fixes.length) {
      console.log(`Fingerprint: ${plan.fingerprint}`);
      console.log("To apply exactly this list once it's approved:");
      console.log(`  npm run history:repair -- --apply --fingerprint ${plan.fingerprint} --approved-by "<who approved>" --operator "<your name>"`);
    }
    return;
  }

  if (plan.fixes.length === 0) {
    console.log("Nothing to apply.");
    return;
  }
  console.log(`Applying ${plan.fixes.length} fix(es), approved by ${text(args, "approved-by") || "(missing)"}.`);
  await confirmOrExit(args.yes === true);
  const result = await applyHistoryRepair({ fingerprint: text(args, "fingerprint"), approvedBy: text(args, "approved-by"), operator: text(args, "operator") });
  console.log(`Applied ${result.applied} fix(es); each is in the audit log as history.repaired.`);
}

try {
  await main();
} catch (err) {
  if (err instanceof RepairRefused) {
    console.error(`Refused: ${err.message}`);
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await prisma.$disconnect();
}
