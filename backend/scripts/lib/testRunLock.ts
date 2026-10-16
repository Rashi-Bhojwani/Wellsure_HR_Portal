import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

// One test run per test database (and per test Redis database) at a time.
//
// During Phase 1.5 commit A two suites ran at once against the same test database: the second one dropped and rebuilt the database under the
// first, and both filled the screen with failures that had nothing to do with the code. A database cannot be shared by two runs, so the
// second run refuses to start instead. The lock is a Postgres session advisory lock held on one dedicated connection for the whole run:
// the server releases it the moment that connection ends, so a crashed or killed run never leaves a stale lock behind.
//
// Two locks are taken, in a fixed order: the test database, and the test Redis database (two runs with different database names but the same
// Redis database would still clash on queues, rate limits and caches). `npm run test:clock` uses its own database and Redis database, so it
// can run beside a normal run; two clock runs, or two normal runs, cannot.

const KEEPALIVE_MS = 20_000;

const keyOf = (label: string): bigint => {
  const h = createHash("sha256").update(label).digest();
  return h.readBigInt64BE(0);
};

export class TestRunAlreadyActiveError extends Error {}

export type TestRunLock = { release(): Promise<void> };

/** Takes the locks or throws TestRunAlreadyActiveError. `adminUrl` must be a database on the same server as the test database (not the test database itself: it gets dropped). */
export async function acquireTestRunLock(adminUrl: string, resources: { database: string; redis: string }): Promise<TestRunLock> {
  const url = new URL(adminUrl);
  url.searchParams.set("connection_limit", "1");
  url.searchParams.set("pool_timeout", "30");
  // Prisma closes connections it has held idle for 300 s by default; the lock lives on this connection, so it must not be recycled.
  url.searchParams.set("max_idle_connection_lifetime", "86400");
  const client = new PrismaClient({ datasourceUrl: url.toString() });
  const labels = [`wellsure-test-db:${resources.database}`, `wellsure-test-redis:${resources.redis}`];
  const held: string[] = [];
  try {
    for (const label of labels) {
      const rows = await client.$queryRaw<Array<{ ok: boolean }>>`SELECT pg_try_advisory_lock(${keyOf(label)}::bigint) AS ok`;
      if (!rows[0]?.ok) {
        throw new TestRunAlreadyActiveError(
          [
            "",
            "REFUSING TO START: another test run is already using this test environment.",
            `  ${label.startsWith("wellsure-test-db") ? `Postgres test database "${resources.database}"` : `Redis test database ${resources.redis}`} is locked by a run that is still going.`,
            "Two runs on one database drop and rebuild it under each other and every test then fails for reasons that are not in the code.",
            "Wait for the other run to finish (the lock is released the moment it ends or is killed), or run the second one against its own database",
            "(TEST_DATABASE_NAME=... REDIS_TEST_DB=...). `npm run test:clock` already does.",
            "",
          ].join("\n"),
        );
      }
      held.push(label);
    }
  } catch (err) {
    await client.$disconnect();
    throw err;
  }

  // Proof of life: a lock on a connection that silently went away is no lock. Re-asserting on the same connection is harmless (advisory locks nest).
  const timer = setInterval(() => {
    void Promise.all(labels.map((l) => client.$queryRaw`SELECT pg_try_advisory_lock(${keyOf(l)}::bigint)`)).catch((err) => console.error("test-run lock keep-alive failed:", err));
  }, KEEPALIVE_MS);
  timer.unref();

  return {
    async release() {
      clearInterval(timer);
      try {
        await client.$executeRaw`SELECT pg_advisory_unlock_all()`;
      } finally {
        await client.$disconnect();
      }
    },
  };
}
