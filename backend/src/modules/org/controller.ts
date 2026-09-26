import type { Request, Response } from "express";
import * as orgService from "./service";

function actorMeta(req: Request) {
  return { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null };
}

// ── Cities ───────────────────────────────────────────────────────────────

export async function listCities(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ cities: await orgService.listCities() });
}
export async function createCity(req: Request, res: Response): Promise<void> {
  res.status(201).json(await orgService.createCity(req.body, actorMeta(req)));
}
export async function updateCity(req: Request, res: Response): Promise<void> {
  res.status(200).json(await orgService.updateCity(req.params.id as string, req.body, actorMeta(req)));
}
export async function deleteCity(req: Request, res: Response): Promise<void> {
  await orgService.deleteCity(req.params.id as string, actorMeta(req));
  res.status(204).send();
}

// ── Locations ────────────────────────────────────────────────────────────

export async function listLocations(req: Request, res: Response): Promise<void> {
  const includeInactive = req.query.includeInactive === "true";
  res.status(200).json({ locations: await orgService.listLocations(includeInactive) });
}
export async function createLocation(req: Request, res: Response): Promise<void> {
  res.status(201).json(await orgService.createLocation(req.body, actorMeta(req)));
}
export async function updateLocation(req: Request, res: Response): Promise<void> {
  res.status(200).json(await orgService.updateLocation(req.params.id as string, req.body, actorMeta(req)));
}
export async function deleteLocation(req: Request, res: Response): Promise<void> {
  await orgService.deleteLocation(req.params.id as string, actorMeta(req));
  res.status(204).send();
}
export async function mergeLocations(req: Request, res: Response): Promise<void> {
  const { intoLocationId } = req.body as { intoLocationId: string };
  await orgService.mergeLocations(req.params.id as string, intoLocationId, actorMeta(req));
  res.status(204).send();
}

// ── Departments / Designations / Grades / Cost Centres ─────────────────

function simpleMasterHandlers(resource: "department" | "designation" | "grade" | "costCentre") {
  return {
    list: async (_req: Request, res: Response): Promise<void> => {
      res.status(200).json({ items: await orgService.listSimpleMaster(resource) });
    },
    create: async (req: Request, res: Response): Promise<void> => {
      res.status(201).json(await orgService.createSimpleMaster(resource, req.body, actorMeta(req)));
    },
    update: async (req: Request, res: Response): Promise<void> => {
      res.status(200).json(await orgService.updateSimpleMaster(resource, req.params.id as string, req.body, actorMeta(req)));
    },
    remove: async (req: Request, res: Response): Promise<void> => {
      await orgService.deleteSimpleMaster(resource, req.params.id as string, actorMeta(req));
      res.status(204).send();
    },
  };
}

export const departments = simpleMasterHandlers("department");
export const designations = simpleMasterHandlers("designation");
export const grades = simpleMasterHandlers("grade");
export const costCentres = simpleMasterHandlers("costCentre");
