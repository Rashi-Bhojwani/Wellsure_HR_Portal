import { prisma } from "../src/lib/prisma";
import { closeSecurityAlertQueue } from "../src/jobs/securityAlertQueue";
import { AdminCliRefusal, assertBootstrapAllowed, bootstrapSuperAdmin, NEW_EMPLOYEE_FIELDS, type BootstrapInput } from "../src/modules/access/bootstrap";
import { ask, confirmOrExit, interactive, parseArgs, printTarget, startLiveSignals, stopLiveSignals } from "./lib/cli";

// `npm run admin:bootstrap` — creates the FIRST real Super Admin on a fresh
// staging/production database. Refuses once any active Super Admin exists.
// Full procedure: docs/GETTING_STARTED.md "Creating the first Super Admin".
//
// Details come from flags, BOOTSTRAP_* environment variables, or prompts
// (when run in a terminal) — never from the repo. No password is ever
// entered here: the person receives the invitation email and sets their own.
//
//   --employee-code  BOOTSTRAP_EMPLOYEE_CODE   (always)
//   --full-name      BOOTSTRAP_FULL_NAME       (new employee only, likewise below)
//   --personal-email BOOTSTRAP_PERSONAL_EMAIL  (Gmail — where the invitation goes)
//   --mobile         BOOTSTRAP_MOBILE
//   --date-of-birth  BOOTSTRAP_DATE_OF_BIRTH   (YYYY-MM-DD)
//   --gender         BOOTSTRAP_GENDER          (MALE | FEMALE | OTHER)
//   --date-of-joining BOOTSTRAP_DATE_OF_JOINING (YYYY-MM-DD)
//   --official-email BOOTSTRAP_OFFICIAL_EMAIL  (optional)
//   --operator "<your name>"  required: who is running this (goes into the alert and audit)
//   --mail-is-down   proceed even if the alert email to SECURITY_ALERT_EMAIL fails (queued and retried)
//   --print-link     also print the set-password link (when email can't be relied on)
//   --yes            skip the confirmation prompt (required when not in a terminal)

const FIELDS = {
  employeeCode: { flag: "employee-code", env: "BOOTSTRAP_EMPLOYEE_CODE", label: "Employee code" },
  fullName: { flag: "full-name", env: "BOOTSTRAP_FULL_NAME", label: "Full name" },
  personalEmail: { flag: "personal-email", env: "BOOTSTRAP_PERSONAL_EMAIL", label: "Personal email (Gmail; the invitation goes here)" },
  mobile: { flag: "mobile", env: "BOOTSTRAP_MOBILE", label: "Mobile" },
  dateOfBirth: { flag: "date-of-birth", env: "BOOTSTRAP_DATE_OF_BIRTH", label: "Date of birth (YYYY-MM-DD)" },
  gender: { flag: "gender", env: "BOOTSTRAP_GENDER", label: "Gender (MALE / FEMALE / OTHER)" },
  dateOfJoining: { flag: "date-of-joining", env: "BOOTSTRAP_DATE_OF_JOINING", label: "Date of joining (YYYY-MM-DD)" },
  officialEmail: { flag: "official-email", env: "BOOTSTRAP_OFFICIAL_EMAIL", label: "Official email (optional)" },
} as const;
type Field = keyof typeof FIELDS;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await startLiveSignals();
  printTarget("Wellsure HR — create the first Super Admin");

  const input: Record<string, string | undefined> = {};
  for (const [key, f] of Object.entries(FIELDS)) {
    const v = typeof args[f.flag] === "string" ? (args[f.flag] as string) : process.env[f.env];
    if (v?.trim()) input[key] = v.trim();
  }
  const prompt = async (key: Field) => {
    if (input[key] || !interactive) return;
    const v = await ask(`${FIELDS[key].label}: `);
    if (v) input[key] = key === "gender" ? v.toUpperCase() : v;
  };

  await prompt("employeeCode");
  if (!input.employeeCode) throw new AdminCliRefusal("An employee code is required (--employee-code or BOOTSTRAP_EMPLOYEE_CODE).");
  await assertBootstrapAllowed(input.employeeCode); // refuse before asking anything else
  const existing = await prisma.employee.findUnique({ where: { employeeCode: input.employeeCode }, select: { id: true } });
  if (!existing) {
    console.log(`No employee ${input.employeeCode} yet — one will be created with these details:`);
    for (const key of [...NEW_EMPLOYEE_FIELDS, "officialEmail"] as const) await prompt(key);
  }

  console.log("\nAbout to:");
  console.log(existing ? `  • make existing employee ${input.employeeCode} a Super Admin` : `  • create employee ${input.employeeCode} (${input.fullName ?? "?"}) and make them a Super Admin`);
  console.log(`  • email them an invitation to set their own password${existing ? " (if they haven't activated yet)" : ` at ${input.personalEmail ?? "?"}`}\n`);
  let operator = typeof args.operator === "string" ? args.operator : "";
  if (!operator && interactive) operator = await ask("Your name (operator — goes into the security alert): ");
  console.log("A security alert is logged and emailed to SECURITY_ALERT_EMAIL (if set) BEFORE anything is created.\n");
  await confirmOrExit(args.yes === true);

  const result = await bootstrapSuperAdmin(input as BootstrapInput, { operator, mailIsDown: args["mail-is-down"] === true });
  console.log(`\nDone (${result.outcome}). ${result.employeeCode} is a Super Admin.`);
  if (result.account === "invited") {
    console.log(`Invitation emailed to ${result.invitedEmail}. They open the link, set a password (and 2FA, where the auth.require2faRoles setting requires it), and sign in with employee code ${result.employeeCode}.`);
    if (args["print-link"] === true && result.link) console.log(`\nSet-password link (single use — treat it like a password):\n  ${result.link}`);
  } else {
    console.log("Their account was already active: they sign in as usual and now see the Admin portal.");
  }
  console.log("\nNext: sign in as them, complete their profile (address, job placement), and appoint the second Super Admin in the app (Employee profile → Access).");
}

main()
  .catch((err: unknown) => {
    if (err instanceof AdminCliRefusal) console.error(`\nRefused: ${err.message}`);
    else if (err && typeof err === "object" && "issues" in err) console.error("\nInvalid input:", (err as { issues: Array<{ path: unknown[]; message: string }> }).issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    else console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await stopLiveSignals();
    await closeSecurityAlertQueue();
    await prisma.$disconnect();
  });
