import type { PeepsSettingKey } from "@shared/constants/peeps";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { confirmChange, proposeChange } from "../office";
import { confirmSetting, enterSetting } from "../settings";
import type { PeepsActor } from "../types";

// Test helpers for the Peeps core: settings entered by one director and confirmed by the other, members appointed the same way, and cleanup of the
// global rows (settings are company-wide, so every file removes its own at the end). Fixtures only; never used by application code.

export type Who = { employeeId: string; userId: string };
const meta = (w: Who) => ({ actorUserId: w.userId, ipAddress: null, userAgent: null });
export const directorActor = (w: Who): PeepsActor => ({ userId: w.userId, employeeId: w.employeeId, isDirector: true, isMember: false, capabilities: [], roleCodes: ["SUPER_ADMIN"] });

export async function setSetting(key: PeepsSettingKey, value: unknown, d1: Who, d2: Who): Promise<void> {
  const view = await enterSetting(key, { value }, directorActor(d1), meta(d1));
  await confirmSetting(key, { version: view.pending!.version }, directorActor(d2), meta(d2));
}

export async function appoint(employeeId: string, capabilities: string[], d1: Who, d2: Who): Promise<string> {
  const change = await proposeChange({ kind: "APPOINT", employeeId, capabilities: capabilities as never, reason: "test fixture" }, directorActor(d1), meta(d1));
  await confirmChange(change.id, directorActor(d2), meta(d2));
  return change.id;
}

export async function removeMember(employeeId: string, d1: Who, d2: Who): Promise<void> {
  const change = await proposeChange({ kind: "REMOVE", employeeId, reason: "test fixture" }, directorActor(d1), meta(d1));
  await confirmChange(change.id, directorActor(d2), meta(d2));
}

/** Removes every Peeps setting version (and its audit rows): settings are global, so a file leaves none behind. */
export async function clearPeepsSettings(): Promise<void> {
  const ids = (await prisma.peepsSettingVersion.findMany({ select: { id: true } })).map((r) => r.id);
  await purgeAppendOnly("AuditLog", { entityId: { in: ids } });
  await deleteWithDependents("PeepsSettingVersion", ids);
}
