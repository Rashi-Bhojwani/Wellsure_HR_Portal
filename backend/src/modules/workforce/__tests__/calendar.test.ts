import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { computeAttendance } from "../../attendance/compute";
import { holidayApplies } from "../calendar";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G4 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 9b, 10, 11): location-limited holidays and weekend overrides as the engine reads them, and leave type
// reviewers. Fake clock: "today" is Wed 30 Sep 2026.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const HOLIDAY = "2026-09-16"; // a Wednesday
const SUNDAY = "2026-09-20";
const MONDAY = "2026-09-21";

describe("A-10 G4 — the pure rule", () => {
  it("a holiday with no locations is for everyone; otherwise only for someone placed at one of them", () => {
    expect(holidayApplies(null, "L1")).toBe(true);
    expect(holidayApplies([], null)).toBe(true);
    expect(holidayApplies(["L1"], "L1")).toBe(true);
    expect(holidayApplies(["L1"], "L2")).toBe(false);
    expect(holidayApplies(["L1"], null)).toBe(false);
  });
});

describe("A-10 G4 — over the routes and the engine", () => {
  let orgA: TestOrgMasters;
  let orgB: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let holidayId = "";
  let patternId = "";
  let leaveTypeId = "";
  let requestId = "";
  const weekendIds: string[] = [];
  const reviewerIds: string[] = [];
  const call = (who: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);
  const status = async (e: Person, date: string) => (await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: e.employeeId, date: d(date) } } }))?.status ?? null;

  beforeAll(async () => {
    setBusinessTodayForTests(d("2026-09-30"));
    [orgA, orgB] = await Promise.all([createEmployeeTestOrgMasters(), createEmployeeTestOrgMasters()]);
    p.director = await createFullTestEmployee(orgA, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(orgA, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(orgA, { roleCode: DEVELOPER_ROLE_CODE });
    p.mgr = await createFullTestEmployee(orgA, { roleCode: "MANAGER" });
    p.a = await createFullTestEmployee(orgA, { managerId: p.mgr.employeeId }); // a direct report: the manager then holds leave.approve
    p.b = await createFullTestEmployee(orgB);
    for (const key of ["leave.approve", "leave.view"]) {
      const perm = await prisma.permission.findUniqueOrThrow({ where: { key } });
      await prisma.userPermissionOverride.create({ data: { userId: p.mgr.userId, permissionId: perm.id, effect: "GRANT", reason: "A-10 G4 test", createdByUserId: p.director.userId } });
    }
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    holidayId = (await prisma.holiday.create({ data: { date: d(HOLIDAY), name: "A-10 G4 test holiday" } })).id;
    patternId = (await prisma.weekOffPattern.create({ data: { code: `G4MON${Date.now().toString(36).slice(-4)}`, name: "A-10 G4 Monday off", rules: [{ weekday: 1 }] } })).id;
    leaveTypeId = (await prisma.leaveType.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })).id;
    requestId = (await prisma.leaveRequest.create({ data: { employeeId: p.b.employeeId, leaveTypeId, fromDate: d("2026-10-20"), toDate: d("2026-10-20"), totalDays: 1, status: "PENDING", appliedByUserId: p.b.userId } })).id;
  }, 180_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await deleteWithDependents("LeaveTypeReviewer", reviewerIds);
    await deleteWithDependents("WeekendOverride", weekendIds);
    await deleteWithDependents("HolidayLocationScope", (await prisma.holidayLocationScope.findMany({ where: { holidayId }, select: { id: true } })).map((r) => r.id));
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Holiday", [holidayId]);
    await deleteWithDependents("WeekOffPattern", [patternId]);
    await cleanupEmployeeTestOrgMasters(orgA);
    await cleanupEmployeeTestOrgMasters(orgB);
  }, 180_000);

  it("a holiday limited to one location is a holiday there only; the change needs leave.policy.manage and a reason", async () => {
    await computeAttendance([p.a!.employeeId, p.b!.employeeId], HOLIDAY, HOLIDAY);
    expect(await status(p.a!, HOLIDAY)).toBe("H");
    expect(await status(p.b!, HOLIDAY)).toBe("H");
    for (const who of ["dev", "a", "mgr"]) expect((await call(who, "put", `/api/workforce/holidays/${holidayId}/locations`, { locationIds: [orgA.locationId], reason: "branch only" })).status, who).toBe(403);
    expect((await call("hr", "put", `/api/workforce/holidays/${holidayId}/locations`, { locationIds: [orgA.locationId] })).status).toBe(400);
    const set = await call("hr", "put", `/api/workforce/holidays/${holidayId}/locations`, { locationIds: [orgA.locationId], reason: "branch festival" });
    expect(set.status).toBe(200);
    await computeAttendance([p.a!.employeeId, p.b!.employeeId], HOLIDAY, HOLIDAY);
    expect(await status(p.a!, HOLIDAY)).toBe("H");
    expect(await status(p.b!, HOLIDAY)).not.toBe("H");
    const view = await call("hr", "get", "/api/workforce/holidays/locations");
    expect(view.body.locations[holidayId]).toEqual([orgA.locationId]);
    // back to everyone: an empty list
    await call("hr", "put", `/api/workforce/holidays/${holidayId}/locations`, { locationIds: [], reason: "company-wide again" });
    await computeAttendance([p.b!.employeeId], HOLIDAY, HOLIDAY);
    expect(await status(p.b!, HOLIDAY)).toBe("H");
    await expect(prisma.holidayLocationScope.updateMany({ where: { holidayId }, data: { reason: "x" } })).rejects.toThrow(/HOLIDAY_SCOPE_APPEND_ONLY/);
  });

  it("a weekend override swaps the person's week-off for its days only; voiding it puts the pattern back", async () => {
    await computeAttendance([p.a!.employeeId], SUNDAY, MONDAY);
    expect(await status(p.a!, SUNDAY)).toBe("O");
    expect(await status(p.a!, MONDAY)).not.toBe("O");
    for (const who of ["dev", "a", "mgr"]) expect((await call(who, "post", "/api/workforce/weekend-overrides", { fromDate: SUNDAY, toDate: MONDAY, weekOffPatternId: patternId, employeeIds: [p.a!.employeeId], reason: "swap" })).status, who).toBe(403);
    const made = await call("hr", "post", "/api/workforce/weekend-overrides", { fromDate: SUNDAY, toDate: MONDAY, weekOffPatternId: patternId, employeeIds: [p.a!.employeeId], reason: "worked the Sunday" });
    expect(made.status).toBe(201);
    weekendIds.push(made.body.id);
    await computeAttendance([p.a!.employeeId], SUNDAY, MONDAY);
    expect(await status(p.a!, SUNDAY)).not.toBe("O");
    expect(await status(p.a!, MONDAY)).toBe("O");
    expect((await call("hr", "post", "/api/workforce/weekend-overrides", { fromDate: SUNDAY, toDate: SUNDAY, weekOffPatternId: patternId, employeeIds: [p.hr!.employeeId], reason: "mine" })).status).toBe(403);
    await call("hr", "post", `/api/workforce/weekend-overrides/${made.body.id}/void`, { reason: "entered in error" });
    await computeAttendance([p.a!.employeeId], SUNDAY, MONDAY);
    expect(await status(p.a!, SUNDAY)).toBe("O");
    await expect(prisma.weekendOverride.delete({ where: { id: made.body.id } })).rejects.toThrow(/WEEKEND_OVERRIDE_APPEND_ONLY/);
  });

  it("a leave type reviewer may decide that type for the people named; only directors name one; the request is otherwise out of reach", async () => {
    expect((await call("mgr", "get", `/api/leave/requests/${requestId}`)).status).toBe(404);
    for (const who of ["hr", "dev", "a", "mgr"]) {
      expect((await call(who, "post", "/api/workforce/leave-reviewers", { leaveTypeId, reviewerEmployeeId: p.mgr!.employeeId, locationId: orgB.locationId, reason: "covers branch B" })).status, who).toBe(403);
      expect((await call(who, "get", "/api/workforce/leave-reviewers")).status, who).toBe(403);
    }
    const made = await call("director", "post", "/api/workforce/leave-reviewers", { leaveTypeId, reviewerEmployeeId: p.mgr!.employeeId, locationId: orgB.locationId, reason: "covers branch B" });
    expect(made.status).toBe(201);
    reviewerIds.push(made.body.id);
    expect((await call("mgr", "get", `/api/leave/requests/${requestId}`)).status).toBe(200);
    const queue = await call("mgr", "get", "/api/leave/requests?status=PENDING");
    expect(JSON.stringify(queue.body)).toContain(requestId);
    expect((await call("mgr", "post", `/api/leave/requests/${requestId}/reject`, { comments: "not this week" })).status).toBe(200);
    // a reviewer for another location does not reach B
    await call("director", "post", `/api/workforce/leave-reviewers/${made.body.id}/void`, { reason: "moved" });
    const other = await call("director", "post", "/api/workforce/leave-reviewers", { leaveTypeId, reviewerEmployeeId: p.mgr!.employeeId, locationId: orgA.locationId, reason: "branch A only" });
    reviewerIds.push(other.body.id);
    expect((await call("mgr", "get", `/api/leave/requests/${requestId}`)).status).toBe(404);
    expect((await call("mgr", "post", `/api/leave/requests/${requestId}/reject`, { comments: "no" })).status).toBe(404);
  });
});
