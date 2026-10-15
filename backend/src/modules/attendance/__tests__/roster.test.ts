import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// Shift Roster (Phase 3 commit 2): forward only, through the effective-dated writers; a rotation repeats; regenerating
// replaces what was scheduled from the start date; all or nothing. "Today" is Wed 30 Sep 2026.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const tag = Date.now().toString(36).slice(-5);

describe("Shift Roster (Phase 3 commit 2)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"a" | "b" | "c" | "d" | "e1" | "e2" | "gone" | "hr" | "exec", Person>;
  const tok = {} as Record<"hr" | "exec", string>;
  const shiftIds: string[] = [];
  let s1 = "";
  let s2 = "";

  const hr = () => ({ post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(tok.hr)).send(b) });
  const body = (who: Person[], over: object = {}) => ({
    selection: { employeeIds: who.map((x) => x.employeeId) },
    start: "2026-10-05",
    steps: [{ shiftId: s1, days: 1 }],
    repeat: false,
    then: "RETURN",
    note: "October roster",
    ...over,
  });
  const confirm = async (b: ReturnType<typeof body>) => {
    const preview = await hr().post("/roster/preview", b);
    expect(preview.status).toBe(200);
    return hr().post("/roster", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
  };
  const history = async (who: Person) =>
    (await prisma.attendanceAssignment.findMany({ where: { employeeId: who.employeeId }, orderBy: { effectiveFrom: "asc" }, include: { shift: { select: { code: true } } } })).map((r) => `${r.effectiveFrom.toISOString().slice(0, 10)}:${r.shift.code}:${r.effectiveTo ? r.effectiveTo.toISOString().slice(0, 10) : "open"}`);
  const makeShift = async (code: string, start: string, end: string, mid: [string, string]) => {
    const s = await prisma.shift.create({
      data: { code, name: `Roster test ${code}`, startTime: start, endTime: end, sessions: { create: [{ sortOrder: 1, kind: "WORK", label: "A", startTime: start, endTime: mid[0] }, { sortOrder: 2, kind: "BREAK", label: "Meal", startTime: mid[0], endTime: mid[1] }, { sortOrder: 3, kind: "WORK", label: "B", startTime: mid[1], endTime: end }] } },
    });
    shiftIds.push(s.id);
    return s.id;
  };

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    for (const k of ["a", "b", "c", "d", "e1", "e2", "gone"] as const) p[k] = await createFullTestEmployee(org);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    for (const k of ["hr", "exec"] as const) tok[k] = await loginAs(p[k].employeeCode);
    s1 = await makeShift(`R1${tag}`, "06:00", "15:00", ["10:00", "10:30"]);
    s2 = await makeShift(`R2${tag}`, "14:00", "23:00", ["18:00", "18:30"]);
    // "gone" has left: their assignment history is closed.
    await prisma.attendanceAssignment.updateMany({ where: { employeeId: p.gone.employeeId }, data: { effectiveTo: d("2026-09-20") } });
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    const ids = Object.values(p).map((x) => x.employeeId);
    await purgeAppendOnly("AuditLog", { entityId: { in: ids }, action: "attendance.roster.generated" });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Shift", shiftIds);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("is for attendance.config.manage only", async () => {
    expect((await request(app).post("/api/attendance/roster/preview").set(...authHeader(tok.exec)).send(body([p.a]))).status).toBe(403);
  });

  it("is forward only: today and earlier days are refused, pointing at Shift Override; so is beyond the scheduling limit", async () => {
    for (const start of [TODAY, "2026-09-01"]) {
      const res = await hr().post("/roster/preview", body([p.a], { start }));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("NOT_FORWARD");
      expect(res.body.error.message).toContain("Shift Override");
    }
    expect((await hr().post("/roster/preview", body([p.a], { start: "2028-01-01" }))).body.error.code).toBe("HISTORY_TOO_FAR_AHEAD");
  });

  it("previews who changes to what, and leaves out the actor, someone who has left, and anyone without a history", async () => {
    const res = await hr().post("/roster/preview", body([p.a, p.gone, p.hr]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ people: 1, changes: 1 });
    expect(res.body.rows[0]).toMatchObject({ employeeCode: p.a.employeeCode, currentShift: "GEN", segments: [{ from: "2026-10-05", shift: `R1${tag}` }] });
    const reasons = Object.fromEntries(res.body.cannotRoster.map((g: { code: string; count: number }) => [g.code, g.count]));
    expect(reasons).toEqual({ HISTORY_CLOSED: 1, OWN_ATTENDANCE: 1 });
    expect(await history(p.a)).toHaveLength(1); // a preview writes nothing
  });

  it("assigns a shift from a date: an effective-dated change, one audit row per person, nothing in the past changes", async () => {
    const res = await confirm(body([p.a, p.b]));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ people: 2, changes: 2 });
    for (const x of [p.a, p.b]) {
      const h = await history(x);
      expect(h).toEqual([expect.stringMatching(/:GEN:2026-10-05$/), `2026-10-05:R1${tag}:open`]);
      expect(await prisma.auditLog.count({ where: { action: "attendance.roster.generated", entityId: x.employeeId } })).toBe(1);
    }
  });

  it("generates a rotation that repeats until the end date, then returns people to their previous shift", async () => {
    const res = await confirm(body([p.c, p.d], { steps: [{ shiftId: s1, days: 7 }, { shiftId: s2, days: 7 }], repeat: true, until: "2026-11-01", then: "RETURN" }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ people: 2, changes: 10 });
    for (const x of [p.c, p.d]) {
      expect(await history(x)).toEqual([
        expect.stringMatching(/:GEN:2026-10-05$/),
        `2026-10-05:R1${tag}:2026-10-12`,
        `2026-10-12:R2${tag}:2026-10-19`,
        `2026-10-19:R1${tag}:2026-10-26`,
        `2026-10-26:R2${tag}:2026-11-02`,
        "2026-11-02:GEN:open",
      ]);
    }
  });

  it("'stay' keeps the last shift instead of returning", async () => {
    const res = await hr().post("/roster/preview", body([p.e1], { steps: [{ shiftId: s1, days: 7 }, { shiftId: s2, days: 7 }], repeat: true, until: "2026-10-18", then: "STAY" }));
    expect(res.body.rows[0].segments).toEqual([{ from: "2026-10-05", shift: `R1${tag}` }, { from: "2026-10-12", shift: `R2${tag}` }]);
  });

  it("regenerating replaces what was scheduled from the start date and leaves earlier scheduled changes alone", async () => {
    const b = body([p.c, p.d], { start: "2026-10-19", steps: [{ shiftId: s2, days: 1 }] });
    const preview = await hr().post("/roster/preview", b);
    expect(preview.body).toMatchObject({ people: 2, changes: 2, replacedScheduled: 6 });
    expect(preview.body.rows[0].replaces).toEqual([{ from: "2026-10-19", shift: `R1${tag}` }, { from: "2026-10-26", shift: `R2${tag}` }, { from: "2026-11-02", shift: "GEN" }]);
    expect((await hr().post("/roster", { ...b, fingerprint: preview.body.fingerprint, confirm: true })).status).toBe(200);
    for (const x of [p.c, p.d]) {
      expect(await history(x)).toEqual([expect.stringMatching(/:GEN:2026-10-05$/), `2026-10-05:R1${tag}:2026-10-12`, `2026-10-12:R2${tag}:2026-10-19`, `2026-10-19:R2${tag}:open`]);
    }
  });

  it("is all or nothing: if one person's write fails, nobody's schedule changes", async () => {
    await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION roster_test_fail() RETURNS trigger AS $$ BEGIN IF NEW.employee_id = '${p.e2.employeeId}' THEN RAISE EXCEPTION 'ROSTER_TEST_FAILURE'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER roster_test_fail BEFORE INSERT ON attendance_assignments FOR EACH ROW EXECUTE FUNCTION roster_test_fail()`);
    try {
      const b = body([p.e1, p.e2]);
      const preview = await hr().post("/roster/preview", b);
      expect(preview.body.people).toBe(2);
      const res = await hr().post("/roster", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(await history(p.e1)).toHaveLength(1);
      expect(await history(p.e2)).toHaveLength(1);
      expect(await prisma.auditLog.count({ where: { action: "attendance.roster.generated", entityId: { in: [p.e1.employeeId, p.e2.employeeId] } } })).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe("DROP TRIGGER IF EXISTS roster_test_fail ON attendance_assignments");
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS roster_test_fail()");
    }
  });

  it("refuses a confirmation for a set that changed since the preview", async () => {
    const b = body([p.e1]);
    const preview = await hr().post("/roster/preview", b);
    expect((await confirm(body([p.e1], { start: "2026-10-07", steps: [{ shiftId: s2, days: 1 }] }))).status).toBe(200); // someone else rostered them meanwhile
    const stale = await hr().post("/roster", { ...b, fingerprint: preview.body.fingerprint, confirm: true });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe("SELECTION_CHANGED");
  });

  it("refuses a rotation that would need an unreasonable number of shift changes", async () => {
    const res = await hr().post("/roster/preview", body([p.a], { start: "2026-12-01", steps: [{ shiftId: s1, days: 1 }, { shiftId: s2, days: 1 }], repeat: true, until: "2027-06-01", then: "STAY" }));
    expect(res.body.people).toBe(0);
    expect(res.body.cannotRoster[0]).toMatchObject({ code: "TOO_MANY_CHANGES", count: 1 });
  });

  it("a repeating rotation needs an end date, and 'return' must leave room before the scheduling limit", async () => {
    expect((await hr().post("/roster/preview", body([p.a], { repeat: true, steps: [{ shiftId: s1, days: 7 }, { shiftId: s2, days: 7 }] }))).status).toBe(400);
    const late = await hr().post("/roster/preview", body([p.a], { repeat: true, steps: [{ shiftId: s1, days: 7 }, { shiftId: s2, days: 7 }], until: "2027-10-01", then: "RETURN" }));
    expect(late.body.error.code).toBe("HISTORY_TOO_FAR_AHEAD");
  });
});
