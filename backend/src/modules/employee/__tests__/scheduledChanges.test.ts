import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { setSetting } from "../../../lib/settings";
import { getSocketServer, setSocketServer, type RoomEmitter } from "../../../realtime/emit";
import { processHistoryRollover, ROLLOVER_LAST_RUN_KEY } from "../scheduledChanges";
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

// EF3: scheduled job changes are visible, cancellable, announced when made,
// and rolled over on their day (live rooms and team screens refreshed, the
// people involved told) — exactly once, catching up on any missed day.
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("scheduled changes (EF3)", () => {
  let org: TestOrgMasters;
  type Person = { employeeId: string; employeeCode: string; userId: string };
  const p = {} as Record<"hr" | "mgrA" | "mgrB" | "member", Person>;
  let hrToken = "";
  let otherDeptId = "";
  const hr = () => ({
    get: (path: string) => request(app).get(path).set(...authHeader(hrToken)),
    patch: (path: string, body: object) => request(app).patch(path).set(...authHeader(hrToken)).send(body),
    post: (path: string, body: object = {}) => request(app).post(path).set(...authHeader(hrToken)).send(body),
  });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.mgrA = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.mgrB = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.member = await createFullTestEmployee(org, { managerId: p.mgrA.employeeId });
    otherDeptId = (await prisma.department.create({ data: { code: `SC-${Date.now()}`, name: `Scheduled ${Date.now()}` } })).id;
    hrToken = await loginAs(p.hr.employeeCode);
  });
  afterEach(() => setBusinessTodayForTests(null));
  afterAll(async () => {
    for (const k of ["member", "mgrA", "mgrB", "hr"] as const) await cleanupFullTestEmployee(p[k].employeeId);
    await prisma.department.delete({ where: { id: otherDeptId } }).catch(() => undefined);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("Change job details dated ahead is scheduled: shown as scheduled, announced to all three, not in force yet", async () => {
    setBusinessTodayForTests(day("2026-05-04"));
    const res = await hr().patch(`/api/employees/${p.member.employeeId}/job`, { reportingManagerId: p.mgrB.employeeId, departmentId: otherDeptId, effectiveFrom: "2026-05-11" });
    expect(res.status).toBe(200);
    const history = (await hr().get(`/api/employees/${p.member.employeeId}/history/job`)).body.history as Array<{ status: string; effectiveFrom: string }>;
    expect(history.map((h) => [h.effectiveFrom, h.status])).toEqual([
      ["2026-05-11", "scheduled"],
      ["2024-01-01", "current"],
    ]);
    for (const who of [p.member, p.mgrA, p.mgrB]) {
      expect(await prisma.notification.count({ where: { userId: who.userId, type: "team.move.scheduled" } })).toBe(1);
    }
    // A second change dated before it: cancel that one first.
    const early = await hr().patch(`/api/employees/${p.member.employeeId}/job`, { designationId: org.designationId, effectiveFrom: "2026-05-08" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("HISTORY_SCHEDULED_EXISTS");
  });

  it("the rollover on the day: rooms move, team screens refresh, everyone is told — once; a missed day is caught up", async () => {
    // The test clock moves "today" but not created_at: date the scheduled row as written on 4 May.
    await prisma.employeeJobHistory.updateMany({ where: { employeeId: p.member.employeeId, effectiveFrom: day("2026-05-11") }, data: { createdAt: new Date("2026-05-04T06:00:00Z") } });
    await setSetting(ROLLOVER_LAST_RUN_KEY, "2026-05-09", null); // last ran Saturday; the scheduler was down Sunday
    setBusinessTodayForTests(day("2026-05-12")); // ...and Monday — so the 11th's change is caught up on the 12th
    const sent: { rooms: string[]; event: string; op?: string }[] = [];
    const previous = getSocketServer();
    setSocketServer({
      to: (room) => ({ emit: (event: string) => sent.push({ rooms: ([] as string[]).concat(room), event }) }),
      in: (room) => ({
        socketsJoin: (rooms) => sent.push({ rooms: [String(room), ...([] as string[]).concat(rooms)], event: "join" }),
        socketsLeave: (rooms) => sent.push({ rooms: [String(room), ...([] as string[]).concat(rooms)], event: "leave" }),
      }),
    } as RoomEmitter);
    try {
      expect((await processHistoryRollover()).processed).toBe(1);
      expect((await processHistoryRollover()).processed).toBe(0); // once only
    } finally {
      setSocketServer(previous);
    }
    expect(sent).toEqual(
      expect.arrayContaining([
        { rooms: [`user:${p.member.employeeId}`, `dept:${otherDeptId}`], event: "join" },
        { rooms: [`user:${p.member.employeeId}`, `dept:${org.departmentId}`], event: "leave" },
      ]),
    );
    expect(sent.some((s) => s.event === "team.changed" && s.rooms.includes(`user:${p.mgrB.employeeId}`))).toBe(true);
    for (const who of [p.member, p.mgrA, p.mgrB]) {
      expect(await prisma.notification.count({ where: { userId: who.userId, type: "team.move.effective" } })).toBe(1);
    }
  });

  it("a scheduled name or bank change can be cancelled; one in force can't", async () => {
    setBusinessTodayForTests(day("2026-06-01"));
    expect((await hr().patch(`/api/employees/${p.member.employeeId}/name`, { fullName: "Future Name", effectiveFrom: "2026-07-01" })).status).toBe(200);
    const names = (await hr().get(`/api/employees/${p.member.employeeId}/history/name`)).body.history as Array<{ id: string; status: string }>;
    const future = names.find((n) => n.status === "scheduled")!;
    const current = names.find((n) => n.status === "current")!;
    expect((await hr().post(`/api/employees/${p.member.employeeId}/history/name/${current.id}/cancel`)).status).toBe(409);
    expect((await hr().post(`/api/employees/${p.member.employeeId}/history/name/${future.id}/cancel`)).status).toBe(200);
    expect(await prisma.employeeNameHistory.count({ where: { employeeId: p.member.employeeId } })).toBe(1);
  });
});
