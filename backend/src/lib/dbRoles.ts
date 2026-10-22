// Database roles (Phase 1.5, commit A): who may do what to the data.
//
//   the MIGRATE role  = the database's master user. Only the one-off migrate task connects as it. It owns every table, so it alone can change
//                       the schema, and it is never given to the api, worker or scheduler.
//   the APP role      = what api, worker and scheduler connect as. It reads and writes the data and nothing else: it cannot create or drop
//                       anything, and it has no UPDATE, DELETE or TRUNCATE on any append-only table (audit_logs, security_events, raw_punches...).
//
// That is a second layer under the append-only triggers: a stolen app credential, or a bug, still cannot rewrite an audit row, because the
// database refuses before the trigger would even run. ensureDatabaseRoles runs at the end of every migrate task and is idempotent; it works
// the list of append-only tables out from the triggers themselves, so a table a later migration makes append-only is covered on its first deploy.

export type SqlClient = {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<unknown>;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
};

const IDENT = /^[a-z_][a-z0-9_]*$/;

function ident(name: string): string {
  if (!IDENT.test(name)) throw new Error(`"${name}" is not a safe database identifier (lowercase letters, digits and _).`);
  return `"${name}"`;
}

/** Tables the app role must be able to read and add to but never change: ones guarded by a TRUNCATE-blocking trigger, plus the two the spec names. */
export const REQUIRED_APPEND_ONLY_TABLES = ["audit_logs", "security_events"] as const;

/**
 * Tables with a truncate-blocking trigger whose rows legitimately change state, so the app role keeps UPDATE (never DELETE or TRUNCATE). The row's own
 * trigger is what limits WHICH changes are legal. Keep this list to the minimum: today payroll approvals (PENDING -> APPROVED -> CONSUMED) and bank batches (GENERATED -> PAID, the bank response).
 */
export const UPDATABLE_APPEND_ONLY_TABLES: readonly string[] = ["payroll_approvals", "bank_transfer_batches"];

export async function appendOnlyTables(db: SqlClient): Promise<string[]> {
  const rows = await db.$queryRawUnsafe<Array<{ relname: string }>>(
    `SELECT DISTINCT c.relname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE NOT t.tgisinternal AND n.nspname = 'public' AND (t.tgtype & 32) = 32 ORDER BY 1`,
  );
  const found = rows.map((r) => r.relname);
  const missing = REQUIRED_APPEND_ONLY_TABLES.filter((t) => !found.includes(t));
  if (missing.length > 0) throw new Error(`Expected append-only triggers on ${missing.join(", ")} and found none: refusing to grant the app role access.`);
  return found;
}

export async function ensureDatabaseRoles(db: SqlClient, opts: { appRole: string; appPassword: string; databaseName: string }): Promise<{ appendOnly: string[] }> {
  if (opts.appPassword.length < 24) throw new Error("DB_APP_PASSWORD must be at least 24 characters.");
  const role = ident(opts.appRole);
  const database = ident(opts.databaseName);
  const password = (await db.$queryRawUnsafe<Array<{ q: string }>>("SELECT quote_literal($1::text) AS q", opts.appPassword))[0]?.q;
  if (!password) throw new Error("could not quote the app role password");

  await db.$executeRawUnsafe(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${opts.appRole}') THEN CREATE ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION; END IF; END $$`);
  // Only the password and login are altered: on RDS the master user is not a true superuser, and PostgreSQL 16 refuses it any statement that names the
  // SUPERUSER, REPLICATION or BYPASSRLS attributes. A role CREATEd with those off cannot have gained them without somebody granting them.
  await db.$executeRawUnsafe(`ALTER ROLE ${role} WITH LOGIN PASSWORD ${password}`);
  await db.$executeRawUnsafe(`GRANT CONNECT ON DATABASE ${database} TO ${role}`);
  await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
  await db.$executeRawUnsafe(`REVOKE CREATE ON SCHEMA public FROM ${role}`);
  await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${role}`);
  await db.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${role}`);
  // Tables and sequences a later migration creates (as this same user) are covered the moment they exist...
  await db.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${role}`);
  await db.$executeRawUnsafe(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${role}`);
  // ...and the append-only ones lose their write privileges again at the end of that same migrate task.
  const appendOnly = await appendOnlyTables(db);
  for (const table of appendOnly) {
    const keepsUpdate = UPDATABLE_APPEND_ONLY_TABLES.includes(table);
    await db.$executeRawUnsafe(`REVOKE ${keepsUpdate ? "" : "UPDATE, "}DELETE, TRUNCATE ON ${ident(table)} FROM ${role}`);
  }
  await db.$executeRawUnsafe(`REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "_prisma_migrations" FROM ${role}`); // readable (admin:preflight), never writable
  return { appendOnly };
}

/** What is wrong with the role this connection runs as, for an app task to refuse to start on. Empty means it is least-privilege. */
export async function leastPrivilegeProblems(db: SqlClient): Promise<string[]> {
  const [me] = await db.$queryRawUnsafe<Array<{ user: string; super: boolean; createrole: boolean; createdb: boolean; schema_create: boolean }>>(
    `SELECT current_user AS user, r.rolsuper AS super, r.rolcreaterole AS createrole, r.rolcreatedb AS createdb,
            has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create
     FROM pg_roles r WHERE r.rolname = current_user`,
  );
  const problems: string[] = [];
  if (!me) return ["cannot read this connection's own role"];
  if (me.super) problems.push(`database role "${me.user}" is a superuser`);
  if (me.createrole) problems.push(`database role "${me.user}" can create roles`);
  if (me.createdb) problems.push(`database role "${me.user}" can create databases`);
  if (me.schema_create) problems.push(`database role "${me.user}" can create objects in the schema (it owns or can change the schema: this is the migrate role)`);
  for (const table of REQUIRED_APPEND_ONLY_TABLES) {
    const [p] = await db.$queryRawUnsafe<Array<{ upd: boolean; del: boolean; trunc: boolean }>>(
      `SELECT has_table_privilege(current_user, $1, 'UPDATE') AS upd, has_table_privilege(current_user, $1, 'DELETE') AS del, has_table_privilege(current_user, $1, 'TRUNCATE') AS trunc`,
      table,
    );
    if (p?.upd || p?.del || p?.trunc) problems.push(`database role "${me.user}" can ${[p.upd && "UPDATE", p.del && "DELETE", p.trunc && "TRUNCATE"].filter(Boolean).join("/")} ${table}`);
  }
  return problems;
}

/** Outside development the api, worker and scheduler refuse to run as a role that could rewrite the audit trail. */
export async function assertLeastPrivilegedDatabaseRole(db: SqlClient, appEnv: string): Promise<void> {
  if (appEnv === "development") return;
  const problems = await leastPrivilegeProblems(db);
  if (problems.length > 0) {
    throw new Error(`REFUSING TO START: the app's database connection is not least-privilege:\n${problems.map((p) => `  - ${p}`).join("\n")}\nThe app must connect as the app role created by the migrate task (docs/DEPLOYMENT.md, "Database roles").`);
  }
}
