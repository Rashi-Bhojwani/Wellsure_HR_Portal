import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { REQUIRED_APPEND_ONLY_TABLES, UPDATABLE_APPEND_ONLY_TABLES, appendOnlyTables, assertLeastPrivilegedDatabaseRole, ensureDatabaseRoles, leastPrivilegeProblems } from "../dbRoles";
import { prisma } from "../prisma";

// The privilege layer under the append-only triggers. Roles are cluster-wide, so each run makes its own and drops it again.
// Needs a database user that can create roles (CI's is a superuser; locally: ALTER ROLE wellsure CREATEROLE, see docs/GETTING_STARTED.md).

const suffix = randomBytes(4).toString("hex");
const APP_ROLE = `wt_app_${suffix}`;
const PROBE_TABLE = `zz_roles_probe_${suffix}`;
const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
let password = randomBytes(18).toString("hex");
let app: PrismaClient;

const urlAs = (user: string, pw: string): string => {
  const u = new URL(env.DATABASE_URL);
  u.username = user;
  u.password = pw;
  return u.toString();
};
const connectAs = (pw: string): PrismaClient => new PrismaClient({ datasources: { db: { url: urlAs(APP_ROLE, pw) } } });

// The error the DATABASE raises for a missing privilege, as opposed to the trigger's own message.
async function denied(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
  return "NOT DENIED";
}

beforeAll(async () => {
  const [me] = await prisma.$queryRaw<Array<{ ok: boolean }>>`SELECT (rolsuper OR rolcreaterole) AS ok FROM pg_roles WHERE rolname = current_user`;
  if (!me?.ok) throw new Error("This test creates database roles: connect as a user with CREATEROLE (locally: psql -U postgres -c 'ALTER ROLE wellsure CREATEROLE').");
  await ensureDatabaseRoles(prisma, { appRole: APP_ROLE, appPassword: password, databaseName });
  app = connectAs(password);
});

afterAll(async () => {
  await app?.$disconnect();
  await prisma.$executeRawUnsafe(`DROP TABLE IF EXISTS "${PROBE_TABLE}"`);
  await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "${APP_ROLE}"`);
  // Not DROP OWNED BY: the role owns nothing, and a CREATEROLE user that is not a superuser may not run it on a role it cannot SET to.
  await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${databaseName}" FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${APP_ROLE}"`);
});

describe("the app role", () => {
  it("can do the app's ordinary work", async () => {
    const row = await app.auditLog.create({ data: { action: "test.db_roles", entityType: "Test", entityId: suffix } });
    expect(row.id).toBeTruthy();
    expect(await app.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
    expect(await app.department.count()).toBeGreaterThanOrEqual(0);
    await app.securityEvent.count();
  });

  it("cannot update, delete or truncate an audit row: the database refuses before the trigger runs", async () => {
    const row = await prisma.auditLog.findFirstOrThrow({ where: { action: "test.db_roles", entityId: suffix } });
    for (const table of REQUIRED_APPEND_ONLY_TABLES) {
      const update = await denied(app.$executeRawUnsafe(`UPDATE "${table}" SET id = id WHERE id = '${row.id}'`));
      const del = await denied(app.$executeRawUnsafe(`DELETE FROM "${table}" WHERE id = '${row.id}'`));
      const truncate = await denied(app.$executeRawUnsafe(`TRUNCATE "${table}"`));
      for (const message of [update, del, truncate]) {
        expect(message, table).toMatch(/permission denied for table/);
        expect(message, table).not.toMatch(/append-only/); // that is the trigger's wording: we want the privilege layer
      }
    }
    expect(await prisma.auditLog.findUnique({ where: { id: row.id } })).not.toBeNull();
  });

  it("is refused on every table that has a truncate-blocking trigger, not just the two named ones", async () => {
    const tables = await appendOnlyTables(prisma);
    expect(tables).toEqual(expect.arrayContaining(["audit_logs", "security_events", "raw_punches", "manual_attendance_entries", "attendance_overrides", "shift_overrides", "leave_day_releases", "attendance_period_locks"]));
    for (const t of tables) expect(await denied(app.$executeRawUnsafe(`DELETE FROM "${t}" WHERE false`)), t).toMatch(/permission denied/);
  });

  it("keeps UPDATE (and only UPDATE) on the one append-only table whose rows change state: payroll approvals", async () => {
    expect(UPDATABLE_APPEND_ONLY_TABLES).toEqual(["payroll_approvals"]);
    expect(await appendOnlyTables(prisma)).toContain("payroll_approvals");
    const priv = async (table: string) =>
      (await app.$queryRawUnsafe<Array<{ upd: boolean; del: boolean; trunc: boolean; ins: boolean }>>(
        `SELECT has_table_privilege(current_user, $1, 'UPDATE') AS upd, has_table_privilege(current_user, $1, 'DELETE') AS del,
                has_table_privilege(current_user, $1, 'TRUNCATE') AS trunc, has_table_privilege(current_user, $1, 'INSERT') AS ins`,
        table,
      ))[0];
    expect(await priv("payroll_approvals")).toEqual({ upd: true, del: false, trunc: false, ins: true });
    expect(await priv("audit_logs")).toEqual({ upd: false, del: false, trunc: false, ins: true });
    expect(await priv("payroll_item_versions")).toEqual({ upd: false, del: false, trunc: false, ins: true });
    expect(await denied(app.$executeRawUnsafe(`DELETE FROM payroll_approvals WHERE false`))).toMatch(/permission denied/);
  });

  it("cannot change the schema or the migration history", async () => {
    expect(await denied(app.$executeRawUnsafe(`CREATE TABLE zz_nope_${suffix} (id int)`))).toMatch(/permission denied/);
    expect(await denied(app.$executeRawUnsafe(`DROP TABLE departments`))).toMatch(/must be owner|permission denied/);
    expect(await denied(app.$executeRawUnsafe(`DELETE FROM "_prisma_migrations"`))).toMatch(/permission denied/);
    expect(await denied(app.$executeRawUnsafe(`CREATE ROLE zz_nope_${suffix}`))).toMatch(/permission denied/);
    expect(await app.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "_prisma_migrations"`)).toBeTruthy(); // readable (admin:preflight)
  });

  it("passes the start-up check, and the migrate role does not", async () => {
    expect(await leastPrivilegeProblems(app)).toEqual([]);
    await expect(assertLeastPrivilegedDatabaseRole(app, "staging")).resolves.toBeUndefined();
    const owner = await leastPrivilegeProblems(prisma);
    expect(owner.join("\n")).toMatch(/can UPDATE\/DELETE\/TRUNCATE audit_logs|can create objects in the schema/);
    await expect(assertLeastPrivilegedDatabaseRole(prisma, "production")).rejects.toThrow(/REFUSING TO START/);
    await expect(assertLeastPrivilegedDatabaseRole(prisma, "development")).resolves.toBeUndefined(); // development runs as one role by design
  });
});

describe("ensureDatabaseRoles", () => {
  it("is idempotent, and a new password takes effect while the old one stops working", async () => {
    const next = randomBytes(18).toString("hex");
    await ensureDatabaseRoles(prisma, { appRole: APP_ROLE, appPassword: next, databaseName });
    await ensureDatabaseRoles(prisma, { appRole: APP_ROLE, appPassword: next, databaseName });
    const fresh = connectAs(next);
    await expect(fresh.department.count()).resolves.toBeGreaterThanOrEqual(0);
    await fresh.$disconnect();
    const stale = connectAs(password);
    await expect(stale.department.count()).rejects.toThrow();
    await stale.$disconnect();
    password = next;
  });

  it("covers a table a LATER migration adds, and takes writes away again when that table is made append-only", async () => {
    await prisma.$executeRawUnsafe(`CREATE TABLE "${PROBE_TABLE}" (id serial PRIMARY KEY, note text)`);
    await app.$executeRawUnsafe(`INSERT INTO "${PROBE_TABLE}" (note) VALUES ('a')`); // default privileges: usable at once
    await app.$executeRawUnsafe(`UPDATE "${PROBE_TABLE}" SET note = 'b'`);
    // The next migration makes it append-only (same pattern as every append-only table here).
    await prisma.$executeRawUnsafe(`CREATE FUNCTION "${PROBE_TABLE}_fn"() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "${PROBE_TABLE}_trunc" BEFORE TRUNCATE ON "${PROBE_TABLE}" FOR EACH STATEMENT EXECUTE FUNCTION "${PROBE_TABLE}_fn"()`);
    const run = await ensureDatabaseRoles(prisma, { appRole: APP_ROLE, appPassword: password, databaseName });
    expect(run.appendOnly).toContain(PROBE_TABLE);
    expect(await denied(app.$executeRawUnsafe(`UPDATE "${PROBE_TABLE}" SET note = 'c'`))).toMatch(/permission denied/);
    await app.$executeRawUnsafe(`INSERT INTO "${PROBE_TABLE}" (note) VALUES ('d')`); // still can add
    await prisma.$executeRawUnsafe(`DROP TABLE "${PROBE_TABLE}"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${PROBE_TABLE}_fn"()`);
  });

  it("refuses unsafe names and a short password, and never grants when the append-only triggers are missing", async () => {
    await expect(ensureDatabaseRoles(prisma, { appRole: 'x"; drop table users; --', appPassword: password, databaseName })).rejects.toThrow(/safe database identifier/);
    await expect(ensureDatabaseRoles(prisma, { appRole: APP_ROLE, appPassword: "short", databaseName })).rejects.toThrow(/at least 24/);
    const fake = { $executeRawUnsafe: async () => 0, $queryRawUnsafe: async (sql: string) => (sql.includes("quote_literal") ? [{ q: "'x'" }] : []) };
    await expect(ensureDatabaseRoles(fake as never, { appRole: APP_ROLE, appPassword: password, databaseName })).rejects.toThrow(/Expected append-only triggers/);
  });
});
