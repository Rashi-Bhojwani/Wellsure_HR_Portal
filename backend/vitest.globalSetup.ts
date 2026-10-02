import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import path from "node:path";

// Runs once, before any test file.
//
// 1. Loads config/env, which validates the environment and applies the
//    development-database guard (src/config/databaseGuard.ts). The
//    integration suite writes and deletes real rows, so it must refuse
//    outright — with the guard's explanation — rather than let every test
//    file fail on its own or, worse, succeed against a database that isn't
//    on this machine.
// 2. Builds the suite's own services from scratch. Under vitest, config/env
//    points Postgres, Redis and the storage/mail folders at test-only
//    copies (isolateTestServices), so dev can keep running during a test
//    run with no interaction either way. Every run starts from the same
//    state: the test database is dropped, recreated, migrated and seeded;
//    the test Redis database is flushed; the test storage and mail folders
//    are emptied.
export default async function setup(): Promise<void> {
  const { env } = await import("./src/config/env");
  const started = Date.now();

  const testDbUrl = new URL(env.DATABASE_URL);
  const testDbName = decodeURIComponent(testDbUrl.pathname.slice(1));
  const adminUrl = new URL(env.DATABASE_URL);
  adminUrl.pathname = "/postgres";
  const { PrismaClient } = await import("@prisma/client");
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  try {
    const quoted = `"${testDbName.replace(/"/g, '""')}"`;
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quoted} WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE ${quoted}`);
  } finally {
    await admin.$disconnect();
  }

  const { default: Redis } = await import("ioredis");
  const redis = new Redis(env.REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await redis.connect();
    await redis.flushdb();
  } finally {
    redis.disconnect();
  }

  for (const dir of [env.STORAGE_LOCAL_DIR, env.MAIL_DEV_DIR]) rmSync(path.resolve(process.cwd(), dir), { recursive: true, force: true });

  // The migrate script and the seed run as child processes with the test
  // services spelled out and VITEST removed, so their own config/env load
  // uses exactly these values rather than re-deriving them.
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    SOCKET_IO_REDIS_KEY: env.SOCKET_IO_REDIS_KEY,
    STORAGE_LOCAL_DIR: env.STORAGE_LOCAL_DIR,
    MAIL_DEV_DIR: env.MAIL_DEV_DIR,
  };
  delete childEnv.VITEST;
  const run = (label: string, args: string[]) => {
    try {
      execFileSync("npx", args, { env: childEnv, stdio: "pipe", encoding: "utf8" });
    } catch (err) {
      const e = err as { stdout?: string; stderr?: string };
      console.error(`Test database setup failed while running ${label}:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
      throw err;
    }
  };
  run("migrations", ["tsx", "scripts/migrate.ts"]);
  run("the seed", ["prisma", "db", "seed"]);

  console.log(`Test services ready in ${((Date.now() - started) / 1000).toFixed(1)} s — Postgres "${testDbName}", Redis db ${new URL(env.REDIS_URL).pathname.slice(1)}, ${env.STORAGE_LOCAL_DIR}/, ${env.MAIL_DEV_DIR}/`);
}
