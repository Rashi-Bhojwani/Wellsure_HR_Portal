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
