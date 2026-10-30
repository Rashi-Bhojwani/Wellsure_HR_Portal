import { randomBytes } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../../config/env";
import { appendOnlyTables, ensureDatabaseRoles } from "../../../lib/dbRoles";
import { prisma } from "../../../lib/prisma";

// The database-roles step for the asset register's append-only tables (same method as lib/__tests__/dbRoles.test.ts): the app role may add to the
// event log, setting versions and confirmations but never change or delete them, and may close or acknowledge an assignment (UPDATE, which its trigger
// narrows) but never delete one. Roles are cluster-wide, so the test makes its own and drops it again.

const suffix = randomBytes(4).toString("hex");
const APP_ROLE = `wt_assets_${suffix}`;
const databaseName = decodeURIComponent(new URL(env.DATABASE_URL).pathname.slice(1));
const password = randomBytes(18).toString("hex");
let app: PrismaClient;

const urlAs = (user: string, pw: string): string => {
  const u = new URL(env.DATABASE_URL);
  u.username = user;
  u.password = pw;
  return u.toString();
};

beforeAll(async () => {
  await ensureDatabaseRoles(prisma, { appRole: APP_ROLE, appPassword: password, databaseName });
  app = new PrismaClient({ datasources: { db: { url: urlAs(APP_ROLE, password) } } });
});

afterAll(async () => {
  await app?.$disconnect();
  await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL TABLES IN SCHEMA public FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON SCHEMA public FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`REVOKE ALL ON DATABASE "${databaseName}" FROM "${APP_ROLE}"`);
  await prisma.$executeRawUnsafe(`DROP ROLE IF EXISTS "${APP_ROLE}"`);
});

describe("asset tables under the app role", () => {
  const priv = async (table: string) =>
    (await app.$queryRawUnsafe<Array<{ upd: boolean; del: boolean; trunc: boolean; ins: boolean }>>(
      `SELECT has_table_privilege(current_user, $1, 'UPDATE') AS upd, has_table_privilege(current_user, $1, 'DELETE') AS del,
              has_table_privilege(current_user, $1, 'TRUNCATE') AS trunc, has_table_privilege(current_user, $1, 'INSERT') AS ins`,
      table,
    ))[0];

  it("the four append-only asset tables are found from their triggers", async () => {
    const found = await appendOnlyTables(prisma);
    for (const t of ["asset_events", "asset_setting_versions", "asset_setting_confirmations", "asset_assignments"]) expect(found, t).toContain(t);
  });

  it("event log, setting versions and confirmations: insert only", async () => {
    for (const t of ["asset_events", "asset_setting_versions", "asset_setting_confirmations"]) expect(await priv(t), t).toEqual({ upd: false, del: false, trunc: false, ins: true });
  });

  it("assignments: insert and (trigger-narrowed) update, never delete or truncate", async () => {
    expect(await priv("asset_assignments")).toEqual({ upd: true, del: false, trunc: false, ins: true });
  });

  it("the register itself is edited (name, status) but its rows are kept by a trigger, not by privileges", async () => {
    expect((await priv("assets"))?.upd).toBe(true);
  });
});
