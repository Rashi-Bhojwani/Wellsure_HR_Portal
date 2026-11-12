import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { encryptStatutoryFields } from "../service";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  loginAs,
  type TestOrgMasters,
} from "./employeeTestHelpers";

// ER-11 (M session): every change to a person's statutory numbers leaves a masked history row (database trigger); who may read it. Numbers are made up.
describe("statutory history", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const u: Record<string, { employeeId: string; userId: string }> = {};
  const history = (who: string, employeeId: string) => request(app).get(`/api/employees/${employeeId}/history/statutory`).set(...authHeader(t[who]!));

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [
      ["d1", "SUPER_ADMIN"],
      ["hrExec", "HR_EXECUTIVE"],
      ["mgr", "MANAGER"],
      ["emp", undefined],
      ["dev", DEVELOPER_ROLE_CODE],
      ["target", undefined],
    ] as const) {
      const e = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(e.employeeId);
      u[k] = e;
      t[k] = await loginAs(e.employeeCode);
    }
  });

  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("records what changed, the last four digits after it and who wrote it; nothing for a write that changes no number", async () => {
    const start = await prisma.employeeStatutoryHistory.count({ where: { employeeId: u.target!.employeeId } });
    expect(start).toBeGreaterThan(0); // the fixture's own statutory row
    // A director writes at once (their entry for someone else): one change of the PAN.
    expect((await request(app).patch(`/api/employees/${u.target!.employeeId}/statutory`).set(...authHeader(t.d1!)).send({ pan: "QQQQQ7777Q" })).status).toBe(200);
    // A write of the same PAN changes no number: nothing new.
    await prisma.employeeStatutory.update({ where: { employeeId: u.target!.employeeId }, data: encryptStatutoryFields({ pan: "QQQQQ7777Q" }) });
    const res = await history("d1", u.target!.employeeId);
    expect(res.status).toBe(200);
    expect(res.body.history).toHaveLength(start + 1);
    expect(res.body.history[0]).toMatchObject({ kind: "CHANGED", changedFields: ["PAN"], panLast4: "777Q" });
    expect(res.body.history[0].changedBy).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toContain("QQQQQ7777Q");
  });

  it("an HR entry held for a director is recorded when the director confirms it, not before", async () => {
    const before = await prisma.employeeStatutoryHistory.count({ where: { employeeId: u.target!.employeeId } });
    const held = await request(app).patch(`/api/employees/${u.target!.employeeId}/statutory`).set(...authHeader(t.hrExec!)).send({ uan: "999911112222" });
    expect(held.status).toBe(202);
    expect(await prisma.employeeStatutoryHistory.count({ where: { employeeId: u.target!.employeeId } })).toBe(before);
    expect((await request(app).post(`/api/employees/identity-changes/${held.body.id}/confirm`).set(...authHeader(t.d1!)).send({})).status).toBe(200);
    const rows = (await history("hrExec", u.target!.employeeId)).body.history;
    expect(rows[0]).toMatchObject({ kind: "CHANGED", changedFields: ["UAN"], uanLast4: "2222" });
  });

  it("only holders of the statutory view key read it: never a manager, an employee (not even their own) or the Developer", async () => {
    for (const who of ["mgr", "emp", "dev"]) expect((await history(who, u.target!.employeeId)).status, who).toBe(403);
    expect((await history("emp", u.emp!.employeeId)).status).toBe(403);
    expect((await history("hrExec", u.target!.employeeId)).status).toBe(200);
  });

  it("the history cannot be changed or removed", async () => {
    const row = await prisma.employeeStatutoryHistory.findFirstOrThrow({ where: { employeeId: u.target!.employeeId } });
    await expect(prisma.employeeStatutoryHistory.update({ where: { id: row.id }, data: { panLast4: "0000" } })).rejects.toThrow(/STATUTORY_HISTORY_APPEND_ONLY/);
    await expect(prisma.employeeStatutoryHistory.delete({ where: { id: row.id } })).rejects.toThrow(/STATUTORY_HISTORY_APPEND_ONLY/);
  });
});
