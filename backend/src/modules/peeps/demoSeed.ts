import { prisma } from "../../lib/prisma";
import { authoriseHost, book, createSlot } from "../unmute/service";
import { confirmChange, proposeChange } from "./office";
import { confirmSetting, enterSetting } from "./settings";
import type { PeepsActor } from "./types";

// The demo company's Wellsure Office and Unmute (development only; called from scripts/demo/seedDemoCompany.ts). Every value is made up for the demo.
// It goes through the real services as the demo's people: one director enters each setting and appoints the member, the other confirms; the member is
// authorised as a host, offers a time tomorrow, and DEMO006 books it. The sensitive-data scan checks that DEMO006 never sees the host's name and that
// another employee never sees DEMO006's booking.

type Who = Record<string, { employeeId: string; userId: string }>;

export const DEMO_OFFICE_MEMBER = "DEMO008";

export async function seedDemoOffice(who: Who): Promise<void> {
  if ((await prisma.peepsSettingVersion.count()) > 0 || (await prisma.officeMembershipChange.count()) > 0) return; // already seeded: never touched again
  const meta = (code: string) => ({ actorUserId: who[code]!.userId, ipAddress: null, userAgent: null });
  const director = (code: string): PeepsActor => ({ userId: who[code]!.userId, employeeId: who[code]!.employeeId, isDirector: true, isMember: false, capabilities: [], roleCodes: ["SUPER_ADMIN"] });
  const employee = (code: string): PeepsActor => ({ userId: who[code]!.userId, employeeId: who[code]!.employeeId, isDirector: false, isMember: false, capabilities: [], roleCodes: [] });
  const set = async (key: Parameters<typeof enterSetting>[0], value: unknown) => {
    const v = await enterSetting(key, { value, note: "DEMO COMPANY" }, director("DEMO001"), meta("DEMO001"));
    await confirmSetting(key, { version: v.pending!.version }, director("DEMO013"), meta("DEMO013"));
  };

  await set("audience.assets", { officeManages: true, hrOnboardingIssue: true });
  await set("assets.newJoinerWindowDays", 30);
  await set("audience.unmute", { employeesMayBook: true });
  await set("unmute.sessionMinutes", 30);
  await set("unmute.availability", { days: [0, 1, 2, 3, 4, 5, 6], from: "09:00", to: "18:00" });
  await set("unmute.bookingWindowDays", 14);
  await set("unmute.minNoticeHours", 0);
  await set("unmute.cancellationNoticeHours", 1);

  const change = await proposeChange({ kind: "APPOINT", employeeId: who[DEMO_OFFICE_MEMBER]!.employeeId, capabilities: ["MANAGE_ASSETS", "PREPARE_SETTINGS", "GIVE_BADGES", "SEND_NUDGES"], reason: "DEMO COMPANY" }, director("DEMO001"), meta("DEMO001"));
  await confirmChange(change.id, director("DEMO013"), meta("DEMO013"));
  await authoriseHost(who[DEMO_OFFICE_MEMBER]!.employeeId, { reason: "DEMO COMPANY" }, director("DEMO001"), meta("DEMO001"));

  const host: PeepsActor = { ...employee(DEMO_OFFICE_MEMBER), isMember: true };
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(Date.now() + 86_400_000));
  const first = await createSlot(host, { startsAt: new Date(`${day}T10:00:00+05:30`).toISOString() }, meta(DEMO_OFFICE_MEMBER));
  await createSlot(host, { startsAt: new Date(`${day}T11:00:00+05:30`).toISOString() }, meta(DEMO_OFFICE_MEMBER));
  await book(employee("DEMO006"), { slotId: first.id, timezone: "Asia/Kolkata" }, meta("DEMO006"));
}
