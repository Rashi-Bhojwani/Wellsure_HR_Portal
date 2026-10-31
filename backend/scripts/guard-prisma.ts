import "../src/config/env";

// Runs before any npm script that calls the Prisma CLI directly (`prisma:migrate:dev`, `prisma:migrate:deploy`, `db:drift`).
// Importing config/env validates the environment and runs the development-database guard (config/databaseGuard.ts): in development a Prisma command may only
// ever be aimed at a database on this machine. A DATABASE_URL exported by a cloud shell takes precedence over backend/.env, which is how a remote database
// once came within one failed connection of being written to; this makes that a refusal instead of luck.
// Do not call `npx prisma ...` by hand: use the npm scripts, which come through here.
console.log("Database check passed: the target is a local database.");
