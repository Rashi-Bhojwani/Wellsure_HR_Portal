import { describe, expect, it } from "vitest";
import { MANAGER_GRANTABLE_KEYS } from "@shared/constants/permissions";
import { listApiRoutes } from "./routeList";
import { MANAGER_REACHABLE_SCOPED, ROUTE_CLASSIFICATION } from "./routeInventory";

// The endpoint audit as a guard (Phase 5 commit E2). Like the cleanup guard,
// it fails the moment someone adds a route without deciding what it is —
// and it checks each decision against the route's real permission gate.
const grantable = new Set<string>(MANAGER_GRANTABLE_KEYS);
const routes = listApiRoutes();

describe("route inventory — every endpoint classified for manager reach", () => {
  it("every route the API serves is classified, and every classification is a real route", () => {
    const ids = routes.map((r) => r.id);
    const unclassified = ids.filter((id) => !ROUTE_CLASSIFICATION[id]);
    const stale = Object.keys(ROUTE_CLASSIFICATION).filter((id) => !ids.includes(id));
    expect(unclassified, `Classify these in routeInventory.ts:\n${unclassified.join("\n")}`).toEqual([]);
    expect(stale, `These no longer exist — remove them from routeInventory.ts:\n${stale.join("\n")}`).toEqual([]);
  });

  it("an 'admin' route is gated only on keys a manager can never hold (or is Super-Admin-only in the service, with a reason)", () => {
    const wrong = routes.filter((r) => {
      const c = ROUTE_CLASSIFICATION[r.id];
      if (c?.kind !== "admin") return false;
      if (r.gateKeys.length === 0) return !c.why; // must say where the check is
      return r.gateKeys.some((k) => grantable.has(k));
    });
    expect(wrong.map((r) => `${r.id} [${r.gateKeys.join(", ")}]`)).toEqual([]);
  });

  it("a route gated on a manager-grantable key is team-scoped with an IDOR case — or company data that isn't anyone's record, said why", () => {
    const reachable = routes.filter((r) => r.gateKeys.some((k) => grantable.has(k)));
    const wrong = reachable.filter((r) => {
      const c = ROUTE_CLASSIFICATION[r.id]!;
      if (c.kind === "scoped") return !(MANAGER_REACHABLE_SCOPED as readonly string[]).includes(r.id);
      return c.kind !== "everyone" || !c.why;
    });
    expect(wrong.map((r) => `${r.id} → ${ROUTE_CLASSIFICATION[r.id]?.kind}`)).toEqual([]);
  });

  it("every route listed as manager-reachable is classified 'scoped'", () => {
    expect(MANAGER_REACHABLE_SCOPED.filter((id) => ROUTE_CLASSIFICATION[id]?.kind !== "scoped")).toEqual([]);
  });

  it("'scoped' and 'everyone' entries say why", () => {
    const missing = Object.entries(ROUTE_CLASSIFICATION).filter(([, c]) => (c.kind === "scoped" || c.kind === "everyone") && !c.why);
    expect(missing.map(([id]) => id)).toEqual([]);
  });
});
