import type { RecognitionGiverKind } from "@prisma/client";
import { PEEPS_REQUIRED, type GiverKind } from "@shared/constants/peeps";
import { HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { getTeamEmployeeIds } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { assertSettings, getSetting, officeName } from "../peeps/settings";
import type { PeepsActor } from "../peeps/types";

// Who may give a badge or send a private nudge (Q-16, a director setting): the directors always; Wellsure Office members with the matching capability,
// while the setting lists the Wellsure Office; managers, to their own team, while the setting lists managers. HR never gives (D-29) — an HR person can
// give only if the directors made them a member. Nobody gives to themselves.

export type RecognitionModule = "badges" | "nudges";
const CAPABILITY: Record<RecognitionModule, string> = { badges: "GIVE_BADGES", nudges: "SEND_NUDGES" };
const AUDIENCE_FIELD: Record<RecognitionModule, string> = { badges: "givers", nudges: "senders" };
const LABEL: Record<RecognitionModule, string> = { badges: "Badges", nudges: "Private nudges" };

export const isHr = (actor: PeepsActor) => actor.roleCodes.some((c) => (HR_ROLE_CODES as readonly string[]).includes(c));

async function audience(module: RecognitionModule): Promise<GiverKind[]> {
  const value = await getSetting<Record<string, GiverKind[]>>(module === "badges" ? "audience.badges" : "audience.nudges");
  return value?.[AUDIENCE_FIELD[module]] ?? [];
}

export async function assertModuleActive(module: RecognitionModule): Promise<void> {
  await assertSettings(PEEPS_REQUIRED[module], LABEL[module]);
}

const viaOffice = async (actor: PeepsActor, module: RecognitionModule) => actor.isMember && actor.capabilities.includes(CAPABILITY[module]) && (await audience(module)).includes("OFFICE");
const viaManager = async (actor: PeepsActor, module: RecognitionModule) => !isHr(actor) && (await audience(module)).includes("MANAGERS");

/** The kind of giver this person is for this recipient, or a refusal. */
export async function giverKindFor(actor: PeepsActor, recipientEmployeeId: string, module: RecognitionModule): Promise<RecognitionGiverKind> {
  await assertModuleActive(module);
  if (recipientEmployeeId === actor.employeeId) throw new HttpError(409, "You cannot do this for yourself.", "SELF");
  const recipient = await prisma.employee.findUnique({ where: { id: recipientEmployeeId }, select: { status: true } });
  if (!recipient || recipient.status !== "ACTIVE") throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (actor.isDirector) return "DIRECTOR";
  if (await viaOffice(actor, module)) return "OFFICE";
  if ((await viaManager(actor, module)) && (await getTeamEmployeeIds(actor.employeeId)).includes(recipientEmployeeId)) return "MANAGER";
  throw new HttpError(403, module === "badges" ? "You may not give a badge to this person." : "You may not send a private nudge to this person.", "FORBIDDEN");
}

/** Whether this person could give to anyone at all (for showing the action), and to whom (for the picker). */
export async function canGive(actor: PeepsActor, module: RecognitionModule): Promise<{ any: boolean; scope: "ALL" | "TEAM" | "NONE" }> {
  if (actor.isDirector || (await viaOffice(actor, module))) return { any: true, scope: "ALL" };
  if ((await viaManager(actor, module)) && (await getTeamEmployeeIds(actor.employeeId)).length > 0) return { any: true, scope: "TEAM" };
  return { any: false, scope: "NONE" };
}

export async function recipientsFor(actor: PeepsActor, module: RecognitionModule, q: string) {
  await assertModuleActive(module);
  const { scope } = await canGive(actor, module);
  if (scope === "NONE") return [];
  const team = scope === "TEAM" ? await getTeamEmployeeIds(actor.employeeId) : null;
  const rows = await prisma.employee.findMany({
    where: {
      status: "ACTIVE",
      id: team ? { in: team, not: actor.employeeId } : { not: actor.employeeId },
      ...(q ? { OR: [{ employeeCode: { contains: q, mode: "insensitive" } }, { nameHistory: { some: { ...inForceOn(), fullName: { contains: q, mode: "insensitive" } } } }] } : {}),
    },
    orderBy: { employeeCode: "asc" },
    take: 20,
    select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } },
  });
  return rows.map((e) => ({ employeeId: e.id, employeeCode: e.employeeCode, name: e.nameHistory[0]?.fullName ?? e.employeeCode }));
}

/** Start of the current calendar month in the company's timezone (IST, no daylight saving), for monthly limits. */
export function monthStart(now: Date = new Date()): Date { // allow-clock: an instant
  const ist = new Date(now.getTime() + 330 * 60_000);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - 330 * 60_000);
}

/** What a recipient sees for the giver: the manager by name, otherwise the workspace's name (the named person is in the audit log only, D-30). */
export async function giverLabels(rows: Array<{ giverUserId: string; giverKind: RecognitionGiverKind }>): Promise<(r: { giverUserId: string; giverKind: RecognitionGiverKind }) => string> {
  const office = await officeName();
  const managers = rows.filter((r) => r.giverKind === "MANAGER").map((r) => r.giverUserId);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(managers)] } }, select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } });
  const name = new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
  return (r) => (r.giverKind === "MANAGER" ? (name.get(r.giverUserId) ?? "Your manager") : office);
}

export async function employeeRef(employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } });
  return e ? { employeeId: e.id, employeeCode: e.employeeCode, name: e.nameHistory[0]?.fullName ?? e.employeeCode } : null;
}
