import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
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

// M session block 2, ER-27: divisions group departments; HR (org.manage) maintains them; the Developer, a manager and an employee cannot change them.
describe("divisions", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const code = `DV${randomUUID().slice(0, 6).toUpperCase().replace(/-/g, "")}`;
  let divisionId = "";
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["hr", "HR_ADMIN"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      t[k] = await loginAs(e.employeeCode);
    }
  });
  afterAll(async () => {
    if (divisionId) await deleteWithDependents("Division", [divisionId]);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("HR creates a division, puts a department in it, and it is audited; the list shows it to everyone", async () => {
    const c = await request(app).post("/api/divisions").set(...authHeader(t.hr!)).send({ code, name: `Division ${code}` });
    expect(c.status).toBe(201);
    divisionId = c.body.id;
    expect((await request(app).post("/api/divisions").set(...authHeader(t.hr!)).send({ code, name: "Another name" })).status).toBe(409);
    expect((await request(app).put(`/api/divisions/${divisionId}/departments`).set(...authHeader(t.hr!)).send({ departmentIds: [org.departmentId] })).status).toBe(200);
    const listed = await request(app).get("/api/divisions").set(...authHeader(t.emp!));
    expect(listed.body.divisions.find((d: { id: string }) => d.id === divisionId).departments.map((d: { id: string }) => d.id)).toEqual([org.departmentId]);
    expect(await prisma.auditLog.count({ where: { entityId: divisionId, action: { startsWith: "org.division." } } })).toBe(2);
  });

  it("a division with departments cannot be deleted; a department belongs to one division only", async () => {
    expect((await request(app).delete(`/api/divisions/${divisionId}`).set(...authHeader(t.hr!))).status).toBe(409);
    const other = await request(app).post("/api/divisions").set(...authHeader(t.hr!)).send({ code: `${code}B`.slice(0, 20), name: `Other ${code}` });
    expect((await request(app).put(`/api/divisions/${other.body.id}/departments`).set(...authHeader(t.hr!)).send({ departmentIds: [org.departmentId] })).status).toBe(200);
    expect(await prisma.departmentDivision.count({ where: { departmentId: org.departmentId } })).toBe(1);
    expect((await prisma.departmentDivision.findUnique({ where: { departmentId: org.departmentId } }))!.divisionId).toBe(other.body.id);
    expect((await request(app).put(`/api/divisions/${other.body.id}/departments`).set(...authHeader(t.hr!)).send({ departmentIds: [] })).status).toBe(200);
    expect((await request(app).delete(`/api/divisions/${other.body.id}`).set(...authHeader(t.hr!))).status).toBe(204);
  });

  it("an employee, a manager and the Developer cannot change divisions", async () => {
    for (const who of ["emp", "mgr", "dev"]) {
      expect((await request(app).post("/api/divisions").set(...authHeader(t[who]!)).send({ code: "ZZ", name: "Nope" })).status, who).toBe(403);
      expect((await request(app).put(`/api/divisions/${divisionId}/departments`).set(...authHeader(t[who]!)).send({ departmentIds: [] })).status, who).toBe(403);
      expect((await request(app).delete(`/api/divisions/${divisionId}`).set(...authHeader(t[who]!))).status, who).toBe(403);
    }
  });
});
