import { prisma } from "../../lib/prisma";
import { confirmSetting, enterSetting } from "../peeps/settings";
import type { PeepsActor } from "../peeps/types";
import { give } from "./badges";
import { send } from "./nudges";

// The demo company's badges and private nudges (development only; scripts/demo/seedDemoCompany.ts, after the Wellsure Office demo). Made-up values,
// labelled DEMO, through the real services: the directors set the catalogue (givers follow the reporting line, D-36; corrective notes are switched on for the demo only); a demo director
// (DEMO001) gives DEMO006 a badge and sends them a private nudge whose text carries a marker the sensitive-data scan looks for on every other screen.

type Who = Record<string, { employeeId: string; userId: string }>;
export const DEMO_NUDGE_MARKER = "DEMO-NUDGE-PRIVATE";

export async function seedDemoRecognition(who: Who): Promise<void> {
  if ((await prisma.badgeAward.count()) > 0 || (await prisma.privateNudge.count()) > 0) return;
  const meta = (code: string) => ({ actorUserId: who[code]!.userId, ipAddress: null, userAgent: null });
  const actor = (code: string, extra: Partial<PeepsActor> = {}): PeepsActor => ({ userId: who[code]!.userId, employeeId: who[code]!.employeeId, isDirector: false, isMember: false, capabilities: [], roleCodes: [], ...extra });
  const set = async (key: Parameters<typeof enterSetting>[0], value: unknown) => {
    const v = await enterSetting(key, { value, note: "DEMO COMPANY" }, actor("DEMO001", { isDirector: true }), meta("DEMO001"));
    await confirmSetting(key, { version: v.pending!.version }, actor("DEMO013", { isDirector: true }), meta("DEMO013"));
  };
  await set("badges.catalogue", [{ code: "DEMO_THANKS", label: "DEMO Thank you", duration: "MONTH" }, { code: "DEMO_TEAM_PLAYER", label: "DEMO Team player", duration: "PERMANENT" }]);
  await set("nudges.enabled", { enabled: true }); // DEMO: the demo's directors have switched corrective notes on (D-37: Not set for the real company)
  const director = actor("DEMO001", { isDirector: true, roleCodes: ["SUPER_ADMIN"] });
  await give(director, { recipientEmployeeId: who.DEMO006!.employeeId, badgeCode: "DEMO_THANKS", message: "DEMO COMPANY", idempotencyKey: "demo-badge-0001" }, meta("DEMO001"));
  await send(director, { recipientEmployeeId: who.DEMO006!.employeeId, body: `${DEMO_NUDGE_MARKER}: a made-up private note for the demo`, idempotencyKey: "demo-nudge-0001" }, meta("DEMO001"));
}
