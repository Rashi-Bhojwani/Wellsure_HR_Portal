// In development, the backend (every APP_MODE), the seed/reset scripts and
// the test suite may only ever talk to a database on this machine.
//
// Why this exists: a cloud dev container once exported a DATABASE_URL for
// an unrelated remote RDS database. process.loadEnvFile() never overrides a
// variable already set in the shell, so backend/.env was silently ignored
// and `npm run db:seed` (which drops and recreates the database) and the
// integration suite (which writes and deletes rows) were aimed at it. Only
// a connection failure stopped it. A destructive command must never depend
// on a remote host happening to be unreachable, so this refuses up front.
//
// Staging/production are unaffected: they run with APP_ENV=staging|production
// against RDS by design.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return false;
  }
  // A `host` query parameter overrides the URL's hostname (Prisma's Unix
  // socket form is postgresql://user:pw@localhost/db?host=/var/run/postgresql).
  // A filesystem path there is a local socket; anything else must be local too.
  const hostParam = url.searchParams.get("host");
  if (hostParam) return hostParam.startsWith("/") || LOCAL_HOSTS.has(hostParam);
  return LOCAL_HOSTS.has(url.hostname);
}

export function maskDatabaseUrl(databaseUrl: string): string {
  try {
    const url = new URL(databaseUrl);
    if (url.password) url.password = "****";
    return url.toString();
  } catch {
    return "<unparseable URL>";
  }
}

// Returns the refusal message, or null when the configuration is safe.
export function databaseGuardError(opts: {
  appEnv: string;
  databaseUrl: string;
  cameFromShell: boolean;
}): string | null {
  if (opts.appEnv !== "development" || isLocalDatabaseUrl(opts.databaseUrl)) return null;
  const source = opts.cameFromShell
    ? "It is set in your shell environment, which takes precedence over backend/.env — backend/.env was NOT used."
    : "It comes from backend/.env.";
  return [
    "",
    "REFUSING TO START: APP_ENV is \"development\" but DATABASE_URL points at a non-local database:",
    `  ${maskDatabaseUrl(opts.databaseUrl)}`,
    source,
    "In development the backend, `npm run db:seed`, `npm run db:migrate` and the test suite may only use a",
    "database on this machine (localhost, 127.0.0.1, ::1 or a Unix socket) — seeding drops the database and",
    "tests write and delete rows.",
    "Fix: `unset DATABASE_URL` (so backend/.env is used), or export a local one, e.g.",
    "  export DATABASE_URL=postgresql://wellsure:wellsure@localhost:5432/wellsure_hr",
    "If you really mean to use a remote database, it isn't a development environment: set APP_ENV accordingly.",
    "",
  ].join("\n");
}
