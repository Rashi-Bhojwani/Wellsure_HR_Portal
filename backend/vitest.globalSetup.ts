// Runs once, before any test file: loads config/env, which validates the
// environment and applies the development-database guard
// (src/config/databaseGuard.ts). The integration suite writes and deletes
// real rows, so it must refuse outright — with the guard's explanation —
// rather than let every test file fail on its own or, worse, succeed
// against a database that isn't on this machine.
export default async function setup(): Promise<void> {
  await import("./src/config/env");
}
