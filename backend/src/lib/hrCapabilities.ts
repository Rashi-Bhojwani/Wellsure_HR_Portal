import { HR_CAPABILITIES, HR_CAPABILITY_IDS, type HrCapabilityId } from "@shared/constants/hrCapabilities";
import { HR_FORBIDDEN_KEYS, HR_ROLE_CODES } from "@shared/constants/sensitiveData";
import { prisma } from "./prisma";

// The HR capability switches (docs/plans/HR_CAPABILITIES.md §1B), applied inside resolveAccess so that every route, service check, socket room, task count and menu follows
// from one place. Nothing here reads a cache: the rows are read on every resolution for an HR holder (two indexed lookups), so a switch is in force on the next request.

export interface SwitchRow {
  capability: string;
  subjectKind: string;
  subjectKey: string;
  state: string;
  effectiveFrom: Date;
}

const HR_FORBIDDEN = new Set<string>(HR_FORBIDDEN_KEYS);
const isHrRole = (code: string) => (HR_ROLE_CODES as readonly string[]).includes(code);

/** The latest row in force for one subject and capability, or null (never set, or the latest says DEFAULT). */
export function rowState(rows: SwitchRow[], capability: string, kind: string, key: string, now: Date): "ON" | "OFF" | null {
  let best: SwitchRow | null = null;
  for (const r of rows) {
    if (r.capability !== capability || r.subjectKind !== kind || r.subjectKey !== key || r.effectiveFrom.getTime() > now.getTime()) continue;
    if (!best || r.effectiveFrom.getTime() > best.effectiveFrom.getTime()) best = r;
  }
  const state = best?.state;
  return state === "ON" || state === "OFF" ? state : null;
}

/**
 * What the switches say about one capability for one person. A named-person row beats a role row; among the HR roles a person holds, OFF beats ON; no row at all (or DEFAULT) says
 * nothing, and the role's own permission rows decide, as they always did.
 */
export function capabilityState(rows: SwitchRow[], capability: string, userId: string, roleCodes: readonly string[], now: Date): "ON" | "OFF" | null {
  const person = rowState(rows, capability, "USER", userId, now);
  if (person) return person;
  const byRole = roleCodes.filter(isHrRole).map((code) => rowState(rows, capability, "ROLE", code, now));
  if (byRole.includes("OFF")) return "OFF";
  if (byRole.includes("ON")) return "ON";
  return null;
}

/** Applies the switches to a permission set (mutating it): OFF removes the capability's keys, ON adds them, and the hard-locked set is stripped last, so a switch can never add pay data. */
export function applyCapabilities(permissions: Set<string>, rows: SwitchRow[], userId: string, roleCodes: readonly string[], now: Date): void {
  for (const cap of HR_CAPABILITIES) {
    const state = capabilityState(rows, cap.id, userId, roleCodes, now);
    if (state === "OFF") for (const k of cap.keys) permissions.delete(k);
    else if (state === "ON") for (const k of cap.keys) permissions.add(k);
  }
  for (const k of [...permissions]) if (HR_FORBIDDEN.has(k)) permissions.delete(k);
}

/** The rows that can matter to this person: their own and their HR roles'. Empty (and no query) for anyone who holds no HR role. */
export async function switchRowsFor(userId: string, roleCodes: readonly string[]): Promise<SwitchRow[]> {
  const hrRoles = roleCodes.filter(isHrRole);
  if (hrRoles.length === 0) return [];
  return prisma.hrCapabilitySwitch.findMany({
    where: { OR: [{ subjectKind: "ROLE", subjectKey: { in: hrRoles } }, { subjectKind: "USER", subjectKey: userId }] },
    select: { capability: true, subjectKind: true, subjectKey: true, state: true, effectiveFrom: true },
  });
}

export const isCapabilityId = (id: string): id is HrCapabilityId => (HR_CAPABILITY_IDS as readonly string[]).includes(id);
