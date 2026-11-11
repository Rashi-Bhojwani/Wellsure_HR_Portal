import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G6 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 15): the leavers list and leave recalculated to the last working day. Days only.
// Fake clock: "today" is Sun 15 Nov 2026.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const MONEY = /₹|\bINR\b|\bsalary\b|\bamount\b|\bencash/i;

describe("A-10 G6 — leavers", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let separationId = "";
  let plId = "";
  const call = (who: string, method: "get" | "post", path: string) => request(app)[method](path).set(...authHeader(tok[who]!));
  const balance = async () => Number((await prisma.leaveLedger.aggregate({ where: { employeeId: p.leaver!.employeeId, leaveTypeId: plId }, _sum: { days: true } }))._sum.days ?? 0);

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-11-15"));
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    p.leaver = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    for (const m of ["2026-09-01", "2026-10-01", "2026-11-01"]) {
      await prisma.leaveLedger.create({ data: { employeeId: p.leaver.employeeId, leaveTypeId: plId, leaveYear: 2026, entryDate: d(m), accrualMonth: d(m), entryType: "ACCRUAL", days: 1, referenceType: "ACCRUAL_JOB" } });
    }
    separationId = (await prisma.separation.create({ data: { employeeId: p.leaver.employeeId, lastWorkingDate: d("2026-09-20"), reason: "test", initiatedByUserId: p.hr.userId } })).id;
  }, 180_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 180_000);

  it("refuses the Developer role, an employee and no sign-in", async () => {
    for (const who of ["dev", "emp"]) {
      expect((await call(who, "get", "/api/workforce/leavers")).status, who).toBe(403);
      expect((await call(who, "post", `/api/workforce/leavers/${separationId}/apply`)).status, who).toBe(403);
    }
    expect((await request(app).get("/api/workforce/leavers")).status).toBe(401);
  });

  it("lists the leaver as pending; the preview reverses the months that start after the last working day and, for the month of leaving, follows the D-37 default (pro-rata: 20 of 30 days needs rounding, which is Not set, so it waits); applying marks it done, once", async () => {
    const list = await call("hr", "get", "/api/workforce/leavers");
    expect(JSON.stringify(list.body)).not.toMatch(MONEY);
    expect(list.body.leavers.find((r: { separationId: string }) => r.separationId === separationId)).toMatchObject({ status: "PENDING", lastWorkingDate: "2026-09-20" });
    const preview = await call("hr", "get", `/api/workforce/leavers/${separationId}/preview`);
    expect(preview.body.actions.map((a: { type: string; accrualMonth: string }) => `${a.type} ${a.accrualMonth}`).sort()).toEqual(["REVERSE 2026-10-01", "REVERSE 2026-11-01", "WAITING 2026-09-01"]);
    expect(await balance()).toBe(3);
    const applied = await call("hr", "post", `/api/workforce/leavers/${separationId}/apply`);
    expect(applied.status).toBe(200);
    expect(await balance()).toBe(1); // September stays as credited: its pro-rata figure waits for the Not-set rounding (D-37 item 5)
    const again = await call("hr", "get", `/api/workforce/leavers/${separationId}/preview`);
    expect(again.body.actions.map((a: { type: string }) => a.type)).toEqual(["WAITING"]); // nothing double-reversed; September still waits
    const listed = await call("hr", "get", "/api/workforce/leavers?status=DONE");
    expect(listed.body.leavers.map((r: { separationId: string }) => r.separationId)).toContain(separationId);
    await expect(prisma.leaverLeaveRecalc.updateMany({ where: { separationId }, data: { actions: 9 } })).rejects.toThrow(/LEAVER_RECALC_APPEND_ONLY/);
  });
});
