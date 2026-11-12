import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { writeLedgerEntry } from "../../leave/ledger";
import { resetPolicy, setPolicy } from "../../policySettings/__tests__/policyTestHelpers";
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

// LV-23 (M session block 2): encashment requests, off until two directors turn them on; approved days wait for payroll (no ledger entry here).
describe("encashment requests", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  const e: Record<string, string> = {};
  let plId = "";
  const as = (who: string) => ({
    get: (p: string) => request(app).get(`/api/encashment-requests${p}`).set(...authHeader(t[who]!)),
    post: (p: string, body: object = {}) => request(app).post(`/api/encashment-requests${p}`).set(...authHeader(t[who]!)).send(body),
  });
  const ledgerCount = () => prisma.leaveLedger.count({ where: { employeeId: e.emp! } });
  beforeAll(async () => {
    setBusinessTodayForTests(new Date("2026-12-01T00:00:00Z"));
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["emp", undefined], ["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      e[k] = x.employeeId;
      t[k] = await loginAs(x.employeeCode);
    }
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
    await writeLedgerEntry(prisma, { employeeId: e.emp!, leaveTypeId: plId, leaveYear: 2026, entryDate: new Date("2026-01-01T00:00:00Z"), entryType: "ACCRUAL", days: 22 });
  });
  afterAll(async () => {
    await resetPolicy("policy.encashmentRequests", t.d1!, t.d2!);
    setBusinessTodayForTests(null);
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("GOLDEN: while off (the default) nothing is offered or accepted and the leave ledger is untouched", async () => {
    const before = await ledgerCount();
    expect((await as("emp").get("/mine")).body).toEqual({ active: false, types: [], requests: [] });
    expect((await as("emp").post("/mine", { leaveTypeCode: "PL", days: 2 })).body.error.code).toBe("ENCASHMENT_OFF");
    expect(await ledgerCount()).toBe(before);
  });

  it("on (PL, keep 15, at most 10 a year): the room is offered; over the minimum or the year limit is refused", async () => {
    await setPolicy("policy.encashmentRequests", { active: true, leaveTypes: ["PL"], keepAtLeast: 15, maxDaysPerYear: 10 }, t.d1!, t.d2!);
    expect((await as("emp").get("/mine")).body.types).toEqual([{ code: "PL", name: expect.any(String), balance: 22, askedThisYear: 0, mayAsk: 7 }]);
    expect((await as("emp").post("/mine", { leaveTypeCode: "PL", days: 8 })).body.error.code).toBe("KEEP_MINIMUM");
    expect((await as("emp").post("/mine", { leaveTypeCode: "PL", days: 1.3 })).status).toBe(400);
    expect((await as("emp").post("/mine", { leaveTypeCode: "PL", days: 5 })).status).toBe(201);
    expect((await as("emp").post("/mine", { leaveTypeCode: "PL", days: 2.5 })).body.error.code).toBe("KEEP_MINIMUM");
  });

  it("a director approves (never their own); the approved days wait for payroll: no ledger entry is written here", async () => {
    const before = await ledgerCount();
    const r = (await as("d1").get("/")).body.requests.find((x: { employeeId: string }) => x.employeeId === e.emp);
    expect((await as("d1").post(`/${r.id}/approve`)).body.status).toBe("APPROVED");
    expect(await ledgerCount()).toBe(before);
    await expect(prisma.leaveEncashmentRequest.update({ where: { id: r.id }, data: { reason: "edited" } })).rejects.toThrow(/ENCASHMENT_DECIDED/);
    await writeLedgerEntry(prisma, { employeeId: e.d1!, leaveTypeId: plId, leaveYear: 2026, entryDate: new Date("2026-01-01T00:00:00Z"), entryType: "ACCRUAL", days: 20 });
    const own = await as("d1").post("/mine", { leaveTypeCode: "PL", days: 1 });
    expect((await as("d1").post(`/${own.body.id}/approve`)).status).toBe(404);
    expect((await as("d2").post(`/${own.body.id}/reject`, { note: "Use it as leave instead" })).status).toBe(200);
  });

  it("HR, the employee and the Developer cannot see or decide others' requests", async () => {
    const r = await as("emp").post("/mine", { leaveTypeCode: "PL", days: 1 });
    for (const who of ["hr", "emp"]) {
      expect((await as(who).get("/")).status, who).toBe(403);
      expect((await as(who).post(`/${r.body.id}/approve`)).status, who).toBe(403);
    }
    expect((await as("dev").get("/")).status).toBe(403);
    expect((await as("dev").get("/mine")).status).toBe(403);
  });
});
