import { prisma } from "../../lib/prisma";
import type { PeepsActor } from "../peeps/types";
import { give } from "./badges";
import { give as giveTag } from "./nudgeTags";
import { insertLegacyNoteFixture } from "./nudges";

// The demo company's recognition (development only; scripts/demo/seedDemoCompany.ts, after the Wellsure Office demo). Made-up values, labelled DEMO,
// through the real services where a service exists. Peeps Stage 3: the badge and nudge-tag catalogues are the shipped defaults ("Default, change in
// settings"), so nothing is set here. A director (DEMO001) gives DEMO006 a badge and a nudge tag; DEMO007 (a report along a line) thanks their manager.
// The old private corrective notes are read-only now: the demo keeps one existing note (written as a development fixture, which the database allows
// only where its dev marker exists) whose text carries a marker the sensitive-data scan looks for on every other screen.

type Who = Record<string, { employeeId: string; userId: string }>;
export const DEMO_NUDGE_MARKER = "DEMO-NUDGE-PRIVATE";

export async function seedDemoRecognition(who: Who): Promise<void> {
  if ((await prisma.badgeAward.count()) > 0 || (await prisma.privateNudge.count()) > 0 || (await prisma.nudgeTagAward.count()) > 0) return;
  const meta = (code: string) => ({ actorUserId: who[code]!.userId, ipAddress: null, userAgent: null });
  const director: PeepsActor = { userId: who.DEMO001!.userId, employeeId: who.DEMO001!.employeeId, isDirector: true, isMember: false, capabilities: [], roleCodes: ["SUPER_ADMIN"] };
  await give(director, { recipientEmployeeId: who.DEMO006!.employeeId, badgeCode: "TEAM_PLAYER", message: "DEMO COMPANY: helped the whole team this month", idempotencyKey: "demo-badge-0001" }, meta("DEMO001"));
  await give(director, { recipientEmployeeId: who.DEMO007!.employeeId, badgeCode: "MENTOR", message: "DEMO COMPANY: brought two new joiners up to speed", idempotencyKey: "demo-badge-0002" }, meta("DEMO001"));
  await giveTag(director, { recipientEmployeeId: who.DEMO006!.employeeId, tagCode: "CHAI_BREAK_CHAMP", idempotencyKey: "demo-nudge-tag-0001" }, meta("DEMO001"));
  await insertLegacyNoteFixture({ recipientEmployeeId: who.DEMO006!.employeeId, senderUserId: who.DEMO001!.userId, body: `${DEMO_NUDGE_MARKER}: a made-up private note for the demo (from before notes became read-only)`, idempotencyKey: "demo-nudge-0001" });
}
