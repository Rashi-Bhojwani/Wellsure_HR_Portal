import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, lockCycle, teardownRunWorld, type RunWorld } from "../../payroll/__tests__/runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "../../payroll/__tests__/salaryTestHelpers";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";

// AD-08 (M session): further companies beside the main one. Directors only change them; whoever may view employees reads names and one person's
// company within their scope; the Developer is refused. GOLDEN: a payroll run's results are byte-for-byte the same with extra companies defined.
describe("more than one company", () => {
  let world: RunWorld;
  const extra: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const entityIds: string[] = [];
  const as = (who: string | null) => ({
    get: (p: string) => (who ? request(app).get(`/api/legal-entities${p}`).set(...authHeader(t[who]!)) : request(app).get(`/api/legal-entities${p}`)),
    post: (p: string, b: object) => request(app).post(`/api/legal-entities${p}`).set(...authHeader(t[who!]!)).send(b),
    put: (p: string, b: object) => request(app).put(`/api/legal-entities${p}`).set(...authHeader(t[who!]!)).send(b),
  });

  beforeAll(async () => {
    world = await buildRunWorld(["a", "b"]);
    for (const n of ["a", "b"]) {
      await giveSalary(world, world.named[n]!.employeeId, "600000", FIRST_SALARY_DAY);
      await lockCycle(world.named[n]!.employeeId, CYCLE.start, CYCLE.end);
    }
    t.d1 = world.tokens.maker;
    t.d2 = world.tokens.checkerA;
    for (const [k, roleCode] of [["hr", "HR_ADMIN"], ["emp", undefined], ["mgr", "MANAGER"], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const x = await createFullTestEmployee(world.org, roleCode ? { roleCode } : {});
      extra.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
  }, 300_000);
  afterAll(async () => {
    await deleteWithDependents("LegalEntity", entityIds);
    for (const id of extra) await cleanupFullTestEmployee(id);
    await teardownRunWorld(world);
  });

  it("only a director adds a company or moves people; HR, a manager, an employee and the Developer are refused; signed out is 401", async () => {
    expect((await as(null).get("")).status).toBe(401);
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await as(who).post("", { code: "X1", name: "Nope Pvt Ltd" })).status, who).toBe(403);
      expect((await as(who).put("/assignments", { employeeCodes: ["x"], legalEntityId: null })).status, who).toBe(403);
    }
    expect((await as("dev").get("")).status).toBe(403);
    expect((await as("emp").get("")).status).toBe(403);
    expect((await as("emp").get(`/employees/${world.named.a!.employeeId}`)).status).toBe(403);
    expect((await as("hr").get("")).status).toBe(200);
  });

  it("GOLDEN: a payroll run's results are the same, byte for byte, with one company and with extra companies and a person moved", async () => {
    const snapshot = async (runId: string) => {
      const items = await Promise.all(["a", "b"].map(async (n) => (await api(world.tokens.maker, "get", `/runs/${runId}/items/${world.named[n]!.employeeId}`)).body));
      return JSON.stringify(items.map((i) => ({ status: i.status, totals: i.totals, days: i.days, lines: i.lines.map((l: { code: string; amount: string }) => [l.code, l.amount]) })));
    };
    const runId = await calculateRun(world);
    const oneCompany = await snapshot(runId);
    const code = `CO${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`;
    for (const c of [code, `${code}B`]) {
      const r = await as("d1").post("", { code: c, name: `Test company ${c}`, registeredAddress: "Test address" });
      expect(r.status).toBe(201);
      entityIds.push(r.body.id);
    }
    const aCode = (await prisma.employee.findUniqueOrThrow({ where: { id: world.named.a!.employeeId } })).employeeCode;
    expect((await as("d1").put("/assignments", { employeeCodes: [aCode], legalEntityId: entityIds[0] })).body.moved).toBe(1);
    await calculateAgain(world, runId);
    expect(await snapshot(runId)).toBe(oneCompany);
    expect(await prisma.auditLog.count({ where: { action: { startsWith: "org.legal_entity." }, entityId: { in: [...entityIds] } } })).toBe(3);
  }, 300_000);

  it("HR reads one person's company within its scope; moving back to the main company works", async () => {
    expect((await as("hr").get(`/employees/${world.named.a!.employeeId}`)).body).toMatchObject({ main: false, name: expect.stringContaining("Test company") });
    const aCode = (await prisma.employee.findUniqueOrThrow({ where: { id: world.named.a!.employeeId } })).employeeCode;
    expect((await as("d2").put("/assignments", { employeeCodes: [aCode], legalEntityId: null })).body.moved).toBe(1);
    expect((await as("hr").get(`/employees/${world.named.a!.employeeId}`)).body).toEqual({ main: true, code: null, name: null });
  });
});
