import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { assertNotLocked, lockHit } from "../locks";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// A-10 G3 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 7): attendance activity locks. Every lock here is for a segment of this file's own people, never
// everyone, so no other test is affected. Fake clock: "today" is Wed 30 Sep 2026.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const TODAY = "2026-09-30";

describe("A-10 G3 — the pure rule", () => {
  const base = { id: "L", effectiveFrom: "2026-09-01", fromDate: "2026-10-05", toDate: "2026-10-09", categories: ["LEAVE"], employeeIds: ["e1"], voided: false };
  it("hits only an in-force, unvoided lock for the category, the person and an overlapping range (open-ended ranges overlap anything later)", () => {
    expect(lockHit([base], "LEAVE", "e1", "2026-10-09", "2026-10-12", TODAY)?.id).toBe("L");
    expect(lockHit([base], "LEAVE", "e1", "2026-10-10", "2026-10-12", TODAY)).toBeNull();
    expect(lockHit([base], "LEAVE", "e1", "2026-10-01", "2026-10-04", TODAY)).toBeNull();
    expect(lockHit([base], "LEAVE", "e1", "2026-10-01", null, TODAY)?.id).toBe("L");
    expect(lockHit([base], "MUSTER", "e1", "2026-10-06", "2026-10-06", TODAY)).toBeNull();
    expect(lockHit([base], "LEAVE", "e2", "2026-10-06", "2026-10-06", TODAY)).toBeNull();
    expect(lockHit([{ ...base, employeeIds: [] }], "LEAVE", "e2", "2026-10-06", "2026-10-06", TODAY)?.id).toBe("L");
    expect(lockHit([{ ...base, voided: true }], "LEAVE", "e1", "2026-10-06", "2026-10-06", TODAY)).toBeNull();
    expect(lockHit([{ ...base, effectiveFrom: "2026-10-01" }], "LEAVE", "e1", "2026-10-06", "2026-10-06", TODAY)).toBeNull();
  });
  it("agrees with an independent day-by-day model on random ranges", () => {
    const days = (a: string, b: string) => {
      const out: string[] = [];
      for (let t = d(a).getTime(); t <= d(b).getTime(); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
      return out;
    };
    let seed = 7;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const at = (n: number) => new Date(Date.UTC(2026, 9, 1 + n)).toISOString().slice(0, 10);
    for (let i = 0; i < 400; i += 1) {
      const [a, b] = [rnd(40), rnd(40)].sort((x, y) => x - y);
      const [c, e] = [rnd(40), rnd(40)].sort((x, y) => x - y);
      const lock = { ...base, fromDate: at(a!), toDate: at(b!) };
      const lockDays = new Set(days(lock.fromDate, lock.toDate));
      const independent = days(at(c!), at(e!)).some((x) => lockDays.has(x));
      expect(lockHit([lock], "LEAVE", "e1", at(c!), at(e!), TODAY) !== null, `${lock.fromDate}..${lock.toDate} vs ${at(c!)}..${at(e!)}`).toBe(independent);
    }
  });
});

describe("A-10 G3 — locks over the routes", () => {
  let org: TestOrgMasters;
  const p: Record<string, Person> = {};
  const tok: Record<string, string> = {};
  let segmentId = "";
  let leaveTypeId = "";
  const lockIds: string[] = [];
  const call = (who: string, method: "get" | "post", path: string, body?: object) => request(app)[method](path).set(...authHeader(tok[who]!)).send(body);

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    p.emp = await createFullTestEmployee(org);
    for (const k of Object.keys(p)) tok[k] = await loginAs(p[k]!.employeeCode);
    segmentId = (await prisma.employeeSegment.create({ data: { name: "A-10 G3 test segment", kind: "LIST", ownerUserId: p.director.userId, members: { create: [{ employeeId: p.emp.employeeId }] } } })).id;
    leaveTypeId = (await prisma.leaveType.findFirstOrThrow({ where: { isActive: true }, select: { id: true } })).id;
  }, 120_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await deleteWithDependents("AttendanceLock", lockIds);
    await deleteWithDependents("EmployeeSegment", [segmentId]);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  const body = { effectiveFrom: TODAY, fromDate: "2026-10-05", toDate: "2026-10-09", categories: ["LEAVE", "MUSTER"], reason: "month-end checks" };

  it("only a director sets or lists a lock; HR, the Developer role, an employee and no sign-in are refused; a reason is required", async () => {
    for (const who of ["hr", "dev", "emp"]) {
      expect((await call(who, "post", "/api/workforce/locks", { ...body, segmentId })).status, who).toBe(403);
      expect((await call(who, "get", "/api/workforce/locks")).status, who).toBe(403);
    }
    expect((await request(app).get("/api/workforce/locks")).status).toBe(401);
    expect((await call("director", "post", "/api/workforce/locks", { ...body, segmentId, reason: "" })).status).toBe(400);
    expect((await call("director", "post", "/api/workforce/locks", { ...body, segmentId, fromDate: "2026-10-10" })).status).toBe(400);
  });

  it("a lock refuses leave inside its range for its people, not outside it; a director is not stopped; voiding lifts it; voiding twice is refused", async () => {
    const made = await call("director", "post", "/api/workforce/locks", { ...body, segmentId });
    expect(made.status).toBe(201);
    lockIds.push(made.body.id);
    expect(made.body).toMatchObject({ people: 1, everyone: false, state: "IN_FORCE", segmentName: "A-10 G3 test segment" });

    const inside = await call("emp", "post", "/api/leave/requests", { leaveTypeId, fromDate: "2026-10-08", toDate: "2026-10-12" });
    expect(inside.status).toBe(409);
    expect(inside.body.error.code).toBe("ATTENDANCE_LOCKED");
    const outside = await call("emp", "post", "/api/leave/requests", { leaveTypeId, fromDate: "2026-10-12", toDate: "2026-10-12" });
    expect(outside.body?.error?.code).not.toBe("ATTENDANCE_LOCKED");
    // The guard itself: a director passes, HR does not.
    await expect(assertNotLocked("MUSTER", p.director!.userId, [{ employeeId: p.emp!.employeeId, from: "2026-10-06", to: "2026-10-06" }])).resolves.toBeUndefined();
    await expect(assertNotLocked("MUSTER", p.hr!.userId, [{ employeeId: p.emp!.employeeId, from: "2026-10-06", to: "2026-10-06" }])).rejects.toMatchObject({ code: "ATTENDANCE_LOCKED" });
    await expect(assertNotLocked("ROSTER", p.hr!.userId, [{ employeeId: p.emp!.employeeId, from: "2026-10-06", to: null }])).resolves.toBeUndefined(); // not a locked category

    expect((await call("hr", "post", `/api/workforce/locks/${made.body.id}/void`, { reason: "done" })).status).toBe(403);
    const voided = await call("director", "post", `/api/workforce/locks/${made.body.id}/void`, { reason: "checks done" });
    expect(voided.body.state).toBe("VOID");
    expect((await call("director", "post", `/api/workforce/locks/${made.body.id}/void`, { reason: "again" })).status).toBe(409);
    await expect(assertNotLocked("MUSTER", p.hr!.userId, [{ employeeId: p.emp!.employeeId, from: "2026-10-06", to: "2026-10-06" }])).resolves.toBeUndefined();
    const audits = await prisma.auditLog.count({ where: { entityType: "AttendanceLock", entityId: made.body.id } });
    expect(audits).toBe(2);
  });

  it("a lock with a later effective date is not in force yet", async () => {
    const made = await call("director", "post", "/api/workforce/locks", { ...body, segmentId, effectiveFrom: "2026-10-02" });
    lockIds.push(made.body.id);
    expect(made.body.state).toBe("SCHEDULED");
    await expect(assertNotLocked("LEAVE", p.hr!.userId, [{ employeeId: p.emp!.employeeId, from: "2026-10-06", to: "2026-10-06" }])).resolves.toBeUndefined();
  });

  it("the database refuses a delete and any change but a single void", async () => {
    const id = lockIds[0]!;
    await expect(prisma.attendanceLock.delete({ where: { id } })).rejects.toThrow(/ATTENDANCE_LOCK_APPEND_ONLY/);
    await expect(prisma.attendanceLock.update({ where: { id }, data: { voidReason: "rewritten" } })).rejects.toThrow(/ATTENDANCE_LOCK_APPEND_ONLY/);
    const open = lockIds[1]!;
    await expect(prisma.attendanceLock.update({ where: { id: open }, data: { toDate: d("2026-12-31") } })).rejects.toThrow(/ATTENDANCE_LOCK_APPEND_ONLY/);
  });
});
