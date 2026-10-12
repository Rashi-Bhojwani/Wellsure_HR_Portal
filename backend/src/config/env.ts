import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { databaseGuardError } from "./databaseGuard";

// Explicit, import-order-independent .env loading — must happen before the
// safeParse below. This used to work by accident (Prisma Client's own
// internal .env loading, triggered only when something imported
// @prisma/client before this module evaluated), which silently broke any
// entrypoint that imports env.ts first, including scripts/reset-db.ts and
// this file's own primary consumer, src/index.ts. staging/production have
// no .env file (env vars are injected via ECS task env / Secrets Manager
// instead, per docs/PROJECT_SPEC.md §15.3), so this is a no-op there.
const envFilePath = path.resolve(import.meta.dirname, "../../.env");
// Captured before .env loads, so the database guard below can say whether
// a bad DATABASE_URL came from the shell (overriding .env) or from .env.
const databaseUrlFromShell = process.env.DATABASE_URL !== undefined;
if (existsSync(envFilePath)) {
  process.loadEnvFile(envFilePath);
}

// Loads and validates every env var the backend currently reads, failing
// fast at boot if anything is missing or malformed. Extend this schema
// whenever a new env var is introduced — see .env.example at the repo
// root for the full list and docs/PROJECT_SPEC.md §15.3.
const envSchema = z.object({
  APP_ENV: z.enum(["development", "staging", "production"]).default("development"),
  APP_MODE: z.enum(["api", "worker", "scheduler", "migrate"]).default("api"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_BASE_URL: z.url().default("http://localhost:5173"),
  API_BASE_URL: z.url().default("http://localhost:4000"),
  CORS_ORIGIN: z.string().default("http://localhost:5173"),
  // ADMS push is authenticated by the device serial number alone, so in production it stays off until /iclock is restricted to the office's address
  // (docs/DEPLOYMENT.md, "Phase 1.5 go-live checklist"). Setting this to "true" is the act of ticking that item. Unset: on, except in production.
  ADMS_PUSH_ENABLED: z.enum(["true", "false"]).optional(),
  TZ_BUSINESS: z.string().default("Asia/Kolkata"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  // Test isolation (see isolateTestRedis below): the logical Redis database
  // the test suite uses instead of REDIS_URL's own, and the Socket.IO pub/sub
  // channel prefix (pub/sub isn't per-database in Redis, so the database
  // number alone wouldn't separate them).
  REDIS_TEST_DB: z.coerce.number().int().min(1).max(15).default(15),
  // The Postgres database the test suite uses instead of DATABASE_URL's own
  // (see isolateTestDatabase below). Defaults to "<dev database>_test".
  TEST_DATABASE_NAME: z.string().regex(/^[a-z_][a-z0-9_]*$/, "lowercase letters, digits and _ only").optional(),
  SOCKET_IO_REDIS_KEY: z.string().min(1).default("socket.io"),

  // Auth (src/modules/auth): JWT access tokens are short-lived and
  // stateless; refresh tokens are opaque random strings tracked in
  // refresh_tokens (rotation + reuse detection), never JWTs themselves.
  JWT_ACCESS_SECRET: z.string().min(1).default("change-me-access-secret"),
  JWT_REFRESH_SECRET: z.string().min(1).default("change-me-refresh-secret"),
  JWT_ACCESS_TTL: z.string().default("15m"),
  JWT_REFRESH_TTL: z.string().default("30d"),

  // Field-level encryption (src/lib/encryption.ts) and blind-index hashing
  // (src/lib/fieldHash.ts) for bank account/PAN/Aadhaar/UAN — spec §9.
  // Local dev derives a static key/pepper from these strings; staging/
  // production swap in real KMS envelope encryption (spec §15.3) behind the
  // same encrypt/decrypt call shape. The two must never be equal — the
  // pepper is deliberately a separate secret from the encryption key so a
  // leaked blind-index pepper alone can't help decrypt anything.
  KMS_FIELD_KEY_ID: z.string().min(1).default("dev-local-key"),
  FIELD_HASH_PEPPER: z.string().min(1).default("dev-local-pepper"),

  // Storage — local filesystem for dev, S3 in staging/production
  // (see src/integrations/storage).
  STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default(".storage"),
  STORAGE_SIGNED_URL_SECRET: z.string().default("dev-local-signing-secret"),
  S3_BUCKET: z.string().optional(),

  // Mail — console/.eml for dev, SES in staging/production
  // (see src/integrations/mail).
  MAIL_DRIVER: z.enum(["console", "ses"]).default("console"),
  MAIL_DEV_DIR: z.string().default(".mail"),
  SES_FROM: z.string().optional(),
  // Optional (E1.1): an inbox OUTSIDE this system (e.g. the owners' shared
  // mailbox) that also receives every break-glass alert — the one copy a
  // compromised Super Admin account can't make disappear.
  SECURITY_ALERT_EMAIL: z.email().optional(),

  // AWS (staging/production only — used by the S3 and SES clients).
  AWS_REGION: z.string().default("ap-south-1"),
})
  .refine((v) => v.KMS_FIELD_KEY_ID !== v.FIELD_HASH_PEPPER, {
    message: "KMS_FIELD_KEY_ID and FIELD_HASH_PEPPER must be different secrets",
    path: ["FIELD_HASH_PEPPER"],
  })
  .refine((v) => v.JWT_ACCESS_SECRET !== v.JWT_REFRESH_SECRET, {
    message: "JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must be different secrets",
    path: ["JWT_REFRESH_SECRET"],
  });

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
    process.exit(1);
  }
  const guardError = databaseGuardError({
    appEnv: parsed.data.APP_ENV,
    databaseUrl: parsed.data.DATABASE_URL,
    cameFromShell: databaseUrlFromShell,
  });
  if (guardError) {
    console.error(guardError);
    process.exit(1);
  }
  return isTestRun() ? isolateTestServices(parsed.data) : parsed.data;
}

// True inside the test suite (vitest sets VITEST in every process it runs).
export function isTestRun(): boolean {
  return process.env.VITEST === "true" || process.env.VITEST === "1";
}

// A test run must never share Redis with a dev server on the same machine
// (or CI's): a running dev worker once consumed the test suite's queued
// letter jobs, and a dev API and the realtime tests could hear each other's
// Socket.IO broadcasts. So under vitest, whatever REDIS_URL says, the suite
// uses its own logical database (REDIS_TEST_DB, default 15) — separating
// every key: BullMQ queues, caches, rate limits — and its own Socket.IO
// channel prefix, separating pub/sub (which Redis doesn't scope by
// database). Refuses to start if REDIS_URL already points at the test
// database, since dev would then be sharing it.
export function isolateTestRedis(e: Env): Env {
  let url: URL;
  try {
    url = new URL(e.REDIS_URL);
  } catch {
    console.error(`REDIS_URL isn't a valid URL ("${e.REDIS_URL}"), so the test suite can't isolate its Redis database.`);
    process.exit(1);
  }
  const devDb = Number(url.pathname.replace("/", "") || "0");
  if (devDb === e.REDIS_TEST_DB) {
    console.error(`REDIS_URL uses Redis database ${devDb}, which is the test suite's (REDIS_TEST_DB). Point dev at another database or set REDIS_TEST_DB.`);
    process.exit(1);
  }
  url.pathname = `/${e.REDIS_TEST_DB}`;
  return { ...e, REDIS_URL: url.toString(), SOCKET_IO_REDIS_KEY: `${e.SOCKET_IO_REDIS_KEY}-test` };
}

// The same rule for Postgres: under vitest the suite uses its own database
// (TEST_DATABASE_NAME, default "<dev database>_test") on the same server,
// which vitest.globalSetup.ts drops, recreates, migrates and seeds at the
// start of every run — so a dev server left running, or someone clicking
// around the dev UI mid-run, can never touch the suite's rows (or vice
// versa). Refuses to start if DATABASE_URL already points at the test
// database, since dev would then be sharing it.
export function isolateTestDatabase(e: Env): Env {
  let url: URL;
  try {
    url = new URL(e.DATABASE_URL);
  } catch {
    console.error("DATABASE_URL isn't a valid URL, so the test suite can't isolate its Postgres database.");
    process.exit(1);
  }
  const devName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const testName = e.TEST_DATABASE_NAME ?? `${devName}_test`;
  if (!devName || devName === testName) {
    console.error(`DATABASE_URL uses the database "${devName}", which is the test suite's (TEST_DATABASE_NAME). Point dev at another database or set TEST_DATABASE_NAME.`);
    process.exit(1);
  }
  url.pathname = `/${testName}`;
  return { ...e, DATABASE_URL: url.toString() };
}

// Every service a test run could share with dev on the same machine:
// Redis, Postgres, and the local storage and mail folders (uploads, letter
// PDFs and .eml files land in .storage-test/ and .mail-test/ instead).
export function isolateTestServices(e: Env): Env {
  const isolated = isolateTestDatabase(isolateTestRedis(e));
  return { ...isolated, STORAGE_LOCAL_DIR: `${e.STORAGE_LOCAL_DIR.replace(/\/+$/, "")}-test`, MAIL_DEV_DIR: `${e.MAIL_DEV_DIR.replace(/\/+$/, "")}-test` };
}

export const env = loadEnv();
