import type { RecognitionGiverKind } from "@prisma/client";
import { PEEPS_REQUIRED } from "@shared/constants/peeps";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { getTeamEmployeeIds } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { isTopLevel } from "../../lib/reportingHierarchy";
import { HttpError } from "../../middleware/errorHandler";
import { assertSettings, getSetting, officeName } from "../peeps/settings";
import type { PeepsActor } from "../peeps/types";

// Who may give (owner decision D-36, which replaces Q-16 for badges and cheers; D-37 for corrective notes).
//   Badges and cheers follow the reporting relationship, never the department:
//     - downward: to anyone under the giver in their reporting line (their reports and everyone below them);
//     - upward: to their manager and on up the chain. Managers and HR Admins report to the directors by design (they have no manager), so the
//       top of a chain reaches the directors; someone with no manager who is not one of them follows the "no manager on record" setting (Not
//       set: nobody above them);
//     - directors give to anyone; Wellsure Office members with "Give badges" give to anyone only while the directors' setting allows it;
//     - never to peers or to another reporting line; the Developer never gives. An HR role adds no reach and takes none away.
//   Corrective notes (nudges): the directors only, and only once the directors switch them on.

export type RecognitionModule = "badges" | "nudges";
const LABEL: Record<RecognitionModule, string> = { badges: "Badges", nudges: "Corrective notes" };

export const isDeveloper = (actor: PeepsActor) => actor.roleCodes.includes(DEVELOPER_ROLE_CODE);

export async function assertModuleActive(module: RecognitionModule): Promise<void> {
  await assertSettings(PEEPS_REQUIRED[module], LABEL[module]);
  if (module === "nudges" && (await getSetting<{ enabled: boolean }>("nudges.enabled"))?.enabled !== true) {
    throw new HttpError(409, "Corrective notes are switched off by the directors.", "NOT_SET_UP");
  }
}

const officeWidened = async (actor: PeepsActor) =>
  actor.isMember && actor.capabilities.includes("GIVE_BADGES") && (await getSetting<{ officeGivesToAnyone: boolean }>("audience.badges"))?.officeGivesToAnyone === true;

async function managerOf(employeeId: string): Promise<string | null> {
  const row = await prisma.employeeJobHistory.findFirst({ where: { employeeId, ...inForceOn() }, select: { reportingManagerId: true } });
  return row?.reportingManagerId ?? null;
}

async function rolesOf(employeeId: string): Promise<string[]> {
  const user = await prisma.user.findUnique({ where: { employeeId }, select: { roles: { select: { role: { select: { code: true } } } } } });
  return user?.roles.map((r) => r.role.code) ?? [];
}

async function directorEmployeeIds(): Promise<string[]> {
  const users = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: "SUPER_ADMIN" } } }, employee: { status: "ACTIVE" } }, select: { employeeId: true } });
  return users.map((u) => u.employeeId);
}

/** Everyone above this person: their manager chain, then the directors where the chain ends at a manager or HR Admin (or by the fallback setting). */
export async function upwardOf(employeeId: string): Promise<string[]> {
  const chain: string[] = [];
  let current = employeeId;
  for (let hop = 0; hop < 50; hop += 1) {
    const m = await managerOf(current);
    if (!m || chain.includes(m) || m === employeeId) break;
    chain.push(m);
    current = m;
  }
  const top = chain.length ? chain[chain.length - 1]! : employeeId;
  const reachesDirectors = isTopLevel(await rolesOf(top)) || (await getSetting<{ upTo: string }>("badges.noManagerFallback"))?.upTo === "DIRECTORS";
  return reachesDirectors ? [...new Set([...chain, ...(await directorEmployeeIds())])].filter((id) => id !== employeeId) : chain;
}

/** How this person may give to this recipient, or a refusal. */
export async function giverKindFor(actor: PeepsActor, recipientEmployeeId: string, module: RecognitionModule): Promise<RecognitionGiverKind> {
  await assertModuleActive(module);
  if (recipientEmployeeId === actor.employeeId) throw new HttpError(409, "You cannot do this for yourself.", "SELF");
  const recipient = await prisma.employee.findUnique({ where: { id: recipientEmployeeId }, select: { status: true } });
  if (!recipient || recipient.status !== "ACTIVE") throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const refuse = () => new HttpError(403, module === "badges" ? "You can give only along your reporting line." : "Only a director sends a corrective note.", "FORBIDDEN");
  if (isDeveloper(actor)) throw refuse();
  if (actor.isDirector) return "DIRECTOR";
  if (module === "nudges") throw refuse();
  if (await officeWidened(actor)) return "OFFICE";
  if ((await getTeamEmployeeIds(actor.employeeId)).includes(recipientEmployeeId)) return "DOWNWARD";
  if ((await upwardOf(actor.employeeId)).includes(recipientEmployeeId)) return "UPWARD";
  throw refuse();
}

/** Whether this person could give to anyone at all, and to whom: everyone, or the people along their reporting line. */
export async function canGive(actor: PeepsActor, module: RecognitionModule): Promise<{ any: boolean; scope: "ALL" | "LINE" | "NONE" }> {
  if (isDeveloper(actor)) return { any: false, scope: "NONE" };
  if (actor.isDirector) return { any: true, scope: "ALL" };
  if (module === "nudges") return { any: false, scope: "NONE" };
  if (await officeWidened(actor)) return { any: true, scope: "ALL" };
  const line = (await getTeamEmployeeIds(actor.employeeId)).length + (await upwardOf(actor.employeeId)).length;
  return line > 0 ? { any: true, scope: "LINE" } : { any: false, scope: "NONE" };
}

export async function recipientsFor(actor: PeepsActor, module: RecognitionModule, q: string) {
  await assertModuleActive(module);
  const { scope } = await canGive(actor, module);
  if (scope === "NONE") return [];
  const line = scope === "LINE" ? [...new Set([...(await getTeamEmployeeIds(actor.employeeId)), ...(await upwardOf(actor.employeeId))])] : null;
  const rows = await prisma.employee.findMany({
    where: {
      status: "ACTIVE",
      id: line ? { in: line, not: actor.employeeId } : { not: actor.employeeId },
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

/** When an item given at `at` ends (D-36): the last instant of that calendar week (Monday to Sunday) or month in India; null for a permanent one. */
export function expiryFor(duration: "WEEK" | "MONTH" | "PERMANENT", at: Date): Date | null {
  if (duration === "PERMANENT") return null;
  const ist = new Date(at.getTime() + 330 * 60_000);
  const y = ist.getUTCFullYear();
  const m = ist.getUTCMonth();
  const d = ist.getUTCDate();
  const endIst = duration === "MONTH" ? Date.UTC(y, m + 1, 1) : Date.UTC(y, m, d + (7 - ((ist.getUTCDay() + 6) % 7)));
  return new Date(endIst - 330 * 60_000 - 1);
}

/** The giver as a reader sees them: a director or the Wellsure Office as the workspace's name; anyone else (manager, colleague along the line) by name. */
export async function giverLabels(rows: Array<{ giverUserId: string; giverKind: RecognitionGiverKind }>): Promise<(r: { giverUserId: string; giverKind: RecognitionGiverKind }) => string> {
  const office = await officeName();
  const named = rows.filter((r) => r.giverKind !== "DIRECTOR" && r.giverKind !== "OFFICE").map((r) => r.giverUserId);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(named)] } }, select: { id: true, employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } });
  const name = new Map(users.map((u) => [u.id, u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode]));
  return (r) => (r.giverKind === "DIRECTOR" || r.giverKind === "OFFICE" ? office : (name.get(r.giverUserId) ?? "A colleague"));
}

export async function employeeRef(employeeId: string) {
  const e = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } });
  return e ? { employeeId: e.id, employeeCode: e.employeeCode, name: e.nameHistory[0]?.fullName ?? e.employeeCode } : null;
}
