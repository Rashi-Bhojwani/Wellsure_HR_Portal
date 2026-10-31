import { Prisma } from "@prisma/client";
import { PEEPS_REQUIRED, PEEPS_SETTINGS, PRIVATE_NOTICE } from "@shared/constants/peeps";
import { env } from "../../config/env";
import { writeAuditLogs } from "../../lib/audit";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { auditDirectorOpen } from "../peeps/access";
import { currentMembers, memberStateFor } from "../peeps/office";
import { getSettings, missingSettings, officeName } from "../peeps/settings";
import type { AvailabilityWindow } from "../peeps/settingSchemas";
import type { ActorMeta, PeepsActor } from "../peeps/types";

// Unmute (D-29, D-30): an employee books a conversation with a Wellsure Office host to raise an issue or an idea for the company. Stored: participants,
// the slot, the booker's timezone, booking/cancellation/reschedule timestamps and the completion status — nothing about what is said. Visible to the
// booker, the host and the directors (a director opening someone else's booking is audited). Employees see the host as the workspace name, never the
// person. Every working value is a setting with no default; Unmute refuses to activate until all are confirmed.
//
// No double booking: one OPEN slot per host and start time (unmute_slots_one_open) and one live booking per slot (unmute_bookings_one_live), plus a row
// lock on the slot in every booking path.

type Tx = Prisma.TransactionClient;

interface UnmuteSettings {
  employeesMayBook: boolean;
  sessionMinutes: number;
  availability: AvailabilityWindow;
  bookingWindowDays: number;
  minNoticeHours: number;
  cancellationNoticeHours: number;
}

const HOUR = 3_600_000;
const DAY = 86_400_000;
const now = () => new Date(); // allow-clock: an instant

async function loadSettings(): Promise<{ settings: UnmuteSettings | null; missing: string[] }> {
  const keys = PEEPS_REQUIRED.unmute;
  const missing = await missingSettings(keys);
  if (missing.length > 0) return { settings: null, missing: missing.map((k) => PEEPS_SETTINGS[k].label) };
  const s = await getSettings(keys);
  return {
    settings: {
      employeesMayBook: (s["audience.unmute"] as { employeesMayBook: boolean }).employeesMayBook,
      sessionMinutes: s["unmute.sessionMinutes"] as number,
      availability: s["unmute.availability"] as AvailabilityWindow,
      bookingWindowDays: s["unmute.bookingWindowDays"] as number,
      minNoticeHours: s["unmute.minNoticeHours"] as number,
      cancellationNoticeHours: s["unmute.cancellationNoticeHours"] as number,
    },
    missing: [],
  };
}

async function requireActive(): Promise<UnmuteSettings> {
  const { settings, missing } = await loadSettings();
  if (!settings) throw new HttpError(409, `Unmute is not set up yet. Not set: ${missing.join(", ").toLowerCase()}.`, "PEEPS_NOT_SET_UP");
  return settings;
}

async function requireBookable(): Promise<UnmuteSettings> {
  const s = await requireActive();
  if (!s.employeesMayBook) throw new HttpError(403, "The directors have not opened Unmute bookings to employees.", "FORBIDDEN");
  return s;
}

/** A host is a Wellsure Office member whom a director has authorised (and not since removed). Nobody is a host by default. */
export async function isActiveHost(employeeId: string, client: Tx | typeof prisma = prisma): Promise<boolean> {
  const latest = await client.unmuteHostAuthorisation.findFirst({ where: { employeeId }, orderBy: [{ at: "desc" }, { id: "desc" }] });
  if (latest?.action !== "AUTHORISE") return false;
  return (await memberStateFor(employeeId, client)) !== null;
}

function validTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Day of week (0 = Sunday) and HH:MM of an instant in the company's timezone. */
function localParts(at: Date): { day: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: env.TZ_BUSINESS, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return { day: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")), hhmm: `${get("hour")}:${get("minute")}` };
}

function insideWindow(start: Date, end: Date, w: AvailabilityWindow): boolean {
  const s = localParts(start);
  const e = localParts(end);
  return w.days.includes(s.day) && s.day === e.day && s.hhmm >= w.from && e.hhmm <= w.to;
}

const notifyPrivately = (employeeId: string, link: string) => notifyEmployee(employeeId, { type: "peeps.waiting", title: PRIVATE_NOTICE.title, body: PRIVATE_NOTICE.body, link });
const BOOKER_LINK = "/app/unmute";
const HOST_LINK = "/app/office/unmute";

function lockSlot(tx: Tx, slotId: string) {
  return tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM unmute_slots WHERE id = ${slotId} FOR UPDATE`;
}
function oneLive(err: unknown): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "That time has just been taken. Please choose another.", "SLOT_TAKEN");
  throw err;
}

// ── Employee ───────────────────────────────────────────────────────────────

export async function status(actor: PeepsActor) {
  const { settings, missing } = await loadSettings();
  return {
    active: settings !== null,
    canBook: settings?.employeesMayBook === true,
    missing,
    officeName: await officeName(),
    isHost: await isActiveHost(actor.employeeId),
    isDirector: actor.isDirector,
  };
}

/** Free slots an employee can book now: open, hosted by an active host (not themselves), inside the booking window and notice. No host identity. */
export async function openSlots(actor: PeepsActor) {
  const s = await requireBookable();
  const from = new Date(now().getTime() + s.minNoticeHours * HOUR);
  const to = new Date(now().getTime() + s.bookingWindowDays * DAY);
  const slots = await prisma.unmuteSlot.findMany({
    where: { status: "OPEN", startsAt: { gte: from, lte: to }, hostEmployeeId: { not: actor.employeeId }, bookings: { none: { status: "BOOKED" } } },
    orderBy: { startsAt: "asc" },
    take: 500,
  });
  const hosts = [...new Set(slots.map((x) => x.hostEmployeeId))];
  const active = new Set<string>();
  for (const h of hosts) if (await isActiveHost(h)) active.add(h);
  return slots.filter((x) => active.has(x.hostEmployeeId)).map((x) => ({ id: x.id, startsAt: x.startsAt.toISOString(), endsAt: x.endsAt.toISOString() }));
}

async function bookInTx(tx: Tx, s: UnmuteSettings, slotId: string, bookerEmployeeId: string, timezone: string, opts: { checkNotice: boolean }) {
  if ((await lockSlot(tx, slotId)).length === 0) throw new HttpError(404, "That time is not available.", "NOT_FOUND");
  const slot = await tx.unmuteSlot.findUniqueOrThrow({ where: { id: slotId } });
  if (slot.status !== "OPEN") throw new HttpError(409, "That time is no longer offered.", "SLOT_TAKEN");
  if (slot.hostEmployeeId === bookerEmployeeId) throw new HttpError(409, "You cannot book a conversation with yourself.", "SELF_BOOKING");
  if (opts.checkNotice) {
    if (slot.startsAt.getTime() < now().getTime() + s.minNoticeHours * HOUR) throw new HttpError(409, "That time is too soon to book.", "TOO_SOON");
    if (slot.startsAt.getTime() > now().getTime() + s.bookingWindowDays * DAY) throw new HttpError(409, "That time is too far ahead to book.", "TOO_FAR");
  } else if (slot.startsAt.getTime() <= now().getTime()) throw new HttpError(409, "That time has passed.", "PASSED");
  if (!(await isActiveHost(slot.hostEmployeeId, tx))) throw new HttpError(409, "That time is no longer offered.", "SLOT_TAKEN");
  if (await tx.unmuteBooking.findFirst({ where: { slotId, status: "BOOKED" }, select: { id: true } })) throw new HttpError(409, "That time has just been taken. Please choose another.", "SLOT_TAKEN");
  return tx.unmuteBooking.create({ data: { slotId, hostEmployeeId: slot.hostEmployeeId, bookerEmployeeId, timezone } });
}

export async function book(actor: PeepsActor, input: { slotId: string; timezone: string }, meta: ActorMeta) {
  const s = await requireBookable();
  if (!validTimezone(input.timezone)) throw new HttpError(400, "That timezone is not recognised.", "VALIDATION_ERROR");
  const booking = await prisma
    .$transaction(async (tx) => {
      const b = await bookInTx(tx, s, input.slotId, actor.employeeId, input.timezone, { checkNotice: true });
      await writeAuditLogs([{ ...meta, action: "unmute.booking.created", entityType: "UnmuteBooking", entityId: b.id }], tx);
      return b;
    })
    .catch(oneLive);
  await notifyPrivately(booking.hostEmployeeId, HOST_LINK);
  return bookingForBooker(booking.id, actor);
}

async function bookingForBooker(id: string, actor: PeepsActor) {
  const list = await myBookings(actor);
  return list.find((b) => b.id === id)!;
}

export async function myBookings(actor: PeepsActor) {
  const name = await officeName();
  const rows = await prisma.unmuteBooking.findMany({ where: { bookerEmployeeId: actor.employeeId }, orderBy: { bookedAt: "desc" }, take: 200, include: { slot: true } });
  return rows.map((b) => ({
    id: b.id,
    host: name,
    startsAt: b.slot.startsAt.toISOString(),
    endsAt: b.slot.endsAt.toISOString(),
    timezone: b.timezone,
    status: b.status,
    bookedAt: b.bookedAt.toISOString(),
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    cancelledBy: b.cancelledBy,
    rescheduledAt: b.rescheduledAt?.toISOString() ?? null,
    completedAt: b.completedAt?.toISOString() ?? null,
  }));
}

async function loadLive(tx: Tx, id: string) {
  const b = await tx.unmuteBooking.findUnique({ where: { id }, include: { slot: true } });
  if (!b) throw new HttpError(404, "Booking not found.", "NOT_FOUND");
  await lockSlot(tx, b.slotId);
  const fresh = await tx.unmuteBooking.findUniqueOrThrow({ where: { id }, include: { slot: true } });
  return fresh;
}

/** The booker cancels (up to the cancellation notice before it starts). */
export async function cancelAsBooker(actor: PeepsActor, id: string, meta: ActorMeta) {
  const s = await requireActive();
  const b = await prisma.$transaction(async (tx) => {
    const b = await loadLive(tx, id);
    if (b.bookerEmployeeId !== actor.employeeId) throw new HttpError(404, "Booking not found.", "NOT_FOUND");
    if (b.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active.", "NOT_ACTIVE");
    if (b.slot.startsAt.getTime() < now().getTime() + s.cancellationNoticeHours * HOUR) throw new HttpError(409, "It is too late to cancel this booking yourself. Please tell the Wellsure Office.", "TOO_LATE");
    await tx.unmuteBooking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now(), cancelledBy: "BOOKER" } });
    await writeAuditLogs([{ ...meta, action: "unmute.booking.cancelled", entityType: "UnmuteBooking", entityId: id, after: { by: "BOOKER" } }], tx);
    return b;
  });
  await notifyPrivately(b.hostEmployeeId, HOST_LINK);
  return bookingForBooker(id, actor);
}

/** The booker moves to another free time, in one step: the old booking is marked rescheduled and the new one is booked. */
export async function reschedule(actor: PeepsActor, id: string, input: { slotId: string }, meta: ActorMeta) {
  const s = await requireBookable();
  const result = await prisma
    .$transaction(async (tx) => {
      const b = await loadLive(tx, id);
      if (b.bookerEmployeeId !== actor.employeeId) throw new HttpError(404, "Booking not found.", "NOT_FOUND");
      if (b.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active.", "NOT_ACTIVE");
      if (b.slot.startsAt.getTime() < now().getTime() + s.cancellationNoticeHours * HOUR) throw new HttpError(409, "It is too late to move this booking yourself.", "TOO_LATE");
      if (input.slotId === b.slotId) throw new HttpError(409, "That is the time you already have.", "SAME_SLOT");
      const next = await bookInTx(tx, s, input.slotId, actor.employeeId, b.timezone, { checkNotice: true });
      await tx.unmuteBooking.update({ where: { id }, data: { status: "RESCHEDULED", rescheduledAt: now(), rescheduledToId: next.id } });
      await writeAuditLogs([{ ...meta, action: "unmute.booking.rescheduled", entityType: "UnmuteBooking", entityId: id, after: { to: next.id } }], tx);
      return { old: b, next };
    })
    .catch(oneLive);
  await notifyPrivately(result.old.hostEmployeeId, HOST_LINK);
  if (result.next.hostEmployeeId !== result.old.hostEmployeeId) await notifyPrivately(result.next.hostEmployeeId, HOST_LINK);
  return bookingForBooker(result.next.id, actor);
}

// ── Host ───────────────────────────────────────────────────────────────────

async function requireHost(actor: PeepsActor): Promise<void> {
  if (!(await isActiveHost(actor.employeeId))) throw new HttpError(403, "Only an authorised Unmute host can do this.", "FORBIDDEN");
}

const personSelect = { select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } as const;
const personOf = (e: { id: string; employeeCode: string; nameHistory: { fullName: string }[] }) => ({ employeeId: e.id, employeeCode: e.employeeCode, name: e.nameHistory[0]?.fullName ?? e.employeeCode });

export async function hostSlots(actor: PeepsActor) {
  await requireHost(actor);
  const since = new Date(now().getTime() - 30 * DAY);
  const slots = await prisma.unmuteSlot.findMany({
    where: { hostEmployeeId: actor.employeeId, startsAt: { gte: since } },
    orderBy: { startsAt: "asc" },
    include: { bookings: { orderBy: { bookedAt: "desc" }, include: { booker: personSelect } } },
  });
  return slots.map((x) => ({
    id: x.id,
    startsAt: x.startsAt.toISOString(),
    endsAt: x.endsAt.toISOString(),
    status: x.status,
    bookings: x.bookings.map((b) => ({ id: b.id, booker: personOf(b.booker), status: b.status, timezone: b.timezone, bookedAt: b.bookedAt.toISOString(), cancelledBy: b.cancelledBy, completedAt: b.completedAt?.toISOString() ?? null })),
  }));
}

export async function createSlot(actor: PeepsActor, input: { startsAt: string }, meta: ActorMeta) {
  const s = await requireActive();
  await requireHost(actor);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(startsAt.getTime() + s.sessionMinutes * 60_000);
  if (startsAt.getTime() <= now().getTime()) throw new HttpError(400, "A slot must start in the future.", "VALIDATION_ERROR");
  if (startsAt.getTime() > now().getTime() + s.bookingWindowDays * DAY) throw new HttpError(400, "A slot cannot be further ahead than the booking window.", "VALIDATION_ERROR");
  if (!insideWindow(startsAt, endsAt, s.availability)) throw new HttpError(400, "That time is outside the availability window.", "OUTSIDE_WINDOW");
  try {
    const slot = await prisma.$transaction(async (tx) => {
      const overlap = await tx.unmuteSlot.findFirst({ where: { hostEmployeeId: actor.employeeId, status: "OPEN", startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } });
      if (overlap) throw new HttpError(409, "You already offer a slot that overlaps this time.", "OVERLAP");
      const slot = await tx.unmuteSlot.create({ data: { hostEmployeeId: actor.employeeId, startsAt, endsAt } });
      await writeAuditLogs([{ ...meta, action: "unmute.slot.created", entityType: "UnmuteSlot", entityId: slot.id }], tx);
      return slot;
    });
    return { id: slot.id, startsAt: slot.startsAt.toISOString(), endsAt: slot.endsAt.toISOString(), status: slot.status };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, "You already offer a slot at this time.", "OVERLAP");
    throw err;
  }
}

export async function withdrawSlot(actor: PeepsActor, slotId: string, meta: ActorMeta) {
  await requireHost(actor);
  await prisma.$transaction(async (tx) => {
    if ((await lockSlot(tx, slotId)).length === 0) throw new HttpError(404, "Slot not found.", "NOT_FOUND");
    const slot = await tx.unmuteSlot.findUniqueOrThrow({ where: { id: slotId } });
    if (slot.hostEmployeeId !== actor.employeeId) throw new HttpError(404, "Slot not found.", "NOT_FOUND");
    if (slot.status !== "OPEN") return;
    if (await tx.unmuteBooking.findFirst({ where: { slotId, status: "BOOKED" } })) throw new HttpError(409, "This slot is booked. Cancel the booking first.", "BOOKED");
    await tx.unmuteSlot.update({ where: { id: slotId }, data: { status: "WITHDRAWN", withdrawnAt: now() } });
    await writeAuditLogs([{ ...meta, action: "unmute.slot.withdrawn", entityType: "UnmuteSlot", entityId: slotId }], tx);
  });
  return { ok: true };
}

export async function cancelAsHost(actor: PeepsActor, id: string, meta: ActorMeta) {
  await requireHost(actor);
  const b = await prisma.$transaction(async (tx) => {
    const b = await loadLive(tx, id);
    if (b.hostEmployeeId !== actor.employeeId) throw new HttpError(404, "Booking not found.", "NOT_FOUND");
    if (b.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active.", "NOT_ACTIVE");
    await tx.unmuteBooking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now(), cancelledBy: "HOST" } });
    await writeAuditLogs([{ ...meta, action: "unmute.booking.cancelled", entityType: "UnmuteBooking", entityId: id, after: { by: "HOST" } }], tx);
    return b;
  });
  await notifyPrivately(b.bookerEmployeeId, BOOKER_LINK);
  return { ok: true };
}

export async function complete(actor: PeepsActor, id: string, input: { outcome: "COMPLETED" | "NOT_HELD" }, meta: ActorMeta) {
  await requireHost(actor);
  await prisma.$transaction(async (tx) => {
    const b = await loadLive(tx, id);
    if (b.hostEmployeeId !== actor.employeeId) throw new HttpError(404, "Booking not found.", "NOT_FOUND");
    if (b.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active.", "NOT_ACTIVE");
    if (b.slot.startsAt.getTime() > now().getTime()) throw new HttpError(409, "A conversation can be marked only after it was due to start.", "NOT_YET");
    await tx.unmuteBooking.update({ where: { id }, data: { status: input.outcome, completedAt: now() } });
    await writeAuditLogs([{ ...meta, action: "unmute.booking.completed", entityType: "UnmuteBooking", entityId: id, after: { outcome: input.outcome } }], tx);
  });
  return { ok: true };
}

// ── Directors ──────────────────────────────────────────────────────────────

export async function hosts() {
  const members = await currentMembers();
  const people = await prisma.employee.findMany({ where: { id: { in: [...members.keys()] } }, ...personSelect });
  const out = [];
  for (const p of people) out.push({ ...personOf(p), isHost: await isActiveHost(p.id) });
  return out;
}

export async function authoriseHost(employeeId: string, input: { reason: string }, actor: PeepsActor, meta: ActorMeta) {
  if (!(await memberStateFor(employeeId))) throw new HttpError(409, "Only a Wellsure Office member can be an Unmute host.", "NOT_MEMBER");
  if (await isActiveHost(employeeId)) throw new HttpError(409, "This person is already a host.", "ALREADY_HOST");
  await prisma.$transaction(async (tx) => {
    const row = await tx.unmuteHostAuthorisation.create({ data: { employeeId, action: "AUTHORISE", reason: input.reason, byUserId: actor.userId } });
    await writeAuditLogs([{ ...meta, action: "unmute.host.authorised", entityType: "UnmuteHostAuthorisation", entityId: row.id, after: { employeeId } }], tx);
  });
  return hosts();
}

/**
 * Removing a host: new bookings stop at once (isActiveHost turns false), the host's free open slots are withdrawn, and the bookings already made stay
 * BOOKED and are listed for the directors to reassign or cancel (affectedBookings) — nothing is silently dropped.
 */
export async function revokeHost(employeeId: string, input: { reason: string }, actor: PeepsActor, meta: ActorMeta) {
  const affected = await prisma.$transaction(async (tx) => {
    const latest = await tx.unmuteHostAuthorisation.findFirst({ where: { employeeId }, orderBy: [{ at: "desc" }, { id: "desc" }] });
    if (latest?.action !== "AUTHORISE") throw new HttpError(409, "This person is not a host.", "NOT_HOST");
    const row = await tx.unmuteHostAuthorisation.create({ data: { employeeId, action: "REVOKE", reason: input.reason, byUserId: actor.userId } });
    await tx.unmuteSlot.updateMany({ where: { hostEmployeeId: employeeId, status: "OPEN", startsAt: { gt: now() }, bookings: { none: { status: "BOOKED" } } }, data: { status: "WITHDRAWN", withdrawnAt: now() } });
    const stillBooked = await tx.unmuteBooking.count({ where: { hostEmployeeId: employeeId, status: "BOOKED", slot: { startsAt: { gt: now() } } } });
    await writeAuditLogs([{ ...meta, action: "unmute.host.revoked", entityType: "UnmuteHostAuthorisation", entityId: row.id, after: { employeeId, bookingsToHandle: stillBooked } }], tx);
    return stillBooked;
  });
  return { bookingsToHandle: affected };
}

const adminView = (b: Prisma.UnmuteBookingGetPayload<{ include: { slot: true; host: typeof personSelect; booker: typeof personSelect } }>) => ({
  id: b.id,
  startsAt: b.slot.startsAt.toISOString(),
  endsAt: b.slot.endsAt.toISOString(),
  host: personOf(b.host),
  booker: personOf(b.booker),
  timezone: b.timezone,
  status: b.status,
  bookedAt: b.bookedAt.toISOString(),
  cancelledAt: b.cancelledAt?.toISOString() ?? null,
  cancelledBy: b.cancelledBy,
  rescheduledAt: b.rescheduledAt?.toISOString() ?? null,
  completedAt: b.completedAt?.toISOString() ?? null,
});

/** Every booking, for the directors (D-28). Opening them is audited, one entry per booking that is not the director's own. */
export async function allBookings(actor: PeepsActor, meta: ActorMeta) {
  const rows = await prisma.unmuteBooking.findMany({ orderBy: { bookedAt: "desc" }, take: 500, include: { slot: true, host: personSelect, booker: personSelect } });
  await auditDirectorOpen(actor, meta, "UnmuteBooking", rows.map((r) => r.id), (id) => {
    const r = rows.find((x) => x.id === id)!;
    return r.bookerEmployeeId === actor.employeeId || r.hostEmployeeId === actor.employeeId;
  });
  return rows.map(adminView);
}

export async function getBooking(id: string, actor: PeepsActor, meta: ActorMeta) {
  const b = await prisma.unmuteBooking.findUnique({ where: { id }, include: { slot: true, host: personSelect, booker: personSelect } });
  const participant = b && (b.bookerEmployeeId === actor.employeeId || b.hostEmployeeId === actor.employeeId);
  if (!b || (!participant && !actor.isDirector)) throw new HttpError(404, "Booking not found.", "NOT_FOUND");
  await auditDirectorOpen(actor, meta, "UnmuteBooking", [b.id], () => Boolean(participant));
  return adminView(b);
}

/** Bookings still BOOKED in the future whose host is no longer an active host: the directors reassign or cancel each one. */
export async function affectedBookings(actor: PeepsActor, meta: ActorMeta) {
  const rows = await prisma.unmuteBooking.findMany({ where: { status: "BOOKED", slot: { startsAt: { gt: now() } } }, orderBy: { bookedAt: "asc" }, include: { slot: true, host: personSelect, booker: personSelect } });
  const out = [];
  for (const r of rows) if (!(await isActiveHost(r.hostEmployeeId))) out.push(r);
  await auditDirectorOpen(actor, meta, "UnmuteBooking", out.map((r) => r.id), () => false);
  return out.map(adminView);
}

export async function freeSlots() {
  const slots = await prisma.unmuteSlot.findMany({ where: { status: "OPEN", startsAt: { gt: now() }, bookings: { none: { status: "BOOKED" } } }, orderBy: { startsAt: "asc" }, take: 500, include: { host: personSelect } });
  const out = [];
  for (const s of slots) if (await isActiveHost(s.hostEmployeeId)) out.push({ id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), host: personOf(s.host) });
  return out;
}

export async function reassign(id: string, input: { slotId: string }, meta: ActorMeta) {
  const s = await requireActive();
  const next = await prisma
    .$transaction(async (tx) => {
      const b = await loadLive(tx, id);
      if (b.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active.", "NOT_ACTIVE");
      const next = await bookInTx(tx, s, input.slotId, b.bookerEmployeeId, b.timezone, { checkNotice: false });
      await tx.unmuteBooking.update({ where: { id }, data: { status: "RESCHEDULED", rescheduledAt: now(), rescheduledToId: next.id } });
      await writeAuditLogs([{ ...meta, action: "unmute.booking.reassigned", entityType: "UnmuteBooking", entityId: id, after: { to: next.id } }], tx);
      return next;
    })
    .catch(oneLive);
  await notifyPrivately(next.bookerEmployeeId, BOOKER_LINK);
  await notifyPrivately(next.hostEmployeeId, HOST_LINK);
  return { id: next.id };
}

export async function cancelAsSystem(id: string, meta: ActorMeta) {
  const b = await prisma.$transaction(async (tx) => {
    const b = await loadLive(tx, id);
    if (b.status !== "BOOKED") throw new HttpError(409, "This booking is no longer active.", "NOT_ACTIVE");
    await tx.unmuteBooking.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: now(), cancelledBy: "SYSTEM" } });
    await writeAuditLogs([{ ...meta, action: "unmute.booking.cancelled", entityType: "UnmuteBooking", entityId: id, after: { by: "SYSTEM" } }], tx);
    return b;
  });
  await notifyPrivately(b.bookerEmployeeId, BOOKER_LINK);
  return { ok: true };
}
