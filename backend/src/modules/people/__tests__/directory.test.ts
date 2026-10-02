import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { PEOPLE_DOCUMENTS_SETTING_KEYS } from "../../../lib/peopleDocumentsSettings";
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
import { setSetting, snapshotPeopleDocumentsSettings } from "./peopleTestHelpers";

describe("People directory + org chart (/api/people)", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  let restoreSettings: () => Promise<void>;
  const ids = {} as Record<"manager" | "report" | "orphan" | "separated", { employeeId: string; employeeCode: string }>;
  let token: string;

  beforeAll(async () => {
    restoreSettings = await snapshotPeopleDocumentsSettings();
    await setSetting(PEOPLE_DOCUMENTS_SETTING_KEYS.directoryVisibleFields, ["reportingManager"]);
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    ids.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    ids.report = await createFullTestEmployee(org, { managerId: ids.manager.employeeId });
    ids.orphan = await createFullTestEmployee(otherOrg); // no manager, not an Admin
    ids.separated = await createFullTestEmployee(org, { managerId: ids.manager.employeeId });
    await prisma.employee.update({ where: { id: ids.separated.employeeId }, data: { status: "SEPARATED" } });
    token = await loginAs(ids.report.employeeCode);
  });

  afterAll(async () => {
    for (const key of ["report", "separated", "orphan", "manager"] as const) await cleanupFullTestEmployee(ids[key].employeeId);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
    await restoreSettings();
  });

  it("needs a signed-in user, but no permission (a plain employee can browse it)", async () => {
    expect((await request(app).get("/api/people")).status).toBe(401);
    expect((await request(app).get("/api/people").set(...authHeader(token))).status).toBe(200);
  });

  it("filters by department and branch, searches by code, and paginates", async () => {
    const byDept = await request(app).get("/api/people").query({ departmentId: org.departmentId }).set(...authHeader(token));
    const codes = byDept.body.items.map((e: { employeeCode: string }) => e.employeeCode);
    expect(codes).toEqual(expect.arrayContaining([ids.manager.employeeCode, ids.report.employeeCode]));
    expect(codes).not.toContain(ids.orphan.employeeCode);

    const byBranch = await request(app).get("/api/people").query({ locationId: otherOrg.locationId }).set(...authHeader(token));
    expect(byBranch.body.items.map((e: { employeeCode: string }) => e.employeeCode)).toEqual([ids.orphan.employeeCode]);

    const search = await request(app).get("/api/people").query({ search: ids.report.employeeCode }).set(...authHeader(token));
    expect(search.body.total).toBe(1);
    expect(search.body.items[0].reportingManager.id).toBe(ids.manager.employeeId);

    const page = await request(app).get("/api/people").query({ departmentId: org.departmentId, pageSize: 1, page: 2 }).set(...authHeader(token));
    expect(page.body.items).toHaveLength(1);
    expect(page.body.total).toBe(2);
  });

  it("never lists or reveals a separated employee — 404, same as a missing one", async () => {
    const list = await request(app).get("/api/people").query({ departmentId: org.departmentId }).set(...authHeader(token));
    expect(list.body.items.map((e: { id: string }) => e.id)).not.toContain(ids.separated.employeeId);
    expect((await request(app).get(`/api/people/${ids.separated.employeeId}`).set(...authHeader(token))).status).toBe(404);
    expect((await request(app).get("/api/people/does-not-exist").set(...authHeader(token))).status).toBe(404);
  });

  it("org chart: links reports to managers, and surfaces an employee with no manager as unassigned (model A)", async () => {
    const res = await request(app).get("/api/people/org-chart").set(...authHeader(token));
    expect(res.status).toBe(200);
    const node = (id: string) => res.body.nodes.find((n: { id: string }) => n.id === id);
    expect(node(ids.report.employeeId).managerId).toBe(ids.manager.employeeId);
    expect(node(ids.separated.employeeId)).toBeUndefined();
    expect(res.body.unassignedIds).toContain(ids.orphan.employeeId);
    expect(res.body.rootIds).not.toContain(ids.orphan.employeeId);
    // E2: kinds, and the manager sits directly under the Admin root.
    expect(node(ids.manager.employeeId).kind).toBe("manager");
    expect(node(ids.report.employeeId).kind).toBe("employee");
    expect(res.body.rootIds).toContain(ids.manager.employeeId);
    // Names are sent once as lookup maps, not repeated per node.
    expect(res.body.departments[org.departmentId]).toBeDefined();
    expect(node(ids.report.employeeId).department).toBeUndefined();
  });
});
