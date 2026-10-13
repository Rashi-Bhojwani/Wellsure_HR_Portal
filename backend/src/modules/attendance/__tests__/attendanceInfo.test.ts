import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { getTaskCounts } from "../../admin/tasks";
import { getRegularizationRequestSink, setRegularizationRequestSink } from "../../admin/regularizationIntegration";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";
import { finalisationBlockers } from "../finalisation";
import { requestEligibility } from "../regularization/service";
import { EngineRegularizationSink } from "../regularization/sink";

// Attendance Info, Who Is In? and the forgot-to-punch request (P2-E,
// docs/plans/PHASE_2.md "P2-E build design"). "Today" is pinned to Wed 30
// Sep 2026, so September is the current cycle and August the previous one.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time.length === 5 ? `${time}:00` : time}`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);

describe("Attendance Info, Who Is In and the forgot-to-punch request (P2-E)", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p = {} as Record<"dev" | "mgr" | "outsider" | "otherMgr" | "manual" | "onLeave" | "hr" | "emp", Person>;
  const tok = {} as Record<"dev" | "mgr" | "outsider" | "hr" | "emp" | "manual", string>;
  let deviceId = "";
  let batchId = "";
  const originalSink = getRegularizationRequestSink();

  const as = (t: string) => ({
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(t)),
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(t)).send(b),
  });
  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({
      data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time.length === 5 ? `${time}:00` : time}`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId },
    });
  const dayRow = (who: Person, date: string) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(date) } } });
  const raise = (t: string, date: string, missing: "IN" | "OUT", time: string, note = "Forgot to punch out, left with the team") =>
    as(t).post("/me/regularizations", { date, reasonCode: "FORGOT_TO_PUNCH", note, ...(missing === "IN" ? { inTime: time } : { outTime: time }) });

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    setRegularizationRequestSink(new EngineRegularizationSink());
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    p.mgr = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.dev = await createFullTestEmployee(org, { managerId: p.mgr.employeeId });
    p.manual = await createFullTestEmployee(org, { managerId: p.mgr.employeeId });
    p.onLeave = await createFullTestEmployee(org, { managerId: p.mgr.employeeId });
    p.otherMgr = await createFullTestEmployee(otherOrg, { roleCode: "MANAGER" });
    p.outsider = await createFullTestEmployee(otherOrg, { managerId: p.otherMgr.employeeId });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: p.manual.employeeId } });
    const keys = await prisma.permission.findMany({ where: { key: { in: ["attendance.regularization.view", "attendance.regularization.approve"] } } });
    await prisma.userPermissionOverride.createMany({ data: keys.map((k) => ({ userId: p.mgr.userId, permissionId: k.id, effect: "GRANT" as const, reason: "P2-E test", createdByUserId: p.hr.userId })) });
    for (const k of ["dev", "mgr", "outsider", "hr", "emp", "manual"] as const) tok[k] = await loginAs(p[k].employeeCode);

    deviceId = (await prisma.device.create({ data: { serialNumber: `INFO-${tag}`, name: "Info test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    await punch(p.dev, "2026-09-14", "10:00:00");
    await punch(p.dev, "2026-09-14", "10:00:40"); // a near-duplicate
    await punch(p.dev, "2026-09-14", "19:00:00");
    await punch(p.dev, "2026-09-15", "10:02:00"); // forgot to punch out
    await punch(p.dev, "2026-09-16", "10:30:00");
    await punch(p.dev, "2026-09-16", "19:00:00");
    await punch(p.dev, "2026-09-17", "10:05:00"); // another lone punch
    await punch(p.outsider, "2026-09-15", "10:00:00"); // the outsider forgot too
    await punch(p.mgr, "2026-09-15", "09:58:00"); // and so did the manager
    await punch(p.dev, TODAY, "10:20:00"); // today: arrived late
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    await prisma.leaveRequest.create({ data: { employeeId: p.onLeave.employeeId, leaveTypeId: pl.id, fromDate: d(TODAY), toDate: d(TODAY), totalDays: 1, status: "APPROVED", appliedByUserId: p.onLeave.userId } });
    await computeAttendance([p.dev.employeeId, p.outsider.employeeId, p.mgr.employeeId], "2026-09-01", TODAY);
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    setRegularizationRequestSink(originalSink);
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  });

  describe("Attendance Info", () => {
    it("the month: status, shift, markers and the stats cards", async () => {
      const res = await as(tok.dev).get("/me/month?month=2026-09");
      expect(res.status).toBe(200);
      const byDate = Object.fromEntries(res.body.days.map((x: { date: string }) => [x.date, x]));
      expect(byDate["2026-09-14"]).toMatchObject({ code: "P", shiftCode: "GEN", source: "DEVICE", firstIn: "10:00", lastOut: "19:00" });
      expect(byDate["2026-09-15"]).toMatchObject({ code: "A", missingPunch: true, corrected: false });
      expect(byDate["2026-09-16"]).toMatchObject({ code: "P", lateInMinutes: 30 });
      expect(byDate["2026-09-20"]).toMatchObject({ code: "OFF" });
      // 15th, 17th, and "today" (30th): the real clock says its window has closed
      expect(res.body.stats).toMatchObject({ lateDays: expect.any(Number), exceptionKinds: { MISSING_PUNCH: 3 } });
      expect(res.body.stats.exceptionDays).toBe(3);
      expect(res.body.stats.avgWorkMinutes).toBeGreaterThan(400);
    });

    it("the day: times, shift block, the raw punches with how each was used, and whether a request can be raised", async () => {
      const full = (await as(tok.dev).get("/me/day/2026-09-14")).body;
      expect(full).toMatchObject({ code: "P", shift: { code: "GEN", startTime: "10:00", endTime: "19:00" }, policy: { code: "DEFAULT" }, times: { firstIn: "10:00", lastOut: "19:00", breakMinutes: 45 } });
      expect(full.punches.map((x: { time: string; role: string }) => `${x.time} ${x.role}`)).toEqual(["10:00:00 FIRST_IN", "10:00:40 DUPLICATE", "19:00:00 LAST_OUT"]);
      expect(full.canRequest).toMatchObject({ ok: true, day: { punchCount: 2 } }); // wrong times can be corrected too (Phase 3)
      const lone = (await as(tok.dev).get("/me/day/2026-09-15")).body;
      expect(lone.punches.map((x: { role: string }) => x.role)).toEqual(["ONLY"]);
      expect(lone.canRequest).toMatchObject({ ok: true, day: { punchCount: 1, firstIn: "10:02" } });
    });

    it("HR sees anyone's month and day; a plain employee and a manager without attendance.view don't", async () => {
      expect((await as(tok.hr).get(`/employees/${p.dev.employeeId}/month?month=2026-09`)).status).toBe(200);
      const day = await as(tok.hr).get(`/employees/${p.dev.employeeId}/day/2026-09-15`);
      expect(day.status).toBe(200);
      expect(day.body.canRequest).toBeNull(); // not their own view
      expect((await as(tok.emp).get(`/employees/${p.dev.employeeId}/month?month=2026-09`)).status).toBe(403);
      expect((await as(tok.mgr).get(`/employees/${p.dev.employeeId}/month?month=2026-09`)).status).toBe(403);
    });
  });

  describe("the forgot-to-punch request", () => {
    let devRequest = "";
    let outsiderRequest = "";
    let mgrRequest = "";

    it("eligibility: a device day, this cycle or the one before, not finalised", async () => {
      expect(await requestEligibility(p.dev.employeeId, "2026-09-15")).toMatchObject({ ok: true, day: { punchCount: 1, firstIn: "10:02", lastOut: null }, earliest: "2026-08-01" });
      expect(await requestEligibility(p.dev.employeeId, "2026-07-31")).toMatchObject({ ok: false, code: "TOO_OLD", reason: expect.stringMatching(/start of the previous attendance cycle/) });
      await computeAttendance([p.manual.employeeId], "2026-09-15", "2026-09-15");
      expect(await requestEligibility(p.manual.employeeId, "2026-09-15")).toMatchObject({ ok: false, code: "MANUAL_CAPTURE", reason: expect.stringMatching(/marked by hand/) });
      expect(await requestEligibility(p.dev.employeeId, "2026-10-05")).toMatchObject({ ok: false, code: "NOT_OVER" });
    });

    it("the time must make sense: OUT after the punch, inside the window, not the same time", async () => {
      expect((await raise(tok.dev, "2026-09-15", "OUT", "09:30")).body.error.message).toMatch(/time out must be after the last punch at 10:02/);
      expect((await raise(tok.dev, "2026-09-15", "IN", "11:00")).body.error.message).toMatch(/time in must be before the first punch at 10:02/);
      expect((await raise(tok.dev, "2026-09-15", "OUT", "10:03")).body.error.message).toMatch(/time out must be after the last punch/); // within the near-duplicate window
      expect((await raise(tok.dev, "2026-09-15", "IN", "05:00")).body.error.message).toMatch(/05:00 is outside the shift's punch window \(06:00–01:00\)/);
      expect((await raise(tok.dev, "2026-09-14", "OUT", "18:30")).status).toBe(400); // that day already has a later punch (a time out must come after the last punch)
    });

    it("raising one: the manager (who holds the key) is notified; Tasks, Request Hub and the Admin Home counts show it", async () => {
      const res = await raise(tok.dev, "2026-09-15", "OUT", "19:00");
      expect(res.status).toBe(201);
      devRequest = res.body.id;
      expect((await raise(tok.dev, "2026-09-15", "OUT", "19:05")).status).toBe(409); // one open request per day
      const note = await prisma.notification.findFirst({ where: { userId: p.mgr.userId, type: "regularization.submitted" } });
      expect(note?.title).toMatch(/Forgot to punch/);
      const tasks = await request(app).get("/api/tasks/mine").set(...authHeader(tok.mgr));
      expect(tasks.body.map((t: { id: string }) => t.id)).toContain(devRequest);
      const hub = await request(app).get("/api/request-hub").set(...authHeader(tok.dev));
      expect(hub.body.find((i: { id: string }) => i.id === devRequest)).toMatchObject({ type: "REGULARIZATION", statusLabel: "Waiting for approval" });
      const counts = await getTaskCounts({ employeeId: p.mgr.employeeId, roleCodes: ["MANAGER"], dataScope: "TEAM", permissions: new Set(["attendance.regularization.approve", "attendance.regularization.view"]) });
      expect(counts.review.byType).toContainEqual({ type: "REGULARIZATION", label: "Attendance Regularization", count: 1 });
      outsiderRequest = (await raise(tok.outsider, "2026-09-15", "OUT", "18:30")).body.id;
      mgrRequest = (await raise(tok.mgr, "2026-09-15", "OUT", "19:10")).body.id;
      expect(outsiderRequest && mgrRequest).toBeTruthy();
    });

    it("a pending request blocks finalising its period", async () => {
      expect((await finalisationBlockers("2026-09-01", "2026-09-30")).map((b) => b.code)).toContain("PENDING_REGULARIZATIONS");
    });

    it("the manager's queue holds their team only, never their own; HR sees everyone's", async () => {
      const mine = (await as(tok.mgr).get("/regularizations?status=PENDING")).body.requests.map((r: { id: string }) => r.id);
      expect(mine).toContain(devRequest);
      expect(mine).not.toContain(outsiderRequest);
      expect(mine).not.toContain(mgrRequest);
      const hrs = (await as(tok.hr).get("/regularizations?status=PENDING")).body.requests;
      expect(hrs.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([devRequest, outsiderRequest, mgrRequest]));
      expect(hrs.find((r: { id: string }) => r.id === devRequest)).toMatchObject({ punches: { count: 1, firstIn: "10:02", lastOut: null }, reasonCode: "FORGOT_TO_PUNCH", outTime: "19:00", correctionText: "Out 19:00", dayStatus: "A", canDecide: true });
      expect((await as(tok.emp).get("/regularizations")).status).toBe(403);
    });

    it("deciding: an outsider's request is a 404 to the manager; their own is refused; an employee can't decide at all", async () => {
      expect((await as(tok.mgr).post(`/regularizations/${outsiderRequest}/approve`)).status).toBe(404);
      expect((await as(tok.mgr).post(`/regularizations/${mgrRequest}/approve`)).status).toBe(403);
      expect((await as(tok.dev).post(`/regularizations/${devRequest}/approve`)).status).toBe(403);
      expect((await prisma.regularizationRequest.findUniqueOrThrow({ where: { id: outsiderRequest } })).status).toBe("PENDING");
    });

    it("approval recomputes the day with the corrected time and an override marker; the raw punch is untouched", async () => {
      const res = await as(tok.mgr).post(`/regularizations/${devRequest}/approve`, { note: "Confirmed, he left with me" });
      expect(res.status).toBe(200);
      expect(await dayRow(p.dev, "2026-09-15")).toMatchObject({ status: "P", lateInMinutes: 2, exceptionFlags: ["LATE_IN"], source: "OVERRIDE", overrideKind: "REGULARIZATION", overrideRef: expect.any(String), firstIn: ist("2026-09-15", "10:02"), lastOut: ist("2026-09-15", "19:00"), punchCount: 1 });
      expect(await prisma.rawPunch.count({ where: { employeeId: p.dev.employeeId, businessDate: d("2026-09-15") } })).toBe(1);
      const month = (await as(tok.dev).get("/me/month?month=2026-09")).body;
      expect(month.days.find((x: { date: string }) => x.date === "2026-09-15")).toMatchObject({ code: "P", corrected: true, request: { status: "APPROVED" } });
      const day = (await as(tok.dev).get("/me/day/2026-09-15")).body;
      expect(day.override).toMatchObject({ origin: "REGULARIZATION", kind: "ADD_TIME", text: "Out 19:00", by: expect.any(String), requestId: devRequest });
      expect(day.canRequest).toMatchObject({ ok: false, code: "ALREADY_CORRECTED", reason: "This day has already been corrected." });
      expect(await prisma.notification.count({ where: { userId: p.dev.userId, type: "regularization.decided" } })).toBe(1);
      expect((await as(tok.mgr).post(`/regularizations/${devRequest}/approve`)).status).toBe(409);
      expect(await prisma.auditLog.count({ where: { entityId: devRequest, action: "attendance.regularization.approved" } })).toBe(1);
    });

    it("HR rejects with a note: the day stays absent, and the employee may ask again", async () => {
      const res = await as(tok.hr).post(`/regularizations/${outsiderRequest}/reject`, { note: "Security log shows you left at 15:00" });
      expect(res.status).toBe(200);
      expect(await dayRow(p.outsider, "2026-09-15")).toMatchObject({ status: "A", overrideKind: null });
      expect((await raise(tok.outsider, "2026-09-15", "OUT", "15:00", "Left at 3 pm for a doctor's visit")).status).toBe(201);
    });

    it("the employee can cancel a request still waiting", async () => {
      const r = await raise(tok.dev, "2026-09-17", "OUT", "19:00");
      expect((await as(tok.dev).post(`/me/regularizations/${r.body.id}/cancel`)).body.status).toBe("CANCELLED");
      expect((await as(tok.dev).post(`/me/regularizations/${r.body.id}/cancel`)).status).toBe(409);
      expect((await as(tok.outsider).post(`/me/regularizations/${r.body.id}/cancel`)).status).toBe(404);
    });
  });

  it("Who Is In? today: arrived (with lateness), not yet arrived, away, and manual capture shown as manual", async () => {
    const res = await as(tok.hr).get(`/who-is-in?locationId=${org.locationId}`);
    expect(res.status).toBe(200);
    const where = (who: Person) => (["arrived", "notArrived", "away", "manual"] as const).find((g) => res.body[g].some((x: { employeeId: string }) => x.employeeId === who.employeeId));
    expect(where(p.dev)).toBe("arrived");
    expect(res.body.arrived.find((x: { employeeId: string }) => x.employeeId === p.dev.employeeId)).toMatchObject({ time: "10:20", lateInMinutes: 20 });
    expect(where(p.mgr)).toBe("notArrived");
    expect(where(p.onLeave)).toBe("away");
    expect(where(p.manual)).toBe("manual");
    expect(res.body.manual.find((x: { employeeId: string }) => x.employeeId === p.manual.employeeId)).toMatchObject({ state: "NOT_MARKED" });
    expect(where(p.outsider)).toBeUndefined(); // another branch, filtered out
    expect((await as(tok.mgr).get("/who-is-in")).status).toBe(403);
  });
});
