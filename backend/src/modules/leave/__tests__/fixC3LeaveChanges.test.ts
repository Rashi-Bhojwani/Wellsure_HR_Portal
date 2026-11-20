import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { DATASET_COLUMNS } from "../../import/types";
import { buildXlsx } from "../../import/__tests__/importTestHelpers";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// FIX-C3 (independent audit 2026-11-20, finding C3): "HR Executive gave themselves 15 days of paid leave, and the Developer gave themselves 30 days through
// Import. No director involved." Now a grant, a debit, a comp-off credit and a leave import are proposals; a director who is not the proposer, and not one of
// the people credited, confirms them; nobody changes their own leave; HR Executive cannot grant at all by default.
type P = { employeeId: string; employeeCode: string; userId: string };

describe("FIX-C3: leave changes need a different director", () => {
  let org: TestOrgMasters;
  let hrExec: P, hrAdmin: P, employee: P;
  let tExec: string, tAdmin: string, tD1: string, tD2: string;
  let d1: P, d2: P;
  let plId: string;
  const requestIds: string[] = [];

  const balance = async (employeeId: string) => {
    const sum = await prisma.leaveLedger.aggregate({ where: { employeeId, leaveTypeId: plId }, _sum: { days: true } });
    return Number(sum._sum.days ?? 0);
  };
  const grant = (token: string, employeeId: string, days: number) => request(app).post("/api/leave/grants").set(...authHeader(token)).send({ employeeId, leaveTypeId: plId, days, entryDate: "2026-06-01" });
  const confirm = (token: string, id: string) => request(app).post(`/api/leave/change-requests/${id}/confirm`).set(...authHeader(token)).send({});

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    hrExec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    employee = await createFullTestEmployee(org);
    [tExec, tAdmin] = [await loginAs(hrExec.employeeCode), await loginAs(hrAdmin.employeeCode)];
    [d1, d2] = [await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" }), await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" })];
    [tD1, tD2] = [await loginAs(d1.employeeCode), await loginAs(d2.employeeCode)];
    plId = (await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } })).id;
  });
  afterAll(async () => {
    const ids = (await prisma.leaveChangeRequest.findMany({ where: { OR: [{ id: { in: requestIds } }, { proposedByUserId: { in: [hrAdmin.userId, hrExec.userId, d1.userId, d2.userId] } }] }, select: { id: true } })).map((r) => r.id);
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.leaveChangeRequest.deleteMany({ where: { id: { in: ids } } });
    });
    for (const p of [hrExec, hrAdmin, employee, d1, d2]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the audit's attack: HR Executive granting themselves 15 days is refused, and HR Executive cannot grant anyone leave by default", async () => {
    expect((await grant(tExec, hrExec.employeeId, 15)).status).toBe(403);
    expect((await grant(tExec, employee.employeeId, 15)).status).toBe(403);
    expect(await balance(hrExec.employeeId)).toBe(0);
  });

  it("nobody proposes leave for themselves: HR Admin and a director are refused", async () => {
    const own = await grant(tAdmin, hrAdmin.employeeId, 5);
    expect([own.status, own.body.error.code]).toEqual([403, "SELF_LEAVE_CHANGE"]);
    const dir = await grant(tD1, d1.employeeId, 5);
    expect([dir.status, dir.body.error.code]).toEqual([403, "SELF_LEAVE_CHANGE"]);
  });

  it("HR proposes, the balance does not move, HR cannot confirm, and a director confirms", async () => {
    const proposed = await grant(tAdmin, employee.employeeId, 4);
    expect(proposed.status).toBe(202);
    requestIds.push(proposed.body.id);
    expect(await balance(employee.employeeId)).toBe(0);
    expect((await confirm(tAdmin, proposed.body.id)).body.error.code).toBe("DIRECTOR_ONLY");
    expect((await confirm(tExec, proposed.body.id)).status).toBe(403);
    const ok = await confirm(tD1, proposed.body.id);
    expect(ok.status).toBe(200);
    expect(await balance(employee.employeeId)).toBe(4);
    expect((await confirm(tD2, proposed.body.id)).body.error.code).toBe("ALREADY_DECIDED");
  });

  it("a director's proposal is confirmed by the OTHER director, never by the proposer", async () => {
    const proposed = await grant(tD1, employee.employeeId, 2);
    expect(proposed.status).toBe(202);
    requestIds.push(proposed.body.id);
    const self = await confirm(tD1, proposed.body.id);
    expect([self.status, self.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
    expect((await confirm(tD2, proposed.body.id)).status).toBe(200);
    expect(await balance(employee.employeeId)).toBe(6);
  });

  it("a director never confirms leave for themselves", async () => {
    const proposed = await grant(tAdmin, d2.employeeId, 3);
    expect(proposed.status).toBe(202);
    requestIds.push(proposed.body.id);
    const self = await confirm(tD2, proposed.body.id);
    expect([self.status, self.body.error.code]).toEqual([403, "SELF_LEAVE_CHANGE"]);
    const list = await request(app).get("/api/leave/change-requests").set(...authHeader(tD2));
    expect(list.body.requests.find((r: { id: string }) => r.id === proposed.body.id)).toMatchObject({ canConfirm: false, aboutMe: true });
    await request(app).post(`/api/leave/change-requests/${proposed.body.id}/reject`).set(...authHeader(tD1)).send({ note: "test: turned down" }).expect(200);
  });

  it("a leave-grants import by HR waits for a director, and an import crediting the importer is refused", async () => {
    const file = await buildXlsx(DATASET_COLUMNS["leave-grants"], [{ employeeCode: employee.employeeCode, leaveTypeCode: "PL", days: "1", entryDate: "2026-06-03", remarks: "fix-c3" }]);
    const upload = await request(app).post("/api/import/leave-grants/upload").set(...authHeader(tAdmin)).attach("file", file, "g.xlsx");
    if (upload.status === 403) {
      // HR Admin's import of details is a director-controlled switch (import.details.manage): proven on the director path instead.
      const up2 = await request(app).post("/api/import/leave-grants/upload").set(...authHeader(tD1)).attach("file", file, "g.xlsx");
      const commit = await request(app).post(`/api/import/batches/${up2.body.batchId}/commit`).set(...authHeader(tD1)).send({});
      expect(commit.body.pendingConfirmation).toBe(true);
      requestIds.push(commit.body.requestId);
      expect((await confirm(tD1, commit.body.requestId)).body.error.code).toBe("CHECKER_IS_MAKER");
      expect((await confirm(tD2, commit.body.requestId)).status).toBe(200);
    } else {
      const commit = await request(app).post(`/api/import/batches/${upload.body.batchId}/commit`).set(...authHeader(tAdmin)).send({});
      expect(commit.body.pendingConfirmation).toBe(true);
      requestIds.push(commit.body.requestId);
      expect((await confirm(tD1, commit.body.requestId)).status).toBe(200);
    }
    expect(await balance(employee.employeeId)).toBe(7);
    const own = await buildXlsx(DATASET_COLUMNS["leave-grants"], [{ employeeCode: d1.employeeCode, leaveTypeCode: "PL", days: "30", entryDate: "2026-06-03", remarks: "fix-c3" }]);
    const up3 = await request(app).post("/api/import/leave-grants/upload").set(...authHeader(tD1)).attach("file", own, "g.xlsx");
    const refused = await request(app).post(`/api/import/batches/${up3.body.batchId}/commit`).set(...authHeader(tD1)).send({});
    expect([refused.status, refused.body.error.code]).toEqual([403, "SELF_LEAVE_CHANGE"]);
  });

  it("the database refuses a confirmation by the proposer and a second decision", async () => {
    const proposed = await grant(tAdmin, employee.employeeId, 1);
    requestIds.push(proposed.body.id);
    await expect(prisma.leaveChangeRequest.update({ where: { id: proposed.body.id }, data: { status: "CONFIRMED", decidedByUserId: hrAdmin.userId, decidedAt: new Date() } })).rejects.toThrow(/confirmer_not_proposer/);
    await prisma.leaveChangeRequest.update({ where: { id: proposed.body.id }, data: { status: "REJECTED", decidedByUserId: hrAdmin.userId, decidedAt: new Date(), decisionNote: "withdrawn" } });
    await expect(prisma.leaveChangeRequest.update({ where: { id: proposed.body.id }, data: { status: "CONFIRMED", decidedByUserId: d1.userId } })).rejects.toThrow(/LEAVE_CHANGE_DECIDED_ONCE/);
    await expect(prisma.leaveChangeRequest.delete({ where: { id: proposed.body.id } })).rejects.toThrow(/LEAVE_CHANGE_APPEND_ONLY/);
  });
});
