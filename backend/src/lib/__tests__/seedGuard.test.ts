import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// The development seed creates demo accounts with a known password, including a payroll maker (1025) and a payroll checker (1027). Nothing like that may
// exist in staging or production. Three independent fences, each proved here:
//   1. the seed refuses to run outside development, as its first statement, before it touches the database or assigns any role;
//   2. the seed is the ONLY code that assigns roles without a person doing it (bootstrap makes the first Super Admin; every other assignment is made by
//      an authenticated actor and recorded) and the only code that writes the development marker;
//   3. admin:preflight fails in staging/production if the development marker is in the database at all (preflight.test.ts).

const env = vi.hoisted(() => ({ APP_ENV: "development" as string }));
vi.mock("../../config/env", () => ({ env }));

const backendRoot = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.join(backendRoot, rel), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (name === "node_modules" || name === "__tests__") continue;
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(path.relative(backendRoot, full));
  }
  return out;
}

describe("the development seed cannot carry demo accounts or payroll roles into a deployed environment", () => {
  afterEach(() => {
    env.APP_ENV = "development";
    vi.restoreAllMocks();
  });

  it("fence 1a: the guard refuses everything except development, and says why", async () => {
    const { assertDevelopmentEnvironment } = await import("../devGuard");
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    for (const appEnv of ["staging", "production", "test", ""]) {
      env.APP_ENV = appEnv;
      assertDevelopmentEnvironment("the Phase 1 seed script");
      expect(exit, appEnv).toHaveBeenLastCalledWith(1);
    }
    expect(error).toHaveBeenLastCalledWith(expect.stringContaining("Refusing to run the Phase 1 seed script"));
    exit.mockClear();
    env.APP_ENV = "development";
    assertDevelopmentEnvironment("the Phase 1 seed script");
    expect(exit).not.toHaveBeenCalled();
  });

  it("fence 1b: the seed calls the guard as its first statement, before any database access and before any role is named", () => {
    const seed = read("prisma/seed.ts");
    const guard = seed.indexOf("\nassertDevelopmentEnvironment(");
    expect(guard, "prisma/seed.ts must call assertDevelopmentEnvironment() at the top level").toBeGreaterThan(0);
    for (const later of ["new PrismaClient(", "prisma.user.create", "userRole.create", "SUPER_ADMIN", "ensurePayrollRules()", "devDatabaseMarker.create"]) {
      expect(seed.indexOf(later), `${later} must come after the guard`).toBeGreaterThan(guard);
    }
    // Importing things is allowed to come first; running anything is not. Only imports and comments may precede the guard.
    const before = seed
      .slice(0, guard)
      .replace(/import[\s\S]*?from\s+["'][^"']+["'];/g, "")
      .split("\n")
      .filter((l) => l.trim() !== "" && !l.trim().startsWith("//"));
    expect(before, "nothing but imports may run before the guard").toEqual([]);
    // The one other script that wipes and reseeds has the same guard.
    expect(read("scripts/reset-db.ts")).toMatch(/\nassertDevelopmentEnvironment\(/);
  });

  it("fence 2a: the seed is the only code that writes the development marker", () => {
    const writers = sourceFiles(backendRoot).filter((f) => /devDatabaseMarker\.(create|upsert|createMany)|INSERT INTO "?dev_database_marker/.test(read(f)));
    expect(writers.sort()).toEqual(["prisma/seed.ts"]);
  });

  it("fence 2b: every place that assigns a role is one a person drives (and recorded), the first-admin bootstrap, or the seed; a new one must be reviewed here", () => {
    const assigners = sourceFiles(backendRoot)
      .filter((f) => /userRole\.(create|createMany|upsert)\(|INSERT INTO "?user_roles/.test(read(f)))
      .sort();
    expect(assigners).toEqual([
      "prisma/seed.ts", // development only, behind the guard
      "scripts/demo/seedDemoCompany.ts", // the fictional demo company: development only (its command asserts it, it needs the seed's marker, and the app refuses to start where it has been run)
      "src/modules/access/bootstrap.ts", // SUPER_ADMIN and EMPLOYEE only, refused where the environment cannot alert
      "src/modules/access/service.ts", // an authenticated administrator picks the role; assignedByUserId is the actor
      "src/modules/employee/service.ts", // EMPLOYEE only
      "src/modules/managers/service.ts", // MANAGER and EMPLOYEE only
    ]);
    // None of the deployed paths can hand out a payroll role on their own: the role is the actor's choice or a fixed non-payroll role.
    for (const f of ["src/modules/access/bootstrap.ts", "src/modules/employee/service.ts", "src/modules/managers/service.ts"]) {
      expect(read(f), f).not.toMatch(/PAYROLL_ADMIN|PAYROLL_APPROVER/);
    }
    expect(read("src/modules/access/service.ts")).toMatch(/assignedByUserId: actor\.userId/);
  });

  it("fence 2c: the second-director demo assignment (1031) exists only inside the seed", () => {
    const hits = sourceFiles(backendRoot).filter((f) => /spec\.employeeCode === "1031"/.test(read(f)));
    expect(hits).toEqual(["prisma/seed.ts"]);
  });
});
