import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

// The URL comes from config/env, never Prisma's own read of process.env, so
// the test suite's database isolation (isolateTestDatabase) applies here.
export const prisma = new PrismaClient({
  datasourceUrl: env.DATABASE_URL,
  log: env.APP_ENV === "development" ? ["warn", "error"] : ["error"],
});
