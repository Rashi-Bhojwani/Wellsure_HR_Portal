import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
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

// M session block 2, ER-28: directors define custom fields; HR fills them; sensitive values encrypted, masked, revealed only by a director.
describe("custom fields", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  const fieldIds: string[] = [];
  const sfx = randomUUID().slice(0, 6).replace(/-/g, "");
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/custom-fields${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(`/api/custom-fields${p}`).set(...authHeader(t[who]!)).send(body),
    put: (p: string, body: object) => request(app).put(`/api/custom-fields${p}`).set(...authHeader(t[who]!)).send(body),
  });
  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["emp", undefined], ["other", undefined], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
  });
  afterAll(async () => {
    await deleteWithDependents("CustomFieldDefinition", fieldIds);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("only a director defines a field; a choice needs options", async () => {
    expect((await as("hr").post("/definitions", { key: `blood_${sfx}`, label: "Blood group", type: "CHOICE", options: ["A+", "B+"] })).status).toBe(403);
    expect((await as("dir").post("/definitions", { key: `blood_${sfx}`, label: "Blood group", type: "CHOICE" })).status).toBe(400);
    const a = await as("dir").post("/definitions", { key: `blood_${sfx}`, label: "Blood group", type: "CHOICE", options: ["A+", "B+"], visibleToEmployee: true });
    const b = await as("dir").post("/definitions", { key: `passport_${sfx}`, label: "Passport number", type: "TEXT", sensitive: true, visibleToEmployee: true });
    const c = await as("dir").post("/definitions", { key: `joined_${sfx}`, label: "Union joined", type: "DATE" });
    for (const r of [a, b, c]) expect(r.status).toBe(201);
    fieldIds.push(a.body.id, b.body.id, c.body.id);
  });

  it("HR fills values (validated); a sensitive one is stored encrypted, masked, and the audit names fields, never values", async () => {
    const [blood, passport, joined] = fieldIds as [string, string, string];
    expect((await as("hr").put(`/employees/${e.emp}`, { values: { [blood]: "O-" } })).status).toBe(400);
    expect((await as("hr").put(`/employees/${e.emp}`, { values: { [joined]: "13-11-2026" } })).status).toBe(400);
    expect((await as("hr").put(`/employees/${e.emp}`, { values: { [blood]: "A+", [passport]: "Z1234567", [joined]: "2026-01-05" } })).status).toBe(200);
    const row = await prisma.employeeCustomValue.findUniqueOrThrow({ where: { employeeId_fieldId: { employeeId: e.emp!, fieldId: passport } } });
    expect(row.valueText).toBeNull();
    expect(Buffer.from(row.valueEncrypted!).toString("utf8")).not.toContain("Z1234567");
    const read = await as("hr").get(`/employees/${e.emp}`);
    expect(read.body.fields.find((f: { id: string }) => f.id === passport).value).toBe("••••4567");
    expect(read.body.fields.find((f: { id: string }) => f.id === blood).value).toBe("A+");
    expect(JSON.stringify(read.body)).not.toContain("Z1234567");
    const audits = await prisma.auditLog.findMany({ where: { entityId: e.emp!, action: "employee.custom_values.updated" } });
    expect(JSON.stringify(audits)).not.toContain("Z1234567");
    expect(JSON.stringify(audits)).not.toContain("A+");
  });

  it("only a director reveals a sensitive value, audited; the employee sees their own visible fields, masked", async () => {
    const passport = fieldIds[1]!;
    expect((await as("hr").post(`/employees/${e.emp}/${passport}/reveal`)).status).toBe(403);
    const r = await as("dir").post(`/employees/${e.emp}/${passport}/reveal`);
    expect(r.body.value).toBe("Z1234567");
    expect(await prisma.auditLog.count({ where: { entityId: e.emp!, action: "employee.custom_value.revealed" } })).toBe(1);
    const mine = (await as("emp").get("/mine")).body.fields;
    expect(mine.map((f: { label: string }) => f.label)).toEqual(expect.arrayContaining(["Blood group", "Passport number"]));
    expect(mine.map((f: { label: string }) => f.label)).not.toContain("Union joined");
    expect(JSON.stringify(mine)).not.toContain("Z1234567");
  });

  it("an employee cannot read or change someone else's; HR not its own; a manager without a grant and the Developer are refused", async () => {
    expect((await as("other").get(`/employees/${e.emp}`)).status).toBe(403);
    expect((await as("other").put(`/employees/${e.emp}`, { values: {} })).status).toBe(403);
    expect((await as("hr").put(`/employees/${e.hr}`, { values: { [fieldIds[0]!]: "B+" } })).body.error.code).toBe("OWN_RECORD");
    for (const who of ["mgr", "dev"]) {
      expect((await as(who).get(`/employees/${e.emp}`)).status, who).toBe(403);
      expect((await as(who).put(`/employees/${e.emp}`, { values: {} })).status, who).toBe(403);
      expect((await as(who).get("/definitions")).status, who).toBe(403);
      expect((await as(who).post(`/employees/${e.emp}/${fieldIds[1]}/reveal`)).status, who).toBe(403);
    }
  });
});
