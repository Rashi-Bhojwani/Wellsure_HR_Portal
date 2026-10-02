import { prisma } from "../src/lib/prisma";
import { listActiveSuperAdmins } from "../src/lib/securityAlerts";
import { closeSecurityAlertQueue } from "../src/jobs/securityAlertQueue";
import { AdminCliRefusal } from "../src/modules/access/bootstrap";
import { MIN_REASON_LENGTH, recoverSuperAdmin } from "../src/modules/access/recovery";
import { ask, confirmOrExit, interactive, parseArgs, printTarget, startLiveSignals, stopLiveSignals } from "./lib/cli";

// `npm run admin:recover` — break-glass recovery for a Super Admin who has
// lost their password or 2FA device when no other Super Admin can help in
// the app. Super Admin targets only. LOUD by design (E1.1): every active
// Super Admin and SECURITY_ALERT_EMAIL are emailed BEFORE anything changes,
// and a banner stays in the app until another Super Admin acknowledges it.
// Procedure: docs/GETTING_STARTED.md "If a Super Admin loses their password
// or 2FA device".
//
//   --employee-code X                  the Super Admin to recover (required)
//   --reset-2fa                        clear their 2FA; they re-enrol at next sign-in
//   --password-reset                   email them a 1-hour password-reset link
//   --unlock                           clear a failed-login lockout
//   --reason "..."                     required (≥10 chars); recorded on every action
//   --operator "<your name>"           required; who is running this
//   --confirm-no-other-admin "<why>"   required; why the in-app route can't be used
//   --mail-is-down                     proceed even if the alert email fails (it's queued and retried)
//   --print-link                       also print the reset link (when email is the problem)
//   --yes                              skip the confirmation prompt (required when not in a terminal)

const text = (args: Record<string, string | true>, key: string) => (typeof args[key] === "string" ? (args[key] as string) : "");

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await startLiveSignals();
  printTarget("Wellsure HR — Super Admin break-glass recovery");

  let employeeCode = text(args, "employee-code");
  if (!employeeCode && interactive) employeeCode = await ask("Employee code of the Super Admin: ");
  if (!employeeCode) throw new AdminCliRefusal("--employee-code is required.");

  // Who could have done this in the app instead (recovery step 1)?
  const others = (await listActiveSuperAdmins()).filter((a) => a.employeeCode !== employeeCode);
  console.log("Other active Super Admins (they can do this in the app — Employee profile → Access):");
  if (others.length === 0) console.log("  (none)");
  for (const a of others) console.log(`  ${a.employeeCode} ${a.name} — last signed in ${a.lastLoginAt ? a.lastLoginAt.toISOString() : "never"}`);
  console.log("");

  let reason = text(args, "reason");
  if (!reason && interactive) reason = await ask(`Reason (≥${MIN_REASON_LENGTH} chars; emailed to every Super Admin and kept in the audit log): `);
  let operator = text(args, "operator");
  if (!operator && interactive) operator = await ask("Your name (operator): ");
  let justification = text(args, "confirm-no-other-admin");
  if (!justification && interactive) justification = await ask("Why can't another Super Admin do this in the app? ");

  const actions = { resetTwoFactor: args["reset-2fa"] === true, passwordReset: args["password-reset"] === true, unlock: args.unlock === true };
  console.log(`\nAbout to recover ${employeeCode}:${actions.unlock ? " unlock;" : ""}${actions.resetTwoFactor ? " reset 2FA;" : ""}${actions.passwordReset ? " send a password-reset link;" : ""}`);
  console.log("Every active Super Admin (the target included) is emailed FIRST, and a security banner appears in the app.\n");
  await confirmOrExit(args.yes === true);

  const result = await recoverSuperAdmin({ employeeCode, reason, operator, justification, mailIsDown: args["mail-is-down"] === true, ...actions });
  console.log(`\nAlert emailed to: ${result.alert.emailed.join(", ") || "(nobody)"}${result.alert.queued.length ? `; QUEUED for retry: ${result.alert.queued.join(", ")}` : ""}.`);
  console.log(`Security event ${result.alert.eventId} raised.`);
  console.log(`Done for ${result.employeeCode}: ${result.done.join("; ")}.`);
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
  .finally(async () => {
    await stopLiveSignals();
    await closeSecurityAlertQueue();
    await prisma.$disconnect();
  });
