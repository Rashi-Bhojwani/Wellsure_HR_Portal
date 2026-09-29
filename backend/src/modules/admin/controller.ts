import type { Request, Response } from "express";
import * as dashboardService from "./dashboard";
import * as favouritesService from "./favourites";
import * as layoutService from "./layout";
import * as tasksService from "./tasks";

// ── Dashboard widgets (leave.view; org-wide, no SELF/TEAM narrowing — an
// aggregate management view) ──────────────────────────────────────────

export async function getDashboardWidgets(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await dashboardService.getDashboardWidgets());
}

// ── My Favourites (self-serve) ───────────────────────────────────────

export async function listFavourites(req: Request, res: Response): Promise<void> {
  res.status(200).json({ favourites: await favouritesService.listFavourites(req.user!.userId) });
}

export async function createFavourite(req: Request, res: Response): Promise<void> {
  res.status(201).json(await favouritesService.createFavourite(req.user!.userId, req.body));
}

export async function deleteFavourite(req: Request, res: Response): Promise<void> {
  await favouritesService.deleteFavourite(req.user!.userId, req.params.id as string);
  res.status(204).send();
}

export async function reorderFavourites(req: Request, res: Response): Promise<void> {
  const { orderedIds } = req.body as { orderedIds: string[] };
  await favouritesService.reorderFavourites(req.user!.userId, orderedIds);
  res.status(204).send();
}

// ── Dashboard layout (self-serve) ────────────────────────────────────

export async function getLayout(req: Request, res: Response): Promise<void> {
  res.status(200).json({ layout: await layoutService.getLayout(req.user!.userId) });
}

export async function saveLayout(req: Request, res: Response): Promise<void> {
  const { layout } = req.body as { layout: layoutService.WidgetLayoutEntry[] };
  res.status(200).json({ layout: await layoutService.saveLayout(req.user!.userId, layout) });
}

// ── My Tasks (self-serve — permission checks happen inside the service,
// same split as leave's own apply/list endpoints, since every signed-in
// user legitimately calls this for their own review/monitor counts) ────

export async function getTaskCounts(req: Request, res: Response): Promise<void> {
  const viewer = { employeeId: req.user!.employeeId, roleCodes: req.user!.roleCodes, permissions: req.user!.permissions };
  res.status(200).json(await tasksService.getTaskCounts(viewer));
}
