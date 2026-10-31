import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@prisma/client";
import { PRIVATE_NOTICE } from "@shared/constants/peeps";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { appoint, clearPeepsSettings, removeMember, setSetting } from "../../peeps/__tests__/peepsTestKit";

// Unmute (D-29, D-30): settings gate, hosts authorised by a director, booking with no topic, visibility (booker, host, directors with an audit entry),
// no double booking under a race, explicit cancel and reschedule, completion, and the controlled path when a host is removed.

type Who = "director" | "director2" | "host" | "host2" | "member" | "hrAdmin" | "manager" | "employee" | "employee2" | "developer";
type Person = { employeeId: string; employeeCode: string; userId: string };
const RACERS = 10;

/** An instant at HH:MM on the day `daysAhead` from now, in the company's timezone (IST, no daylight saving). */
function istAt(daysAhead: number, hhmm: string): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + daysAhead * 86_400_000));
  return new Date(`${day}T${hhmm}:00+05:30`).toISOString();
}

describe("Unmute", () => {
  let org: TestOrgMasters;
  const p = {} as Record<Who, Person>;
  const tok = {} as Record<Who, string>;
  const racers: Person[] = [];
  const racerTok: string[] = [];
  const get = (who: Who, path: string) => request(app).get(path).set(...authHeader(tok[who]));
  const post = (who: Who, path: string, body: object = {}) => request(app).post(path).set(...authHeader(tok[who])).send(body);
  const slot = async (who: Who, daysAhead: number, hhmm: string) => {
    const res = await post(who, "/api/unmute/host/slots", { startsAt: istAt(daysAhead, hhmm) });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    return res.body.id as string;
  };
  const book = (who: Who, slotId: string) => post(who, "/api/unmute/bookings", { slotId, timezone: "Asia/Kolkata" });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.host = await createFullTestEmployee(org);
    p.host2 = await createFullTestEmployee(org);
    p.member = await createFullTestEmployee(org);
    p.hrAdmin = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.manager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
    p.employee = await createFullTestEmployee(org);
    p.employee2 = await createFullTestEmployee(org);
    p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
    for (const k of Object.keys(p) as Who[]) tok[k] = await loginAs(p[k].employeeCode);
    for (let i = 0; i < RACERS; i += 1) {
      const r = await createFullTestEmployee(org);
      racers.push(r);
      racerTok.push(await loginAs(r.employeeCode));
    }
    for (const who of ["host", "host2", "member"] as const) await appoint(p[who].employeeId, [], p.director, p.director2);
  });

  afterAll(async () => {
    await clearPeepsSettings();
    const ids = Object.values(p).concat(racers).map((x) => x.employeeId);
    const bookingIds = (await prisma.unmuteBooking.findMany({ where: { OR: [{ bookerEmployeeId: { in: ids } }, { hostEmployeeId: { in: ids } }] }, select: { id: true } })).map((b) => b.id);
    const slotIds = (await prisma.unmuteSlot.findMany({ where: { hostEmployeeId: { in: ids } }, select: { id: true } })).map((s) => s.id);
    const authIds = (await prisma.unmuteHostAuthorisation.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((a) => a.id);
    const changeIds = (await prisma.officeMembershipChange.findMany({ where: { employeeId: { in: ids } }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...bookingIds, ...slotIds, ...authIds, ...changeIds] } });
    for (const x of Object.values(p).concat(racers)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("Not set until the directors set it", () => {
    it("with no settings Unmute is inactive and every booking path refuses", async () => {
      const status = await get("employee", "/api/unmute/status");
      expect(status.body).toMatchObject({ active: false, canBook: false, officeName: "Wellsure Office" });
      expect(status.body.missing.length).toBe(6);
      expect((await get("employee", "/api/unmute/slots")).status).toBe(409);
      expect((await book("employee", "x")).status).toBe(409);
    });

    it("with every working value set but bookings not opened to employees, booking is refused", async () => {
      await setSetting("unmute.sessionMinutes", 30, p.director, p.director2);
      await setSetting("unmute.availability", { days: [0, 1, 2, 3, 4, 5, 6], from: "09:00", to: "18:00" }, p.director, p.director2);
      await setSetting("unmute.bookingWindowDays", 30, p.director, p.director2);
      await setSetting("unmute.minNoticeHours", 0, p.director, p.director2);
      await setSetting("unmute.cancellationNoticeHours", 1, p.director, p.director2);
      await setSetting("audience.unmute", { employeesMayBook: false }, p.director, p.director2);
      expect((await get("employee", "/api/unmute/status")).body).toMatchObject({ active: true, canBook: false });
      expect((await get("employee", "/api/unmute/slots")).status).toBe(403);
      await setSetting("audience.unmute", { employeesMayBook: true }, p.director, p.director2);
      expect((await get("employee", "/api/unmute/slots")).status).toBe(200);
    });
  });

  describe("hosts", () => {
    it("nobody is a host by default; a director authorises members only; HR cannot authorise", async () => {
      expect((await get("host", "/api/unmute/host/slots")).status).toBe(403);
      expect((await post("hrAdmin", "/api/unmute/admin/hosts", { employeeId: p.host.employeeId, reason: "test" })).status).toBe(403);
      expect((await post("director", "/api/unmute/admin/hosts", { employeeId: p.employee.employeeId, reason: "not a member" })).status).toBe(409);
      for (const who of ["host", "host2"] as const) expect((await post("director", "/api/unmute/admin/hosts", { employeeId: p[who].employeeId, reason: "test host" })).status).toBe(201);
      expect((await get("host", "/api/unmute/host/slots")).status).toBe(200);
      expect((await get("member", "/api/unmute/host/slots")).status).toBe(403); // a member, not a host
      await expect(prisma.unmuteHostAuthorisation.create({ data: { employeeId: p.member.employeeId, action: "AUTHORISE", reason: "raw", byUserId: p.hrAdmin.userId } })).rejects.toThrow(/UNMUTE_DIRECTORS_ONLY/);
    });

    it("a host offers slots only inside the availability window, never overlapping", async () => {
      expect((await post("host", "/api/unmute/host/slots", { startsAt: istAt(2, "20:00") })).status).toBe(400);
      await slot("host", 2, "10:00");
      expect((await post("host", "/api/unmute/host/slots", { startsAt: istAt(2, "10:15") })).status).toBe(409);
    });
  });

  describe("booking and who sees it", () => {
    it("an employee sees free times with no host identity, books one with no topic, and sees the host as the Wellsure Office", async () => {
      const a = await slot("host", 2, "11:00");
      const free = await get("employee", "/api/unmute/slots");
      const row = free.body.find((s: { id: string }) => s.id === a);
      expect(Object.keys(row).sort()).toEqual(["endsAt", "id", "startsAt"]);
      expect((await post("employee", "/api/unmute/bookings", { slotId: a, timezone: "Asia/Kolkata", topic: "anything" })).status).toBe(400);
      expect((await post("employee", "/api/unmute/bookings", { slotId: a, timezone: "Not/AZone" })).status).toBe(400);
      const booked = await book("employee", a);
      expect(booked.status, JSON.stringify(booked.body)).toBe(201);
      expect(booked.body).toMatchObject({ host: "Wellsure Office", status: "BOOKED", timezone: "Asia/Kolkata" });
      const mine = await get("employee", "/api/unmute/bookings/mine");
      expect(JSON.stringify(mine.body)).not.toContain(p.host.employeeCode);
      expect((await get("employee", "/api/unmute/slots")).body.some((s: { id: string }) => s.id === a)).toBe(false);
    });

    it("the host sees the booker; another host, another employee, HR, a manager, a plain member and the Developer see nothing of it", async () => {
      const booking = await prisma.unmuteBooking.findFirstOrThrow({ where: { bookerEmployeeId: p.employee.employeeId, status: "BOOKED" } });
      const hostView = await get("host", "/api/unmute/host/slots");
      expect(JSON.stringify(hostView.body)).toContain(p.employee.employeeCode);
      expect(JSON.stringify((await get("host2", "/api/unmute/host/slots")).body)).not.toContain(booking.id);
      expect(JSON.stringify((await get("employee2", "/api/unmute/bookings/mine")).body)).not.toContain(booking.id);
      expect((await post("employee2", `/api/unmute/bookings/${booking.id}/cancel`)).status).toBe(404);
      expect((await post("employee2", `/api/unmute/bookings/${booking.id}/reschedule`, { slotId: booking.slotId })).status).toBe(404);
      expect((await post("host2", `/api/unmute/host/bookings/${booking.id}/cancel`)).status).toBe(404);
      for (const who of ["employee2", "hrAdmin", "manager", "member", "developer"] as const) {
        expect((await get(who, "/api/unmute/admin/bookings")).status, who).toBe(403);
        expect((await get(who, `/api/unmute/admin/bookings/${booking.id}`)).status, who).toBe(403);
      }
    });

    it("a director sees every booking, and each one opened is audited (who, what, when)", async () => {
      const booking = await prisma.unmuteBooking.findFirstOrThrow({ where: { bookerEmployeeId: p.employee.employeeId, status: "BOOKED" } });
      const before = await prisma.auditLog.count({ where: { action: "peeps.director.opened", entityId: booking.id, actorUserId: p.director.userId } });
      const all = await get("director", "/api/unmute/admin/bookings");
      expect(all.status).toBe(200);
      expect(all.body.find((b: { id: string }) => b.id === booking.id)).toMatchObject({ booker: { employeeId: p.employee.employeeId }, host: { employeeId: p.host.employeeId } });
      expect((await get("director", `/api/unmute/admin/bookings/${booking.id}`)).status).toBe(200);
      const after = await prisma.auditLog.findMany({ where: { action: "peeps.director.opened", entityId: booking.id, actorUserId: p.director.userId } });
      expect(after.length).toBe(before + 2);
      expect(after.every((a) => a.entityType === "UnmuteBooking" && a.createdAt instanceof Date)).toBe(true);
    });

    it("notifications say only that something is waiting", async () => {
      const notes = await prisma.notification.findMany({ where: { userId: p.host.userId, type: "peeps.waiting" } });
      expect(notes.length).toBeGreaterThan(0);
      for (const n of notes) {
        expect({ title: n.title, body: n.body }).toEqual(PRIVATE_NOTICE);
        expect(JSON.stringify(n)).not.toContain(p.employee.employeeCode);
      }
    });
  });

  describe("no double booking", () => {
    it(`${RACERS} employees booking the same slot at once: exactly one succeeds`, async () => {
      const b = await slot("host", 3, "10:00");
      const results = await Promise.all(racerTok.map((t) => request(app).post("/api/unmute/bookings").set(...authHeader(t)).send({ slotId: b, timezone: "Asia/Kolkata" })));
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(RACERS - 1);
      expect(await prisma.unmuteBooking.count({ where: { slotId: b, status: "BOOKED" } })).toBe(1);
    });

    it("the database alone refuses a second live booking of a slot and a second open slot at the same time", async () => {
      const c = await slot("host", 3, "11:00");
      const raw = (bookerEmployeeId: string) => prisma.unmuteBooking.create({ data: { slotId: c, hostEmployeeId: p.host.employeeId, bookerEmployeeId, timezone: "Asia/Kolkata" } });
      const results = await Promise.allSettled([raw(racers[0]!.employeeId), raw(racers[1]!.employeeId), raw(racers[2]!.employeeId)]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results) if (r.status === "rejected") expect((r.reason as Prisma.PrismaClientKnownRequestError).code).toBe("P2002");
      const startsAt = new Date(istAt(4, "10:00"));
      await prisma.unmuteSlot.create({ data: { hostEmployeeId: p.host.employeeId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000) } });
      await expect(prisma.unmuteSlot.create({ data: { hostEmployeeId: p.host.employeeId, startsAt, endsAt: new Date(startsAt.getTime() + 1_800_000) } })).rejects.toThrow();
    });
  });

  describe("cancel, reschedule, complete", () => {
    it("reschedule moves the booking in one step and frees the old time", async () => {
      const booking = await prisma.unmuteBooking.findFirstOrThrow({ where: { bookerEmployeeId: p.employee.employeeId, status: "BOOKED" } });
      const e = await slot("host", 5, "10:00");
      const moved = await post("employee", `/api/unmute/bookings/${booking.id}/reschedule`, { slotId: e });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect((await prisma.unmuteBooking.findUniqueOrThrow({ where: { id: booking.id } })).status).toBe("RESCHEDULED");
      expect((await get("employee2", "/api/unmute/slots")).body.some((s: { id: string }) => s.id === booking.slotId)).toBe(true);
    });

    it("inside the cancellation notice the employee cannot cancel, but the host can", async () => {
      const live = await prisma.unmuteBooking.findFirstOrThrow({ where: { bookerEmployeeId: p.employee.employeeId, status: "BOOKED" } });
      await setSetting("unmute.cancellationNoticeHours", 720, p.director, p.director2);
      expect((await post("employee", `/api/unmute/bookings/${live.id}/cancel`)).status).toBe(409);
      expect((await post("host", `/api/unmute/host/bookings/${live.id}/cancel`)).status).toBe(200);
      expect(await prisma.unmuteBooking.findUniqueOrThrow({ where: { id: live.id } })).toMatchObject({ status: "CANCELLED", cancelledBy: "HOST" });
      await setSetting("unmute.cancellationNoticeHours", 1, p.director, p.director2);
    });

    it("a conversation is marked held or not held only after it was due, once", async () => {
      const f = await slot("host", 6, "10:00");
      const future = await book("employee2", f);
      expect((await post("host", `/api/unmute/host/bookings/${future.body.id}/complete`, { outcome: "COMPLETED" })).status).toBe(409);
      const past = new Date(Date.now() - 3_600_000);
      const pastSlot = await prisma.unmuteSlot.create({ data: { hostEmployeeId: p.host.employeeId, startsAt: past, endsAt: new Date(past.getTime() + 1_800_000) } });
      const pastBooking = await prisma.unmuteBooking.create({ data: { slotId: pastSlot.id, hostEmployeeId: p.host.employeeId, bookerEmployeeId: p.employee2.employeeId, timezone: "Asia/Kolkata" } });
      expect((await post("host", `/api/unmute/host/bookings/${pastBooking.id}/complete`, { outcome: "COMPLETED" })).status).toBe(200);
      expect((await post("host", `/api/unmute/host/bookings/${pastBooking.id}/complete`, { outcome: "NOT_HELD" })).status).toBe(409);
      await expect(prisma.unmuteBooking.update({ where: { id: pastBooking.id }, data: { status: "BOOKED" } })).rejects.toThrow(/UNMUTE_BOOKING_FINAL/);
    });
  });

  describe("removing a host", () => {
    it("blocks new bookings at once, withdraws free slots, and leaves booked conversations for the directors to reassign or cancel", async () => {
      const g = await slot("host", 7, "10:00");
      const h = await slot("host", 7, "11:00");
      const freeSlot = await slot("host", 7, "12:00");
      const target = await slot("host2", 7, "10:00");
      const bg = await book("employee", g);
      const bh = await book("employee2", h);
      const revoked = await post("director", `/api/unmute/admin/hosts/${p.host.employeeId}/revoke`, { reason: "role ended" });
      expect(revoked.body).toMatchObject({ bookingsToHandle: expect.any(Number) });
      expect(revoked.body.bookingsToHandle).toBeGreaterThanOrEqual(2);
      expect((await prisma.unmuteSlot.findUniqueOrThrow({ where: { id: freeSlot } })).status).toBe("WITHDRAWN");
      expect((await get("host", "/api/unmute/host/slots")).status).toBe(403);
      expect((await book("employee2", freeSlot)).status).toBe(409);
      const affected = await get("director", "/api/unmute/admin/affected");
      const ids = affected.body.map((b: { id: string }) => b.id);
      expect(ids).toEqual(expect.arrayContaining([bg.body.id, bh.body.id]));
      const moved = await post("director", `/api/unmute/admin/bookings/${bg.body.id}/reassign`, { slotId: target });
      expect(moved.status, JSON.stringify(moved.body)).toBe(200);
      expect((await prisma.unmuteBooking.findUniqueOrThrow({ where: { id: moved.body.id } })).hostEmployeeId).toBe(p.host2.employeeId);
      expect((await post("director", `/api/unmute/admin/bookings/${bh.body.id}/cancel`)).status).toBe(200);
      expect(await prisma.unmuteBooking.findUniqueOrThrow({ where: { id: bh.body.id } })).toMatchObject({ status: "CANCELLED", cancelledBy: "SYSTEM" });
      expect((await get("director", "/api/unmute/admin/affected")).body.map((b: { id: string }) => b.id)).not.toEqual(expect.arrayContaining([bg.body.id, bh.body.id]));
    });

    it("a host who leaves the Wellsure Office stops being a host", async () => {
      const s = await slot("host2", 8, "10:00");
      expect((await get("employee", "/api/unmute/slots")).body.some((x: { id: string }) => x.id === s)).toBe(true);
      await removeMember(p.host2.employeeId, p.director, p.director2);
      expect((await get("employee", "/api/unmute/slots")).body.some((x: { id: string }) => x.id === s)).toBe(false);
      expect((await get("host2", "/api/unmute/host/slots")).status).toBe(403);
    });
  });

  it("the records hold no topic, notes, summary, transcript or recording", () => {
    const fields = (model: string) => Prisma.dmmf.datamodel.models.find((m) => m.name === model)!.fields.filter((f) => f.kind === "scalar" || f.kind === "enum").map((f) => f.name);
    expect(fields("UnmuteBooking").sort()).toEqual(["bookedAt", "bookerEmployeeId", "cancelledAt", "cancelledBy", "completedAt", "hostEmployeeId", "id", "rescheduledAt", "rescheduledToId", "slotId", "status", "timezone"].sort());
    expect(fields("UnmuteSlot").sort()).toEqual(["createdAt", "endsAt", "hostEmployeeId", "id", "startsAt", "status", "withdrawnAt"].sort());
  });
});
