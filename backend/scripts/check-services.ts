// Verifies the locally installed Postgres and Redis (see README.md "Local
// setup") are reachable, using the same DATABASE_URL/REDIS_URL the app
// itself reads. Run directly (`npm run check:services`) before `npm run
// dev` if you're not sure the services are up.
import { prisma } from "../src/lib/prisma";
import { redis } from "../src/lib/redis";
import { env } from "../src/config/env";

const SETUP_INSTRUCTIONS: Record<string, string> = {
  darwin: [
    "  brew install postgresql@16 redis",
    "  brew services start postgresql@16",
    "  brew services start redis",
  ].join("\n"),
  linux: [
    "  # Debian/Ubuntu",
    "  sudo apt install postgresql-16 redis-server",
    "  sudo service postgresql start      # or: sudo systemctl start postgresql",
    "  sudo service redis-server start    # or: sudo systemctl start redis-server",
  ].join("\n"),
  win32: [
    "  # PostgreSQL: install from https://www.postgresql.org/download/windows/",
    "  # Redis has no official Windows build — use WSL2 (sudo apt install",
    "  # redis-server, as in the Linux instructions above) or Memurai",
    "  # (https://www.memurai.com/), a Redis-compatible Windows service.",
  ].join("\n"),
};

function maskUrl(url: string): string {
  return url.replace(/:\/\/([^:/@]+):[^@]+@/, "://$1:****@");
}

async function checkPostgres(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  } finally {
    await prisma.$disconnect();
  }
}

async function checkRedis(): Promise<boolean> {
  try {
    await redis.connect();
    await redis.ping();
    return true;
  } catch {
    return false;
  } finally {
    redis.disconnect();
  }
}

async function main(): Promise<void> {
  const [pgOk, redisOk] = await Promise.all([checkPostgres(), checkRedis()]);

  console.log(`Postgres (${maskUrl(env.DATABASE_URL)}): ${pgOk ? "reachable" : "UNREACHABLE"}`);
  console.log(`Redis    (${env.REDIS_URL}): ${redisOk ? "reachable" : "UNREACHABLE"}`);

  if (pgOk && redisOk) {
    console.log("\nAll local services are reachable.");
    process.exit(0);
  }

  console.log("\nSee README.md 'Local setup' for full instructions. Quick start for your OS:\n");
  console.log(SETUP_INSTRUCTIONS[process.platform] ?? SETUP_INSTRUCTIONS.linux);
  console.log(
    "\nThen create the database/user matching DATABASE_URL in your .env " +
      "(see README.md) and re-run: npm run check:services",
  );
  process.exit(1);
}

void main();
