import type { Request, Response } from "express";
import { writeAuditLog } from "../../../lib/audit";
import type { Viewer } from "../manual/scope";
import * as swipes from "./swipes";

const viewer = (req: Request): Viewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, permissions: req.user!.permissions, dataScope: req.user!.dataScope });

export async function list(req: Request, res: Response): Promise<void> {
  res.status(200).json(await swipes.listSwipes(viewer(req), req.query as unknown as swipes.SwipeQuery));
}
export async function options(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await swipes.swipeOptions());
}
export async function exportXlsx(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as swipes.SwipeQuery;
  const { buffer, fileName, capped } = await swipes.exportSwipes(viewer(req), query);
  // The raw log is more sensitive than the muster: who took a copy, of what, is on record.
  await writeAuditLog({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null, action: "attendance.swipes.exported", entityType: "RawPunch", entityId: "export", after: { fileName, capped, filters: query, scope: req.user!.dataScope } });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).send(buffer);
}
