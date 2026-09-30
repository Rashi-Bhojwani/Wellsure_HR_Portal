import { describe, expect, it } from "vitest";
import { databaseGuardError, isLocalDatabaseUrl, maskDatabaseUrl } from "../databaseGuard";

describe("development database guard", () => {
  it.each([
    "postgresql://wellsure:wellsure@localhost:5432/wellsure_hr",
    "postgresql://wellsure:wellsure@127.0.0.1:5432/wellsure_hr",
    "postgresql://wellsure:wellsure@[::1]:5432/wellsure_hr",
    "postgresql://wellsure:wellsure@localhost/wellsure_hr?host=/var/run/postgresql",
  ])("treats %s as local", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(true);
  });

  it.each([
    "postgresql://u:p@database-3.abc.ap-south-1.rds.amazonaws.com:5432/db",
    "postgresql://u:p@10.0.0.5:5432/db",
    "postgresql://u:p@localhost.evil.example:5432/db",
    "postgresql://u:p@localhost:5432/db?host=db.example.com",
    "not a url",
  ])("treats %s as NOT local", (url) => {
    expect(isLocalDatabaseUrl(url)).toBe(false);
  });

  it("refuses a remote database in development and says the shell overrode .env", () => {
    const message = databaseGuardError({
      appEnv: "development",
      databaseUrl: "postgresql://scheduling:secret@database-3.abc.rds.amazonaws.com:5432/db",
      cameFromShell: true,
    });
    expect(message).toContain("REFUSING TO START");
    expect(message).toContain("shell environment");
    expect(message).toContain("unset DATABASE_URL");
    expect(message).not.toContain("secret");
  });

  it("allows a local database in development, and any database outside development", () => {
    expect(databaseGuardError({ appEnv: "development", databaseUrl: "postgresql://u:p@localhost/db", cameFromShell: false })).toBeNull();
    expect(databaseGuardError({ appEnv: "staging", databaseUrl: "postgresql://u:p@rds.amazonaws.com/db", cameFromShell: true })).toBeNull();
    expect(databaseGuardError({ appEnv: "production", databaseUrl: "postgresql://u:p@rds.amazonaws.com/db", cameFromShell: false })).toBeNull();
  });

  it("never prints the password", () => {
    expect(maskDatabaseUrl("postgresql://user:hunter2@host:5432/db")).toBe("postgresql://user:****@host:5432/db");
  });
});
