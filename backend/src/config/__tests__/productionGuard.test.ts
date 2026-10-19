import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "../env";
import { SECRET_LOOKING_NAME, SECRET_REGISTRY, productionConfigErrors, type GuardedConfig } from "../productionGuard";

const R = "x7Qm2Vb9Lk4Zp8Ws3Nc6Hd1Fg5Jt0RaYe"; // 34 characters, only ever used in these tests
const secret = (n: number): string => `${n}`.repeat(1) + R.slice(1);

// A configuration that is fine in staging. Each test breaks one thing.
function good(): GuardedConfig {
  const cfg: Record<string, unknown> = {
    APP_ENV: "staging",
    DATABASE_URL: "postgresql://wellsure_app:pw@db.abc.ap-south-1.rds.amazonaws.com:5432/wellsure?sslmode=require",
    REDIS_URL: "rediss://:token@cache.abc.cache.amazonaws.com:6379",
    WEB_BASE_URL: "https://hr-staging.example.org",
    API_BASE_URL: "https://api-staging.example.org",
    CORS_ORIGIN: "https://hr-staging.example.org",
    STORAGE_DRIVER: "s3",
    S3_BUCKET: "wellsure-staging",
    MAIL_DRIVER: "ses",
    SES_FROM: "no-reply@example.org",
    SECURITY_ALERT_EMAIL: "owners@example.org",
    FIELD_ENCRYPTION_DRIVER: "kms",
    METRICS_DRIVER: "cloudwatch",
    KMS_FIELD_KEY_ID: "arn:aws:kms:ap-south-1:111111111111:key/abc",
  };
  SECRET_REGISTRY.forEach((s, i) => {
    if (s.name !== "KMS_FIELD_KEY_ID") cfg[s.name] = secret(i + 1);
  });
  return cfg as GuardedConfig;
}

describe("production config guard", () => {
  it("accepts a complete staging configuration, and says nothing in development", () => {
    expect(productionConfigErrors(good()), "good() fixture").toEqual([]);
    expect(productionConfigErrors({ ...good(), APP_ENV: "production" })).toEqual([]);
    // Development runs on the defaults by design.
    const dev = { APP_ENV: "development", STORAGE_DRIVER: "local", MAIL_DRIVER: "console" } as unknown as GuardedConfig;
    for (const s of SECRET_REGISTRY) (dev as Record<string, unknown>)[s.name] = s.defaultValue;
    expect(productionConfigErrors(dev)).toEqual([]);
  });

  it("refuses EVERY registered secret left at its development default, without naming a list", () => {
    expect(SECRET_REGISTRY.length).toBeGreaterThanOrEqual(5);
    for (const s of SECRET_REGISTRY) {
      for (const appEnv of ["staging", "production"]) {
        const errors = productionConfigErrors({ ...good(), APP_ENV: appEnv, [s.name]: s.defaultValue });
        expect(errors.join("\n"), `${s.name} in ${appEnv}`).toContain(`${s.name} is still its development default`);
      }
    }
  });

  it("covers a secret that does not exist yet: anything declared through devSecret() is guarded the same way", () => {
    const registry = [...SECRET_REGISTRY, { name: "FUTURE_WEBHOOK_SECRET", defaultValue: "dev-future-webhook", minLength: 32 }];
    const cfg = { ...good(), FUTURE_WEBHOOK_SECRET: "dev-future-webhook" };
    expect(productionConfigErrors(cfg, registry).join("\n")).toContain("FUTURE_WEBHOOK_SECRET is still its development default");
    expect(productionConfigErrors({ ...cfg, FUTURE_WEBHOOK_SECRET: "short" }, registry).join("\n")).toContain("FUTURE_WEBHOOK_SECRET is too short");
  });

  it("refuses short secrets, stand-ins, and two secrets with the same value; never prints a value", () => {
    const short = productionConfigErrors({ ...good(), JWT_ACCESS_SECRET: "tooshort-but-unique" }).join("\n");
    expect(short).toContain("JWT_ACCESS_SECRET is too short");
    expect(short).not.toContain("tooshort-but-unique");
    const standIn = productionConfigErrors({ ...good(), JWT_ACCESS_SECRET: "change-me-but-made-long-enough-to-pass-length" }).join("\n");
    expect(standIn).toContain("JWT_ACCESS_SECRET looks like a placeholder");
    const same = productionConfigErrors({ ...good(), JWT_REFRESH_SECRET: good().JWT_ACCESS_SECRET }).join("\n");
    expect(same).toContain("must be different secrets");
  });

  it.each([
    ["STORAGE_DRIVER", "local", 'STORAGE_DRIVER must be "s3"'],
    ["MAIL_DRIVER", "console", 'MAIL_DRIVER must be "ses"'],
    ["MAIL_DRIVER", "smtp", 'MAIL_DRIVER must be "ses"'],
    ["FIELD_ENCRYPTION_DRIVER", "local", 'FIELD_ENCRYPTION_DRIVER must be "kms"'],
    ["METRICS_DRIVER", "local", 'METRICS_DRIVER must be "cloudwatch"'],
    ["S3_BUCKET", undefined, "S3_BUCKET is required"],
    ["SES_FROM", undefined, "SES_FROM is required"],
    ["SECURITY_ALERT_EMAIL", undefined, "SECURITY_ALERT_EMAIL is required"],
    ["KMS_FIELD_KEY_ID", "some-random-string", "must be a KMS key ARN"],
    ["DATABASE_URL", "postgresql://u:p@db.example.org:5432/x", "sslmode=require"],
    ["DATABASE_URL", "postgresql://u:p@localhost:5432/x?sslmode=require", "points at this machine"],
    ["REDIS_URL", "redis://:token@cache.example.org:6379", "rediss://"],
    ["REDIS_URL", "rediss://cache.example.org:6379", "auth token"],
    ["WEB_BASE_URL", "http://localhost:5173", "WEB_BASE_URL must be an https address"],
    ["API_BASE_URL", "http://api.example.org", "API_BASE_URL must be an https address"],
    ["CORS_ORIGIN", "https://hr.example.org,http://localhost:5173", "CORS_ORIGIN must list only https"],
  ])("refuses %s = %s", (name, value, expected) => {
    const errors = productionConfigErrors({ ...good(), [name]: value }).join("\n");
    expect(errors).toContain(expected);
  });
});

describe("the real env schema", () => {
  it("has no secret-looking variable with a default that escaped the guard", () => {
    // Parse with only the required variables: whatever else comes back has a default.
    const defaults = envSchema.parse({ DATABASE_URL: "postgresql://localhost/x", REDIS_URL: "redis://localhost:6379" }) as Record<string, unknown>;
    const guarded = new Set(SECRET_REGISTRY.map((s) => s.name));
    const escaped = Object.keys(defaults).filter((k) => SECRET_LOOKING_NAME.test(k) && defaults[k] !== undefined && !guarded.has(k));
    expect(escaped, "declare these with devSecret() in config/env.ts").toEqual([]);
    // And the five secrets the plan named are in the registry.
    for (const name of ["JWT_ACCESS_SECRET", "JWT_REFRESH_SECRET", "KMS_FIELD_KEY_ID", "FIELD_HASH_PEPPER", "STORAGE_SIGNED_URL_SECRET"]) expect(guarded.has(name)).toBe(true);
  });
});

describe("boot", () => {
  const backendDir = path.resolve(import.meta.dirname, "../../..");
  const boot = (env: Record<string, string>) => {
    // A clean environment but PATH: no VITEST (so no test isolation), and backend/.env, if any, fills in the rest, as it would on a laptop.
    return spawnSync(process.execPath, ["--import", "tsx", "-e", 'import("./src/config/env.ts").then(() => console.log("BOOTED"))'], {
      cwd: backendDir,
      env: { PATH: process.env.PATH ?? "", DATABASE_URL: "postgresql://wellsure:wellsure@localhost:5432/wellsure_hr", REDIS_URL: "redis://localhost:6379", ...env },
      encoding: "utf8",
      timeout: 60_000,
    });
  };

  it("a staging process on the development defaults exits 1 and says which settings are wrong", () => {
    const r = boot({ APP_ENV: "staging" });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("REFUSING TO START");
    expect(r.stderr).toContain("JWT_ACCESS_SECRET is still its development default");
    expect(r.stdout).not.toContain("BOOTED");
  });

  it("the same defaults are fine in development", () => {
    const r = boot({ APP_ENV: "development" });
    expect(r.stdout).toContain("BOOTED");
  });
});
