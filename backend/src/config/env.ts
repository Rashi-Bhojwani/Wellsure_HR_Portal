import { z } from "zod";

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
  TZ_BUSINESS: z.string().default("Asia/Kolkata"),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

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

  // AWS (staging/production only — used by the S3 and SES clients).
  AWS_REGION: z.string().default("ap-south-1"),
}).refine((v) => v.KMS_FIELD_KEY_ID !== v.FIELD_HASH_PEPPER, {
  message: "KMS_FIELD_KEY_ID and FIELD_HASH_PEPPER must be different secrets",
  path: ["FIELD_HASH_PEPPER"],
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment configuration:", z.treeifyError(parsed.error));
    process.exit(1);
  }
  return parsed.data;
}

export const env = loadEnv();
