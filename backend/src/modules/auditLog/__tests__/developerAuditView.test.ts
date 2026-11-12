import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { writeAuditLog } from "../../../lib/audit";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { ROUTE_CLASSIFICATION } from "../../managers/__tests__/routeInventory";
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

// Block 2 task 1 (M session): the Developer role sees who did what, when and to which record type, and never a value: not the old or new value of any
// field (personal or not), not the record's id, not the IP address or browser. Every audit-reading route in the route inventory is walked as the
// Developer; a route added later is walked automatically.
describe("the Developer's audit view shows no value", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const marker = `m-dev-audit-${Date.now()}`;
  // Every value written below is unique, so finding any of them in a response means a value leaked.
  const VALUES = ["VAL-OLD-COLOUR-7f3a", "VAL-NEW-COLOUR-9b2c", "VAL-NESTED-41d8", "ENTITY-ID-5e6f", "10.98.76.54", "UA-MARK-c0ffee", "VAL-IN-ARRAY-88aa", "4242.50"];
  const KEY_AS_VALUE = "EMPCODE9931"; // a map keyed by a code: the key itself is data

  const auditRoutes = Object.keys(ROUTE_CLASSIFICATION)
    .filter((k) => k.startsWith("GET ") && /audit/i.test(k))
    .map((k) => k.slice(4));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const e = await createFullTestEmployee(org, { roleCode });
      ids.push(e.employeeId);
      t[k] = await loginAs(e.employeeCode);
    }
    await writeAuditLog({
      action: `${marker}.changed`,
      entityType: "TestRecord",
      entityId: "ENTITY-ID-5e6f",
      ipAddress: "10.98.76.54",
      userAgent: "UA-MARK-c0ffee",
      before: { colour: "VAL-OLD-COLOUR-7f3a", amountText: "4242.50", nested: { deep: "VAL-NESTED-41d8" } },
      after: { colour: "VAL-NEW-COLOUR-9b2c", list: ["VAL-IN-ARRAY-88aa"], [KEY_AS_VALUE]: true },
    });
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the inventory has the audit routes this test walks", () => {
    expect(auditRoutes).toEqual(expect.arrayContaining(["/api/audit-logs", "/api/audit-logs/export", "/api/payroll/audit"]));
  });

  it("every audit-reading route, as the Developer, returns no value (or is refused)", async () => {
    let read = 0;
    for (const path of auditRoutes) {
      for (const q of [`?action=${marker}`, `?entityType=TestRecord&action=${marker}`, `?actorSearch=&action=${marker}`]) {
        const res = await request(app).get(`${path}${q}`).set(...authHeader(t.dev!)).buffer(true).parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on("data", (c: Buffer) => chunks.push(c));
          r.on("end", () => cb(null, Buffer.concat(chunks)));
        });
        expect([200, 403], `${path}${q}`).toContain(res.status);
        const text = (res.body as Buffer).toString("utf8");
        for (const value of [...VALUES, KEY_AS_VALUE]) expect(text, `${path}${q} leaks ${value}`).not.toContain(value);
        if (res.status === 200) {
          // A file (Excel is zipped) could carry values the text search cannot see: the Developer gets no file from an audit route at all.
          expect(res.headers["content-type"], `${path} gives the Developer a file`).toContain("application/json");
          read += 1;
          const body = JSON.parse(text) as { valuesHidden: boolean; rows: Array<Record<string, unknown>> };
          expect(body.valuesHidden).toBe(true);
          const row = body.rows.find((r) => r.action === `${marker}.changed`);
          expect(row, path).toBeDefined();
          expect(row).toMatchObject({ entityType: "TestRecord", entityId: null, before: null, after: null, ipAddress: null, userAgent: null });
          expect(row!.createdAt).toEqual(expect.any(String));
          expect(row!.changedFields).toEqual(["amountText", "colour", "list", "nested"]);
        }
      }
    }
    expect(read, "the Developer reads the audit screen").toBeGreaterThan(0);
  });

  it("a director still sees the values (the control)", async () => {
    const res = await request(app).get(`/api/audit-logs?action=${marker}`).set(...authHeader(t.dir!));
    expect(res.status).toBe(200);
    expect(res.body.valuesHidden).toBe(false);
    const row = res.body.rows.find((r: { action: string }) => r.action === `${marker}.changed`);
    expect(row).toMatchObject({ entityId: "ENTITY-ID-5e6f", ipAddress: "10.98.76.54", before: { colour: "VAL-OLD-COLOUR-7f3a" } });
  });
});
