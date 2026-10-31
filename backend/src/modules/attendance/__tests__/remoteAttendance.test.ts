import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { REMINDER_HOURS_KEY, SUGGESTED_OUTCOME_KEY, sendDueReminders } from "../remote/service";

// Stage 5a: remote attendance. A director marks who works remotely; they check in and out (a server-stamped time, nothing else); the directors alone decide a full day,
// a half day, or a rejection with a reason and an outcome; a director never decides their own; the decision reaches the month view through the engine's override path.

type Person = { employeeId: string; employeeCode: string; userId: string };
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const CHECK_DAY = "2026-09-30"; // a Wednesday
const AFTER = "2026-10-01";

describe("remote attendance", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"dirA" | "dirB" | "hr" | "dev" | "r1" | "r2" | "r3" | "r4" | "plain", Person>;
  const tok = {} as Record<keyof typeof p, string>;
  const marksMade: string[] = [];
  const settingsBefore: Record<string, unknown> = {};
  const get = (path: string, who: keyof typeof p) => request(app).get(`/api/attendance${path}`).set(...authHeader(tok[who]));
  const post = (path: string, body: object, who: keyof typeof p) => request(app).post(`/api/attendance${path}`).set(...authHeader(tok[who])).send(body);
  const put = (path: string, body: object, who: keyof typeof p) => request(app).put(`/api/attendance${path}`).set(...authHeader(tok[who])).send(body);
  const rec = (who: Person) => prisma.remoteAttendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(CHECK_DAY) } } });
  const dayRow = (who: Person) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(CHECK_DAY) } } });
  const worked = async (who: keyof typeof p) => {
    expect((await post("/me/remote/check-in", {}, who)).status).toBe(201);
    expect((await post("/me/remote/check-out", {}, who)).status).toBe(200);
  };

  beforeAll(async () => {
    setBusinessTodayForTests(d(CHECK_DAY));
    org = await createEmployeeTestOrgMasters();
    p.dirA = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.dirB = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.dev = await createFullTestEmployee(org, { roleCode: DEVELOPER_ROLE_CODE });
    for (const k of ["r1", "r2", "r3", "r4", "plain"] as const) p[k] = await createFullTestEmployee(org);
    for (const k of Object.keys(p) as Array<keyof typeof p>) tok[k] = await loginAs(p[k].employeeCode);
    for (const key of [REMINDER_HOURS_KEY, SUGGESTED_OUTCOME_KEY]) settingsBefore[key] = (await prisma.systemSetting.findUnique({ where: { key } }))?.value ?? null;
  }, 120_000);

  afterAll(async () => {
    setBusinessTodayForTests(null);
    for (const [key, value] of Object.entries(settingsBefore)) {
      if (value === null) await prisma.systemSetting.deleteMany({ where: { key } });
      else await prisma.systemSetting.update({ where: { key }, data: { value: value as never } });
    }
    const ids = Object.values(p).map((x) => x.employeeId);
    const overrideIds = (await prisma.attendanceOverride.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    const recordIds = (await prisma.remoteAttendanceRecord.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...overrideIds, ...recordIds, ...marksMade] } });
    await deleteWithDependents("RemoteAttendanceRecord", recordIds);
    await deleteWithDependents("RemoteWorkMark", (await prisma.remoteWorkMark.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((r) => r.id));
    await deleteWithDependents("AttendanceOverride", overrideIds);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("nobody is remote by default, and a person who is not marked cannot check in", async () => {
    expect((await get("/remote/marks", "dirA")).body.people).toEqual([]);
    const today = await get("/me/remote/today", "r1");
    expect([today.status, today.body.remote, today.body.canCheckIn]).toEqual([200, false, false]);
    const refused = await post("/me/remote/check-in", {}, "r1");
    expect([refused.status, refused.body.error.code]).toEqual([403, "NOT_REMOTE"]);
  });

  it("only a director marks someone remote, with a date and a reason; the database holds it too", async () => {
    const body = (who: Person, over: object = {}) => ({ employeeId: who.employeeId, effectiveFrom: "2026-09-01", remote: true, reason: "Works from another city", ...over });
    for (const who of ["hr", "dev", "r1", "plain"] as const) expect((await post("/remote/marks", body(p.r1), who)).status, who).toBe(403);
    expect((await post("/remote/marks", body(p.r1, { reason: "x" }), "dirA")).status).toBe(400);
    expect((await post("/remote/marks", body(p.r1, { extra: 1 }), "dirA")).status).toBe(400);
    expect((await post("/remote/marks", body(p.r1, { effectiveFrom: "1 Sep" }), "dirA")).status).toBe(400);
    for (const who of [p.r1, p.r2, p.r3, p.r4, p.dirA]) {
      const r = await post("/remote/marks", body(who), "dirA");
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      marksMade.push(r.body.id);
    }
    await expect(prisma.remoteWorkMark.create({ data: { employeeId: p.plain.employeeId, effectiveFrom: d("2026-09-01"), remote: true, reason: "sneaky", markedByUserId: p.hr.userId } })).rejects.toThrow(/REMOTE_MARKS_DIRECTORS_ONLY/);
    await expect(prisma.remoteWorkMark.update({ where: { id: marksMade[0]! }, data: { remote: false } })).rejects.toThrow(/REMOTE_APPEND_ONLY/);
    const list = await get("/remote/marks", "dirB");
    expect(list.body.people.filter((x: { remoteToday: boolean }) => x.remoteToday)).toHaveLength(5);
    expect((await get("/remote/marks", "hr")).status).toBe(403);
  });

  it("check in and check out are server-stamped times only: no place, no address, one of each a day", async () => {
    const ci = await post("/me/remote/check-in", {}, "r1");
    expect(ci.status, JSON.stringify(ci.body)).toBe(201);
    expect(ci.body.checkIn).toMatch(/^\d{2}:\d{2}$/);
    expect(ci.body.checkOut).toBeNull();
    expect(Object.keys(ci.body).sort()).toEqual(["checkIn", "checkOut", "date", "decidedAt", "decisionReason", "half", "id", "openRequests", "rejectOutcome", "reopenCount", "status"].sort()); // nothing about where
    expect((await post("/me/remote/check-out", {}, "r2")).body.error.code).toBe("NOT_CHECKED_IN");
    expect((await post("/me/remote/check-in", {}, "r1")).body.error.code).toBe("ALREADY_CHECKED_IN");
    const body = { latitude: 1, longitude: 2, address: "x", photo: "y" };
    expect((await post("/me/remote/check-in", body, "r2")).status).toBe(201); // extra things sent are ignored, never stored
    const row = await prisma.remoteAttendanceRecord.findUniqueOrThrow({ where: { employeeId_date: { employeeId: p.r2.employeeId, date: d(CHECK_DAY) } } });
    expect(JSON.stringify(row)).not.toMatch(/latitude|longitude|address|photo/);
    const co = await post("/me/remote/check-out", {}, "r1");
    expect([co.status, co.body.status]).toEqual([200, "PENDING"]);
    expect((await post("/me/remote/check-out", {}, "r1")).body.error.code).toBe("ALREADY_CHECKED_OUT");
    // The record column list itself holds no location.
    const cols = (await prisma.$queryRaw<Array<{ column_name: string }>>`SELECT column_name FROM information_schema.columns WHERE table_name = 'remote_attendance_records'`).map((c) => c.column_name);
    expect(cols.filter((c) => /lat|lon|geo|ip|address|photo|device|location/i.test(c))).toEqual([]);
    expect((await post("/me/remote/check-out", {}, "r2")).status).toBe(200);
    await worked("r3");
    await worked("r4");
    await worked("dirA");
  });

  it("a record goes straight to the directors (the other one, not the owner) and to nobody else", async () => {
    const toDirB = await prisma.notification.count({ where: { userId: p.dirB.userId, type: "attendance.remote.pending" } });
    const toHr = await prisma.notification.count({ where: { userId: p.hr.userId, type: { startsWith: "attendance.remote" } } });
    const toOwner = await prisma.notification.count({ where: { userId: p.dirA.userId, type: "attendance.remote.pending" } });
    expect([toDirB, toOwner]).toEqual([5, 4]); // each of the five records is told to every director except its owner: dirA hears of four, dirB of all five (dirA's own among them)
    expect(toHr).toBe(0);
  });

  it("only a director sees or decides: HR, the Developer role and the employee are refused on every director route", async () => {
    const rec1 = await rec(p.r1);
    const routes: Array<[("get" | "post" | "put"), string, object?]> = [
      ["get", "/remote/marks"],
      ["post", "/remote/marks", { employeeId: p.r1.employeeId, effectiveFrom: "2026-09-01", remote: true, reason: "nope" }],
      ["get", "/remote/records"],
      ["post", `/remote/records/${rec1.id}/decision`, { kind: "FULL" }],
      ["post", `/remote/records/${rec1.id}/reopen`, { reason: "nope" }],
      ["post", "/remote/bulk-approve", { ids: [rec1.id] }],
      ["post", "/remote/bulk-reject", { ids: [rec1.id], reason: "nope", outcome: "ABSENT" }],
      ["get", "/remote/requests"],
      ["post", `/remote/requests/${rec1.id}/resolve`, { accept: true, note: "nope" }],
      ["get", `/remote/report?from=2026-09-01&to=2026-09-30`],
      ["get", "/remote/settings"],
      ["put", "/remote/settings", { reminderAfterHours: 2, suggestedRejectOutcome: null }],
    ];
    for (const who of ["hr", "dev", "r1", "plain"] as const) {
      for (const [method, path, body] of routes) {
        const r = method === "get" ? await get(path, who) : method === "post" ? await post(path, body ?? {}, who) : await put(path, body ?? {}, who);
        expect(r.status, `${who} ${method} ${path}`).toBe(403);
      }
    }
    expect((await request(app).get("/api/attendance/remote/records")).status).toBe(401);
    expect((await get("/me/remote/records", "r2")).body.records).toHaveLength(1); // the employee's own list holds only their own
    expect((await get("/me/remote/records", "plain")).body.records).toEqual([]);
  });

  it("a director decides: a full day makes the day present, with no loss of pay", async () => {
    const r1 = await rec(p.r1);
    expect((await post(`/remote/records/${r1.id}/decision`, { kind: "FULL" }, "dirB")).status).toBe(200);
    expect((await rec(p.r1)).status).toBe("APPROVED_FULL");
    setBusinessTodayForTests(d(AFTER));
    const { computeAttendance } = await import("../compute");
    await computeAttendance([p.r1.employeeId], CHECK_DAY, CHECK_DAY);
    const row = await dayRow(p.r1);
    expect([row.status, Number(row.lopDays)]).toEqual(["P", 0]);
    expect((await rec(p.r1)).overrideId).not.toBeNull(); // written through the engine's own override path
    expect(await prisma.notification.count({ where: { userId: p.r1.userId, type: "attendance.remote.decided" } })).toBe(1);
  });

  it("a half day needs the half named; it becomes half a day of loss of pay", async () => {
    const r2 = await rec(p.r2);
    expect((await post(`/remote/records/${r2.id}/decision`, { kind: "HALF" }, "dirB")).status).toBe(400);
    expect((await post(`/remote/records/${r2.id}/decision`, { kind: "HALF", half: "MIDDLE" }, "dirB")).status).toBe(400);
    expect((await post(`/remote/records/${r2.id}/decision`, { kind: "HALF", half: "FIRST" }, "dirB")).status).toBe(200);
    const row = await dayRow(p.r2);
    expect(Number(row.lopDays)).toBe(0.5);
    expect(row.firstHalfStatus).toBe("P");
    expect(row.secondHalfStatus).toBe("A");
    expect((await rec(p.r2)).half).toBe("FIRST");
  });

  it("a rejection needs a reason and an outcome; either outcome becomes a day of loss of pay in the month view, and the record keeps which", async () => {
    const r3 = await rec(p.r3);
    expect((await post(`/remote/records/${r3.id}/decision`, { kind: "REJECT", outcome: "ABSENT" }, "dirB")).status).toBe(400);
    expect((await post(`/remote/records/${r3.id}/decision`, { kind: "REJECT", reason: "x", outcome: "ABSENT" }, "dirB")).status).toBe(400);
    expect((await post(`/remote/records/${r3.id}/decision`, { kind: "REJECT", reason: "No work to show for the day" }, "dirB")).status).toBe(400); // the outcome is chosen at that moment
    expect((await post(`/remote/records/${r3.id}/decision`, { kind: "REJECT", reason: "No work to show for the day", outcome: "ABSENT" }, "dirB")).status).toBe(200);
    const r4 = await rec(p.r4);
    expect((await post(`/remote/records/${r4.id}/decision`, { kind: "REJECT", reason: "Could not be reached all day", outcome: "LOSS_OF_PAY" }, "dirB")).status).toBe(200);
    const [a, b] = [await dayRow(p.r3), await dayRow(p.r4)];
    expect([a.status, Number(a.lopDays), b.status, Number(b.lopDays)]).toEqual(["A", 1, "A", 1]);
    expect([(await rec(p.r3)).rejectOutcome, (await rec(p.r4)).rejectOutcome]).toEqual(["ABSENT", "LOSS_OF_PAY"]);
    expect((await rec(p.r3)).decisionReason).toBe("No work to show for the day");
    // The employee is told why. The reason is not in the audit trail (HR can read that; it is held in the record, for directors and for the person).
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: p.r3.userId, type: "attendance.remote.decided" } })).body).toContain("No work to show");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "attendance.remote.decided", entityId: r3.id } });
    expect(JSON.stringify(audit.after)).not.toContain("No work to show");
    // The database refuses a rejection with no reason or outcome, whatever the code does.
    await expect(prisma.remoteAttendanceRecord.update({ where: { id: r3.id }, data: { decisionReason: null } })).rejects.toThrow(/decision_check/);
  });

  it("a director cannot decide their own record: it goes to the other director", async () => {
    const own = await rec(p.dirA);
    const r = await post(`/remote/records/${own.id}/decision`, { kind: "FULL" }, "dirA");
    expect([r.status, r.body.error.code]).toEqual([403, "OWN_RECORD"]);
    expect((await rec(p.dirA)).status).toBe("PENDING");
    const list = await get("/remote/records?status=PENDING", "dirA");
    expect(list.body.rows.find((x: { id: string }) => x.id === own.id).yours).toBe(true);
    expect((await post(`/remote/records/${own.id}/decision`, { kind: "FULL" }, "dirB")).status).toBe(200);
  });

  it("bulk approve is for full days and skips what it may not do; bulk reject needs its reason and its outcome", async () => {
    // Two fresh pending days: reopen two decided records (with a reason), then decide them in bulk.
    const r1 = await rec(p.r1);
    const r3 = await rec(p.r3);
    expect((await post(`/remote/records/${r1.id}/reopen`, { reason: "x" }, "dirB")).status).toBe(400);
    expect((await post(`/remote/records/${r1.id}/reopen`, { reason: "Looked again at the work shown" }, "dirB")).status).toBe(200);
    expect((await post(`/remote/records/${r3.id}/reopen`, { reason: "Looked again at the work shown" }, "dirB")).status).toBe(200);
    expect((await rec(p.r1)).status).toBe("PENDING");
    expect((await rec(p.r1)).reopenCount).toBe(1);
    expect((await post(`/remote/records/${r1.id}/reopen`, { reason: "Again, not decided" }, "dirB")).body.error.code).toBe("NOT_DECIDED");
    expect((await post("/remote/bulk-reject", { ids: [r3.id], outcome: "ABSENT" }, "dirB")).status).toBe(400);
    expect((await post("/remote/bulk-reject", { ids: [r3.id], reason: "n", outcome: "ABSENT" }, "dirB")).status).toBe(400);
    expect((await post("/remote/bulk-reject", { ids: [r3.id], reason: "Still nothing to show" }, "dirB")).status).toBe(400);
    const rejected = await post("/remote/bulk-reject", { ids: [r3.id], reason: "Still nothing to show", outcome: "LOSS_OF_PAY" }, "dirB");
    expect(rejected.body).toEqual({ done: 1, skipped: [] });
    expect((await rec(p.r3)).rejectOutcome).toBe("LOSS_OF_PAY");
    const approved = await post("/remote/bulk-approve", { ids: [r1.id, r1.id, "no-such-id", (await rec(p.r3)).id] }, "dirB"); // a repeat is one, an unknown id is skipped, a decided record is skipped
    expect(approved.body.done).toBe(1);
    expect(approved.body.skipped.map((s: { id: string }) => s.id).sort()).toEqual(["no-such-id", r3.id].sort());
    expect((await rec(p.r1)).status).toBe("APPROVED_FULL");
    expect((await post("/remote/bulk-approve", { ids: [] }, "dirB")).status).toBe(400);
  });

  it("reopening a decided day takes its override away; the day follows the engine again", async () => {
    const r1 = await rec(p.r1);
    expect((await post(`/remote/records/${r1.id}/reopen`, { reason: "Reopened to check the times" }, "dirB")).status).toBe(200);
    const row = await dayRow(p.r1);
    expect(row.status).not.toBe("P"); // the status override is gone: no punches, so the engine does not call it present
    expect((await post(`/remote/records/${r1.id}/decision`, { kind: "FULL" }, "dirB")).status).toBe(200);
    expect((await dayRow(p.r1)).status).toBe("P");
  });

  it("a finalised day cannot be decided or reopened here", async () => {
    const r2 = await rec(p.r2);
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.r2.employeeId, date: d(CHECK_DAY) } }, data: { isLocked: true } });
    const reopen = await post(`/remote/records/${r2.id}/reopen`, { reason: "Trying after finalising" }, "dirB");
    expect([reopen.status, reopen.body.error.code]).toEqual([409, "LOCKED"]);
    await prisma.dailyAttendance.update({ where: { employeeId_date: { employeeId: p.r2.employeeId, date: d(CHECK_DAY) } }, data: { isLocked: false } });
  });

  it("correction and review requests: the person asks for their own record only, a director answers, and an accepted review reopens the day", async () => {
    const r2 = await rec(p.r2);
    const r4 = await rec(p.r4);
    const body = { kind: "REVIEW", note: "I was working, please look again" };
    expect((await post(`/me/remote/records/${r4.id}/requests`, body, "r2")).status).toBe(404); // somebody else's record does not exist for you
    expect((await post(`/me/remote/records/${r2.id}/requests`, { kind: "CORRECTION", note: "wrong time", checkOut: "18:00" }, "r2")).body.error.code).toBe("DECIDED"); // r2 is decided
    const review = await post(`/me/remote/records/${r4.id}/requests`, body, "r4");
    expect(review.status, JSON.stringify(review.body)).toBe(201);
    expect((await post(`/me/remote/records/${r4.id}/requests`, body, "r4")).body.error.code).toBe("REQUEST_OPEN");
    expect((await post(`/me/remote/records/${r4.id}/requests`, { ...body, checkIn: "09:00" }, "r4")).status).toBe(400); // a review carries no times
    expect((await get("/remote/requests", "dirB")).body.requests.map((x: { id: string }) => x.id)).toContain(review.body.id);
    const declined = await post(`/remote/requests/${review.body.id}/resolve`, { accept: false, note: "The decision stands" }, "dirB");
    expect(declined.body.status).toBe("DECLINED");
    expect((await rec(p.r4)).status).toBe("REJECTED");
    const again = await post(`/me/remote/records/${r4.id}/requests`, { kind: "REVIEW", note: "More evidence of the work" }, "r4");
    expect((await post(`/remote/requests/${again.body.id}/resolve`, { accept: true, note: "Seen the evidence" }, "dirB")).body.status).toBe("ACCEPTED");
    expect((await rec(p.r4)).status).toBe("PENDING"); // reopened
    expect((await post(`/remote/requests/${again.body.id}/resolve`, { accept: true, note: "twice" }, "dirB")).body.error.code).toBe("NOT_OPEN");
  });

  it("a correction of the times on a day not yet decided changes the record's times, and the history keeps what was said", async () => {
    const r4 = await rec(p.r4);
    const ask = await post(`/me/remote/records/${r4.id}/requests`, { kind: "CORRECTION", note: "My times were recorded wrongly", checkIn: "09:00", checkOut: "23:00" }, "r4");
    expect(ask.status, JSON.stringify(ask.body)).toBe(201);
    const ok = await post(`/remote/requests/${ask.body.id}/resolve`, { accept: true, note: "Agreed with the person" }, "dirB");
    expect(ok.body.status).toBe("ACCEPTED");
    const after = await rec(p.r4);
    expect([after.checkInAt!.toISOString(), after.checkOutAt!.toISOString()]).toEqual(["2026-09-30T03:30:00.000Z", "2026-09-30T17:30:00.000Z"]); // 09:00 and 23:00 in Asia/Kolkata
    const events = (await prisma.remoteAttendanceEvent.findMany({ where: { recordId: r4.id }, orderBy: { createdAt: "asc" } })).map((e) => e.type);
    expect(events).toEqual(expect.arrayContaining(["CHECK_IN", "CHECK_OUT", "DECIDED", "REVIEW_REQUESTED", "REOPENED", "CORRECTION_REQUESTED", "CORRECTED"]));
    await expect(prisma.remoteAttendanceEvent.update({ where: { id: (await prisma.remoteAttendanceEvent.findFirstOrThrow({ where: { recordId: r4.id } })).id }, data: { note: "changed" } })).rejects.toThrow(/REMOTE_APPEND_ONLY/);
    // The employee cannot answer their own request, and a director's own request goes to the other director (covered by the same rule as a decision).
    const mine = await post("/remote/requests/anything/resolve", { accept: true, note: "mine" }, "r4");
    expect(mine.status).toBe(403);
    // A director's own request is answered by the other director, never by them.
    const own = await rec(p.dirA);
    const ownAsk = await post(`/me/remote/records/${own.id}/requests`, { kind: "REVIEW", note: "Please look at my day again" }, "dirA");
    expect(ownAsk.status, JSON.stringify(ownAsk.body)).toBe(201);
    const self = await post(`/remote/requests/${ownAsk.body.id}/resolve`, { accept: true, note: "I agree with myself" }, "dirA");
    expect([self.status, self.body.error.code]).toEqual([403, "OWN_RECORD"]);
    expect((await post(`/remote/requests/${ownAsk.body.id}/resolve`, { accept: false, note: "The decision stands" }, "dirB")).body.status).toBe("DECLINED");
  });

  it("the report counts days by outcome, for directors only", async () => {
    const r = await get(`/remote/report?from=2026-09-01&to=2026-09-30`, "dirB");
    expect(r.status).toBe(200);
    expect(r.body.total.days).toBe(5);
    expect(r.body.people.length).toBe(5);
    expect((await get(`/remote/report?from=2026-09-30&to=2026-09-01x`, "dirB")).status).toBe(400);
  });

  it("the reminder threshold and the suggested outcome are Not set until a director sets them; with no threshold nothing is sent", async () => {
    const before = await get("/remote/settings", "dirA");
    expect(before.body).toEqual({ reminderAfterHours: null, suggestedRejectOutcome: null });
    expect(await sendDueReminders(new Date("2026-12-31T00:00:00Z"))).toBe(0);
    expect((await put("/remote/settings", { reminderAfterHours: 0, suggestedRejectOutcome: null }, "dirA")).status).toBe(400);
    expect((await put("/remote/settings", { reminderAfterHours: 2, suggestedRejectOutcome: "SOMETIMES" }, "dirA")).status).toBe(400);
    const set = await put("/remote/settings", { reminderAfterHours: 2, suggestedRejectOutcome: "ABSENT" }, "dirA");
    expect(set.body).toEqual({ reminderAfterHours: 2, suggestedRejectOutcome: "ABSENT" });
    const pending = await prisma.remoteAttendanceRecord.count({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) }, status: "PENDING" } });
    expect(pending).toBeGreaterThan(0);
    expect(await sendDueReminders(new Date("2026-09-30T12:00:00Z"))).toBe(0); // not yet two hours since the check-out
    expect(await sendDueReminders(new Date("2026-12-31T00:00:00Z"))).toBe(pending);
    expect(await sendDueReminders(new Date("2026-12-31T00:00:00Z"))).toBe(0); // once each
    expect((await put("/remote/settings", { reminderAfterHours: null, suggestedRejectOutcome: null }, "dirA")).body).toEqual(before.body);
  });
});
