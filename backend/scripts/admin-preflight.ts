import { env } from "../src/config/env";
import { mailService } from "../src/integrations/mail";
import { initFieldEncryption } from "../src/lib/fieldKeys";
import { awsProbes, blockingFailures, runPreflight } from "../src/lib/preflight";
import { prisma } from "../src/lib/prisma";
import { parseArgs } from "./lib/cli";

// `npm run admin:preflight` — is this environment ready for its first administrator and for real data? Read-only (except --send-test).
// Run it from an ECS Exec shell in the api container after the first deploy, before admin:bootstrap; admin:bootstrap also runs the
// alerting part of it and refuses if it fails. Exit code 1 if anything fails. Procedure: docs/DEPLOYMENT.md "Before the first administrator".
//
//   --alerting-only  only the checks admin:bootstrap itself depends on
//   --send-test      also send one test message to SECURITY_ALERT_EMAIL (the only thing here that is not a read) and ask you to confirm it arrived

const MARK = { pass: "PASS", warn: "WARN", fail: "FAIL", skip: "skip" } as const;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await initFieldEncryption();
  console.log(`\nPreflight for ${env.APP_ENV}\n`);
  const results = await runPreflight(
    { appEnv: env.APP_ENV, sesFrom: env.SES_FROM, securityAlertEmail: env.SECURITY_ALERT_EMAIL, breakGlassTopicArn: env.BREAKGLASS_ALARM_TOPIC_ARN },
    awsProbes(),
    { alertingOnly: args["alerting-only"] === true },
  );
  for (const r of results) console.log(`  ${MARK[r.status].padEnd(4)}  ${r.label}\n        ${r.detail}`);
  const failures = blockingFailures(results);
  if (args["send-test"] === true && env.SECURITY_ALERT_EMAIL) {
    await mailService.send({
      to: env.SECURITY_ALERT_EMAIL,
      subject: `[${env.APP_ENV}] Wellsure HR preflight test`,
      html: "<p>This is a test message from <code>admin:preflight</code>. If you can read it, break-glass alerts will reach you. No action is needed.</p>",
      text: "This is a test message from admin:preflight. If you can read it, break-glass alerts will reach you. No action is needed.",
    });
    console.log(`\n  Sent a test message to ${env.SECURITY_ALERT_EMAIL}. It is NOT proven until someone reads it: check that inbox now.`);
  }
  console.log(failures.length === 0 ? "\nNothing blocks the first administrator." : `\n${failures.length} check(s) failed. Fix them before running admin:bootstrap.`);
  if (failures.length > 0) process.exitCode = 1;
}

main()
  .catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
