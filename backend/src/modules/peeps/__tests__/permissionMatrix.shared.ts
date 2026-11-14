import { OFFICE_CAPABILITY_IDS } from "@shared/constants/peeps";
import { prisma } from "../../../lib/prisma";
import { createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { listApiRoutes } from "../../managers/__tests__/routeList";
import { ROUTE_CLASSIFICATION } from "../../managers/__tests__/routeInventory";
import { appoint } from "./peepsTestKit";

// Shared by the Peeps permission matrix (Stage 4): which routes are Peeps routes, the ten actors, and how one call is made.
export const ACTORS = ["anon", "employee", "empManager", "otherManager", "hr", "member", "nonMember", "director", "developer", "former"] as const;
export type Actor = (typeof ACTORS)[number];

const PEEPS_PREFIXES = ["/api/recruitment", "/api/insights", "/api/autofill", "/api/badges", "/api/nudges", "/api/assets", "/api/peeps", "/api/exits", "/api/unmute", "/api/leave-rules", "/api/leave-documents", "/api/avatars", "/api/joining"];
/** Every Peeps route the API serves: by prefix, plus the PEEPS blocks of the route inventory (helpdesk visibility, people photos, ...). */
export function peepsRoutes(inventorySource: string): string[] {
  const all = listApiRoutes().map((r) => r.id);
  const fromBlocks = new Set<string>();
  for (const m of inventorySource.matchAll(/\/\/ PEEPS-BEGIN [^\n]*\n([\s\S]*?)\/\/ PEEPS-END/g)) for (const k of m[1]!.matchAll(/^\s*"((?:GET|POST|PUT|PATCH|DELETE) [^"]+)"/gm)) fromBlocks.add(k[1]!);
  return all.filter((id) => fromBlocks.has(id) || PEEPS_PREFIXES.some((p) => id.split(" ", 2)[1]!.startsWith(p))).filter((id) => ROUTE_CLASSIFICATION[id]).sort();
}

export type People = Record<Exclude<Actor, "anon">, { employeeId: string; employeeCode: string; userId: string }> & { director2: { employeeId: string; employeeCode: string; userId: string } };

export async function makeActors(org: TestOrgMasters): Promise<{ people: People; tokens: Partial<Record<Actor, string>> }> {
  const p = {} as People;
  p.director = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
  p.director2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
  p.empManager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
  p.employee = await createFullTestEmployee(org, { managerId: p.empManager.employeeId });
  p.otherManager = await createFullTestEmployee(org, { roleCode: "MANAGER" });
  p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
  p.member = await createFullTestEmployee(org);
  p.nonMember = await createFullTestEmployee(org);
  p.developer = await createFullTestEmployee(org, { roleCode: "DEVELOPER" });
  p.former = await createFullTestEmployee(org);
  const tokens: Partial<Record<Actor, string>> = {};
  for (const a of ACTORS) if (a !== "anon") tokens[a] = await loginAs(p[a].employeeCode);
  await appoint(p.member.employeeId, [...OFFICE_CAPABILITY_IDS], p.director, p.director2);
  await prisma.user.update({ where: { id: p.former.userId }, data: { status: "DEACTIVATED" } });
  await prisma.employee.update({ where: { id: p.former.employeeId }, data: { status: "SEPARATED" } });
  return { people: p, tokens };
}

/** The path with every :param replaced by an id that does not exist, so no call touches a real record (enum params get a valid value). */
const PARAM_VALUES: Record<string, Record<string, string>> = {
  "/api/insights": { metric: "turnover", key: "window" },
  "/api/autofill": { key: "retention" },
  "/api/recruitment": { key: "sources" },
};
export function concretePath(path: string): string {
  const values = Object.entries(PARAM_VALUES).find(([prefix]) => path.startsWith(prefix))?.[1] ?? {};
  return path.replace(/:([A-Za-z]+)/g, (_m, name: string) => values[name] ?? "zz-missing-0000");
}

/** Bodies that pass validation, so a service-level refusal shows as 403 instead of a 400 from the validator. Anything else gets {}. */
// A stale version: a director gets 409 (nothing is saved); everyone else must be refused before that.
const SETTING_BODY = { value: null, version: 999, reason: "permission matrix probe" };
export const PROBE_BODIES: Record<string, object> = {
  "PUT /api/insights/settings/:key": SETTING_BODY,
  "PUT /api/autofill/settings/:key": SETTING_BODY,
  "PUT /api/recruitment/settings/:key": SETTING_BODY,
  "PUT /api/recruitment/offers/:id/compensation": { amount: "1000.00", period: "ANNUAL", version: 0 },
  "PUT /api/recruitment/candidates/:id/expected-pay": { value: null },
};
/** Reach = the gate let the call through (anything but 401/403); deny = 401 or 403. */
export const outcome = (status: number) => (status === 401 || status === 403 ? "D" : "R");
