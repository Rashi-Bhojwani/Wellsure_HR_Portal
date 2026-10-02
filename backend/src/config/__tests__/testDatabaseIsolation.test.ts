import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../../lib/prisma";
import { env, isolateTestDatabase } from "../env";

// Same rule as Redis (testRedisIsolation.test.ts), for Postgres and the
// local storage/mail folders: a dev server left running, or someone using
// the dev UI mid-run, must never touch the suite's rows or files, nor the
// suite dev's. vitest.globalSetup.ts rebuilds the test database each run.
describe("test runs are isolated from the dev database and files", () => {
  const devUrl = process.env.DATABASE_URL!; // as configured (.env / shell), before isolation
  const devName = new URL(devUrl).pathname.slice(1);
  const dev = new PrismaClient({ datasourceUrl: devUrl });
  afterAll(() => dev.$disconnect());

  it("the suite's Prisma client is connected to its own database, never dev's", async () => {
    const testName = env.TEST_DATABASE_NAME ?? `${devName}_test`;
    expect(new URL(env.DATABASE_URL).pathname).toBe(`/${testName}`);
    const db = (await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0]?.db;
    expect(db).toBe(testName);
    const devDb = (await dev.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`)[0]?.db;
    expect(devDb).toBe(devName);
    expect(devDb).not.toBe(db);
  });

  it("the suite's database was built by the setup: migrated and seeded", async () => {
    expect(await prisma.devDatabaseMarker.count()).toBe(1);
    expect(await prisma.employee.count({ where: { employeeCode: "1000" } })).toBe(1);
  });

  it("uploads, letter PDFs and e-mails go to their own folders", () => {
    expect(env.STORAGE_LOCAL_DIR).toMatch(/-test$/);
    expect(env.MAIL_DEV_DIR).toMatch(/-test$/);
  });

  it("refuses to run if dev's DATABASE_URL already points at the test database", () => {
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit");
    }) as never);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      expect(() => isolateTestDatabase({ ...env, DATABASE_URL: "postgresql://u:p@localhost:5432/hr_test", TEST_DATABASE_NAME: "hr_test" })).toThrow("exit");
      expect(isolateTestDatabase({ ...env, TEST_DATABASE_NAME: undefined, DATABASE_URL: "postgresql://u:p@localhost:5432/hr?schema=public" }).DATABASE_URL).toBe("postgresql://u:p@localhost:5432/hr_test?schema=public");
    } finally {
      exit.mockRestore();
      vi.restoreAllMocks();
    }
  });
});
