import { prisma } from "../src/lib/prisma";
import { AdminCliRefusal } from "../src/modules/access/bootstrap";
import { recoverSuperAdmin } from "../src/modules/access/recovery";
import { ask, confirmOrExit, interactive, parseArgs, printTarget } from "./lib/cli";

// `npm run admin:recover` — break-glass recovery for a Super Admin who has
// lost their password or 2FA device when no other Super Admin can help in
// the app. Super Admin targets only; every action is audit-logged.
// Procedure: docs/GETTING_STARTED.md "If a Super Admin loses their password
// or 2FA device".
//
//   --employee-code X   the Super Admin to recover (required)
//   --reset-2fa         clear their 2FA; they re-enrol at next sign-in
//   --password-reset    email them a 1-hour password-reset link
//   --unlock            clear a failed-login lockout
//   --reason "..."      required; recorded in the audit log
//   --print-link        also print the reset link (when email is the problem)
//   --yes               skip the confirmation prompt (required when not in a terminal)

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  printTarget("Wellsure HR — Super Admin break-glass recovery");

  let employeeCode = typeof args["employee-code"] === "string" ? args["employee-code"] : "";
  if (!employeeCode && interactive) employeeCode = await ask("Employee code of the Super Admin: ");
  let reason = typeof args.reason === "string" ? args.reason : "";
  if (!reason && interactive) reason = await ask("Reason (goes into the audit log): ");
  if (!employeeCode) throw new AdminCliRefusal("--employee-code is required.");

  const actions = { resetTwoFactor: args["reset-2fa"] === true, passwordReset: args["password-reset"] === true, unlock: args.unlock === true };
  console.log(`About to recover ${employeeCode}:${actions.unlock ? " unlock;" : ""}${actions.resetTwoFactor ? " reset 2FA;" : ""}${actions.passwordReset ? " send a password-reset link;" : ""}`);
  console.log(`Reason: ${reason || "(none)"}\n`);
  await confirmOrExit(args.yes === true);

  const result = await recoverSuperAdmin({ employeeCode, reason, ...actions });
  console.log(`\nDone for ${result.employeeCode}: ${result.done.join("; ")}.`);
  if (actions.passwordReset) {
    console.log(result.emailedTo ? `Reset link emailed to ${result.emailedTo}.` : "No personal email on file — the link was NOT emailed.");
    if (args["print-link"] === true && result.passwordResetLink) console.log(`\nPassword-reset link (single use, 1 hour — treat it like a password):\n  ${result.passwordResetLink}`);
  }
}

main()
  .catch((err: unknown) => {
    if (err instanceof AdminCliRefusal) console.error(`\nRefused: ${err.message}`);
    else console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
