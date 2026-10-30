import { assertDevelopmentEnvironment } from "../src/lib/devGuard";

// `npm run seed:demo-company`: the fictional demo company (scripts/demo/seedDemoCompany.ts). Development only, on a database that `npm run db:seed` has seeded.
assertDevelopmentEnvironment("seeding the demo company (fake people, salaries and a fictional bank format)");

const { seedDemoCompany } = await import("./demo/seedDemoCompany");
const { prisma } = await import("../src/lib/prisma");
try {
  const r = await seedDemoCompany();
  console.log(`Demo company ready: ${r.people} people with pay details, attendance locked for ${r.cycle.start} to ${r.cycle.end}.`);
  console.log(`Sign in with the Employee Code and the password "${r.password}":`);
  for (const l of r.logins) console.log(`  ${l.code}  ${l.name.padEnd(24)} ${l.role}`);
  console.log("Everything here is made up. The app shows a DEMO COMPANY banner on every screen while it exists.");
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
// The seeding enqueues director notices, which leaves queue connections open: without this a FAILED seed printed its error and then hung until the CI job was cancelled (40 minutes).
process.exit(process.exitCode ?? 0);
