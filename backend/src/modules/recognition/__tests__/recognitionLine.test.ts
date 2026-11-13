import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import type { PeepsActor } from "../../peeps/types";
import { giverKindFor } from "../common";

// Peeps Stage 3: the badge-giving rule against an independent reference model over random org charts. The model is written from the owner's words,
// not from the service: a senior gives to anyone below them in their own line; anyone gives up their own line to their manager and on to the
// directors; directors give to anyone; nobody gives sideways or to another line; never to oneself; the Developer never gives. With the shipped
// default ("someone with no manager may give up to the directors"), every chain ends at the directors.

type Node = { idx: number; manager: number | null; role?: "MANAGER" | "HR_ADMIN" | "DEVELOPER"; employeeId: string; userId: string };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}

/** The reference model: pure, over the chart alone. */
function allowedByModel(nodes: Node[], directors: Set<number>, from: number, to: number): boolean {
  if (from === to) return false;
  if (nodes[from]!.role === "DEVELOPER") return false;
  if (directors.has(from)) return true;
  const below = new Set<number>();
  const walkDown = (i: number) => nodes.filter((n) => n.manager === i).forEach((n) => { below.add(n.idx); walkDown(n.idx); });
  walkDown(from);
  if (below.has(to)) return true;
  const above = new Set<number>(directors);
  for (let m = nodes[from]!.manager; m !== null; m = nodes[m]!.manager) above.add(m);
  return above.has(to);
}

describe("badge giving: the reporting line against a reference model over random org charts", () => {
  let org: TestOrgMasters;
  const created: string[] = [];
  const charts: Array<{ nodes: Node[]; directors: Set<number> }> = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const seed of [7, 42, 2026]) {
      const r = rng(seed);
      const nodes: Node[] = [];
      const directors = new Set<number>();
      for (let i = 0; i < 2; i += 1) {
        const e = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
        created.push(e.employeeId);
        nodes.push({ idx: i, manager: null, employeeId: e.employeeId, userId: e.userId });
        directors.add(i);
      }
      for (let i = 2; i < 13; i += 1) {
        const candidates = nodes.filter((n) => !directors.has(n.idx) && n.role !== "DEVELOPER");
        const manager = candidates.length && r() > 0.25 ? candidates[Math.floor(r() * candidates.length)]!.idx : null;
        const x = r();
        const role = x < 0.15 ? "MANAGER" : x < 0.25 ? "HR_ADMIN" : x < 0.32 ? "DEVELOPER" : undefined;
        const e = await createFullTestEmployee(org, { ...(role ? { roleCode: role } : {}), ...(manager !== null ? { managerId: nodes[manager]!.employeeId } : {}) });
        created.push(e.employeeId);
        nodes.push({ idx: i, manager, role, employeeId: e.employeeId, userId: e.userId });
      }
      charts.push({ nodes, directors });
    }
  });

  afterAll(async () => {
    for (const id of [...created].reverse()) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it.each([0, 1, 2])("chart %i: every ordered pair agrees with the model (no sideways, no other line; up and down as defined)", async (c) => {
    const { nodes, directors } = charts[c]!;
    const mismatches: string[] = [];
    for (const from of nodes) {
      const actor: PeepsActor = { userId: from.userId, employeeId: from.employeeId, isDirector: directors.has(from.idx), isMember: false, capabilities: [], roleCodes: directors.has(from.idx) ? ["SUPER_ADMIN"] : from.role ? [from.role] : ["EMPLOYEE"] };
      for (const to of nodes) {
        const expected = allowedByModel(nodes, directors, from.idx, to.idx);
        const actual = await giverKindFor(actor, to.employeeId, "badges").then(() => true, () => false);
        if (actual !== expected) mismatches.push(`${from.idx}(${from.role ?? (directors.has(from.idx) ? "DIRECTOR" : "EMP")}) → ${to.idx}: service ${actual}, model ${expected}`);
      }
    }
    expect(mismatches).toEqual([]);
    // The chart is not trivial: some pairs are allowed and some refused.
    const verdicts = nodes.flatMap((a) => nodes.map((b) => allowedByModel(nodes, directors, a.idx, b.idx)));
    expect(verdicts.some(Boolean) && verdicts.some((v) => !v)).toBe(true);
  }, 120_000);
});
