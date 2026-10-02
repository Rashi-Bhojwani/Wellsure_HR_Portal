import type { Router } from "express";
import { API_MOUNTS } from "../../../app";
import { GATE_KEYS } from "../../../middleware/rbac";

interface Layer {
  route?: { path: string | string[]; methods: Record<string, boolean>; stack: Array<{ handle: object }> };
  handle?: { stack?: Layer[] };
  name?: string;
}

// Every "METHOD /full/path" the API serves, from API_MOUNTS (app.ts) and
// each router's own route table. A router nested inside a router has no
// readable mount path in Express 5, so it's refused here rather than
// silently skipped — mount it in API_MOUNTS instead.
export interface ApiRoute {
  id: string; // "GET /api/employees/:id"
  gateKeys: string[]; // keys checked by requirePermission/requireAnyPermission on the route itself
}

export function listApiRoutes(): ApiRoute[] {
  const out: ApiRoute[] = [];
  for (const mount of API_MOUNTS) {
    for (const layer of (mount.router as unknown as { stack: Layer[] }).stack) {
      if (layer.route) {
        const paths = Array.isArray(layer.route.path) ? layer.route.path : [layer.route.path];
        const gateKeys = layer.route.stack.flatMap((l) => ((l.handle as Record<symbol, string[] | undefined>)[GATE_KEYS] ?? []));
        for (const p of paths) for (const method of Object.keys(layer.route.methods)) out.push({ id: `${method.toUpperCase()} ${mount.path}${p === "/" ? "" : p}`, gateKeys });
      } else if (layer.handle?.stack) {
        throw new Error(`A router nested inside the router mounted at ${mount.path} — mount it in API_MOUNTS so its routes can be inventoried.`);
      }
    }
  }
  return out;
}

export type { Router };
