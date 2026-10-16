import { z } from "zod";

// The "refuse to start outside development" guard (Phase 1.5, commit A).
//
// Every secret that has a development default is declared with devSecret() instead of a bare
// z.string().default(...). That one call is what puts the variable under the guard, so a secret added
// next year is covered the moment it is written the normal way, with nobody having to remember a list.
// A test (config/__tests__/productionGuard.test.ts) scans the real env schema and fails if a variable
// that looks like a secret has a default and was not declared this way.
//
// In staging and production, productionConfigErrors() returns one line per problem and env.ts refuses
// to boot if there are any. The messages name the variable and the rule, never its value.

export type SecretSpec = { name: string; defaultValue: string; minLength: number };

export const SECRET_REGISTRY: SecretSpec[] = [];

/** Long enough that guessing is not a plan (32 characters of random base64 is about 190 bits). */
export const MIN_SECRET_LENGTH = 32;

/** A secret with a development default. Declaring it here is what makes staging/production refuse the default. */
export function devSecret(name: string, defaultValue: string, opts: { minLength?: number } = {}) {
  SECRET_REGISTRY.push({ name, defaultValue, minLength: opts.minLength ?? MIN_SECRET_LENGTH });
  return z.string().min(1).default(defaultValue);
}

/** Values that were obviously never replaced, whatever the variable: the words people paste in as a stand-in. */
const PLACEHOLDER = /^(change-?me|dev-?local|example|placeholder|replace-?me|todo|secret|password|test)/i;

/** Names that look like secrets; used by the schema scan in the test, not by the guard itself. */
export const SECRET_LOOKING_NAME = /(SECRET|PEPPER|PASSWORD|TOKEN|PRIVATE|API_KEY|KEYRING)/i;

export type GuardedConfig = {
  APP_ENV: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  WEB_BASE_URL: string;
  API_BASE_URL: string;
  CORS_ORIGIN: string;
  STORAGE_DRIVER: string;
  S3_BUCKET?: string | undefined;
  MAIL_DRIVER: string;
  SES_FROM?: string | undefined;
  SECURITY_ALERT_EMAIL?: string | undefined;
  FIELD_ENCRYPTION_DRIVER: string;
  KMS_FIELD_KEY_ID: string;
  METRICS_DRIVER: string;
  [key: string]: unknown;
};

const isLocalHost = (host: string): boolean => /^(localhost|127\.0\.0\.1|\[?::1\]?)$/i.test(host);

function tryUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function productionConfigErrors(cfg: GuardedConfig, registry: ReadonlyArray<SecretSpec> = SECRET_REGISTRY): string[] {
  if (cfg.APP_ENV === "development") return [];
  const errors: string[] = [];

  // 1. Secrets: never a default, never a stand-in, never short, never shared with another secret.
  const seen = new Map<string, string>();
  for (const s of registry) {
    const value = String(cfg[s.name] ?? "");
    if (value === s.defaultValue) errors.push(`${s.name} is still its development default. Set a real value.`);
    else if (PLACEHOLDER.test(value)) errors.push(`${s.name} looks like a placeholder, not a real secret.`);
    else if (value.length < s.minLength) errors.push(`${s.name} is too short (${value.length} characters; at least ${s.minLength} required).`);
    const other = seen.get(value);
    if (other && value !== "") errors.push(`${s.name} and ${other} must be different secrets.`);
    seen.set(value, s.name);
  }

  // 2. Drivers: staging/production never use the local stand-ins.
  const need = (ok: boolean, message: string): void => {
    if (!ok) errors.push(message);
  };
  need(cfg.STORAGE_DRIVER === "s3", `STORAGE_DRIVER must be "s3" in ${cfg.APP_ENV} (the local filesystem is for development only).`);
  need(Boolean(cfg.S3_BUCKET), "S3_BUCKET is required.");
  need(cfg.MAIL_DRIVER === "ses", `MAIL_DRIVER must be "ses" in ${cfg.APP_ENV} (console mail is for development only).`);
  need(Boolean(cfg.SES_FROM), "SES_FROM is required.");
  need(Boolean(cfg.SECURITY_ALERT_EMAIL), "SECURITY_ALERT_EMAIL is required: an inbox outside this system that every break-glass alert also reaches.");
  need(cfg.FIELD_ENCRYPTION_DRIVER === "kms", `FIELD_ENCRYPTION_DRIVER must be "kms" in ${cfg.APP_ENV} (the local static key is for development only).`);
  if (cfg.FIELD_ENCRYPTION_DRIVER === "kms") {
    const id = cfg.KMS_FIELD_KEY_ID;
    need(/^(arn:aws[a-z-]*:kms:|alias\/|[0-9a-f]{8}-[0-9a-f]{4}-)/.test(id), "KMS_FIELD_KEY_ID must be a KMS key ARN, alias or key id.");
  }
  need(cfg.METRICS_DRIVER === "cloudwatch", `METRICS_DRIVER must be "cloudwatch" in ${cfg.APP_ENV}: the alarms read those metrics.`);

  // 3. Connections: encrypted in transit, and nothing that points at a developer's machine.
  const db = tryUrl(cfg.DATABASE_URL);
  const sslmode = db?.searchParams.get("sslmode") ?? "";
  need(["require", "verify-ca", "verify-full"].includes(sslmode), "DATABASE_URL must carry sslmode=require (or stricter): the database connection is encrypted.");
  need(db !== null && !isLocalHost(db.hostname), "DATABASE_URL points at this machine.");
  const redisUrl = tryUrl(cfg.REDIS_URL);
  need(redisUrl?.protocol === "rediss:", "REDIS_URL must use rediss:// (TLS).");
  need(Boolean(redisUrl?.password), "REDIS_URL must carry the Redis auth token.");
  for (const name of ["WEB_BASE_URL", "API_BASE_URL"] as const) {
    const u = tryUrl(cfg[name]);
    need(u?.protocol === "https:" && !isLocalHost(u.hostname), `${name} must be an https address that is not localhost.`);
  }
  const origins = cfg.CORS_ORIGIN.split(",").map((o) => o.trim());
  need(
    origins.every((o) => {
      const u = tryUrl(o);
      return u?.protocol === "https:" && !isLocalHost(u.hostname);
    }),
    "CORS_ORIGIN must list only https origins that are not localhost.",
  );

  return errors;
}

/** The refusal printed at boot. */
export function productionGuardMessage(appEnv: string, errors: string[]): string {
  return [
    "",
    `REFUSING TO START: APP_ENV is "${appEnv}" and the configuration is not safe for it:`,
    ...errors.map((e) => `  - ${e}`),
    "Staging and production never run on development defaults (docs/DEPLOYMENT.md, 'What the app refuses to start without').",
    "",
  ].join("\n");
}
