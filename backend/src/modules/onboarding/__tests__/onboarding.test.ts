import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { addCalendarDays, businessToday } from "../../../lib/businessDate";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "../../employee/__tests__/employeeTestHelpers";

// M session block 2, OE-04: a joiner's onboarding steps from the checklist (the default list), ticked by each step's owner.
describe("onboarding checklist", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/onboarding${p}`).set(...authHeader(t[who]!)),
    post: (p: string) => request(app).post(`/api/onboarding${p}`).set(...authHeader(t[who]!)).send({}),
    put: (p: string, body: object) => request(app).put(`/api/onboarding${p}`).set(...authHeader(t[who]!)).send(body),
  });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    const mgr = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    ids.push(mgr.employeeId);
    e.mgr = mgr.employeeId;
    t.mgr = await loginAs(mgr.employeeCode);
    for (const [k, roleCode, managed] of [["hr", "HR_ADMIN", false], ["joiner", undefined, true], ["other", undefined, false], ["dev", DEVELOPER_ROLE_CODE, false]] as const) {
      const x = await createFullTestEmployee(org, { ...(roleCode ? { roleCode } : {}), ...(managed ? { managerId: mgr.employeeId } : {}) });
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    await prisma.employee.update({ where: { id: e.joiner! }, data: { dateOfJoining: addCalendarDays(businessToday(), -2) } });
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("HR sees the new joiner, starts onboarding from the default checklist, once; the joiner and the manager are told", async () => {
    const listed = await as("hr").get("/");
    expect(listed.body.people.find((p: { employeeId: string }) => p.employeeId === e.joiner)).toMatchObject({ started: false });
    expect((await as("hr").post(`/${e.joiner}/start`)).status).toBe(201);
    expect((await as("hr").post(`/${e.joiner}/start`)).status).toBe(409);
    const steps = (await as("hr").get(`/${e.joiner}/steps`)).body.tasks;
    expect(steps).toHaveLength(6);
    expect(steps.map((s: { owner: string }) => s.owner)).toEqual(["HR", "HR", "MANAGER", "EMPLOYEE", "EMPLOYEE", "MANAGER"]);
    expect(await prisma.notification.count({ where: { type: "onboarding.started", user: { employeeId: e.joiner! } } })).toBe(1);
    expect(await prisma.notification.count({ where: { type: "onboarding.manager_steps", user: { employeeId: e.mgr! } } })).toBe(1);
  });

  it("each step is ticked by its owner only: the employee their own, the manager their report's MANAGER steps, HR any", async () => {
    const steps = (await as("joiner").get(`/${e.joiner}/steps`)).body.tasks as Array<{ id: string; owner: string }>;
    const hrStep = steps.find((s) => s.owner === "HR")!;
    const mgrStep = steps.find((s) => s.owner === "MANAGER")!;
    const empStep = steps.find((s) => s.owner === "EMPLOYEE")!;
    expect((await as("joiner").put(`/tasks/${hrStep.id}/done`, { done: true })).status).toBe(404);
    expect((await as("joiner").put(`/tasks/${mgrStep.id}/done`, { done: true })).status).toBe(404);
    expect((await as("joiner").put(`/tasks/${empStep.id}/done`, { done: true })).status).toBe(200);
    expect((await as("mgr").put(`/tasks/${empStep.id}/done`, { done: false })).status).toBe(404);
    expect((await as("mgr").put(`/tasks/${mgrStep.id}/done`, { done: true })).status).toBe(200);
    expect((await as("other").put(`/tasks/${empStep.id}/done`, { done: false })).status).toBe(404);
    expect((await as("hr").put(`/tasks/${hrStep.id}/done`, { done: true })).status).toBe(200);
    const mine = (await as("mgr").get("/mine")).body;
    expect(mine.team.find((x: { employeeId: string }) => x.employeeId === e.joiner).tasks.every((s: { owner: string }) => s.owner === "MANAGER")).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "employee.onboarding.step_done", entityId: { in: [hrStep.id, mgrStep.id, empStep.id] } } })).toBe(3);
  });

  it("someone else, the Developer and a manager of nobody here cannot read the steps or start onboarding", async () => {
    expect((await as("other").get(`/${e.joiner}/steps`)).status).toBe(404);
    for (const who of ["other", "mgr", "dev"]) {
      expect((await as(who).get("/")).status, who).toBe(403);
      expect((await as(who).post(`/${e.other}/start`)).status, who).toBe(403);
    }
    expect((await as("dev").get(`/${e.joiner}/steps`)).status).toBe(403);
  });
});
