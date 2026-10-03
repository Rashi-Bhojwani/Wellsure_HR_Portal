import type { Request, Response } from "express";
import type { ReportKey } from "@shared/constants/reports";
import type { ReportQuery, ReportViewer } from "./context";
import * as service from "./service";

const viewer = (req: Request): ReportViewer => ({ userId: req.user!.userId, employeeId: req.user!.employeeId, dataScope: req.user!.dataScope, permissions: req.user!.permissions });
const meta = (req: Request): service.Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });

export async function catalog(req: Request, res: Response): Promise<void> {
  res.status(200).json({ reports: service.catalogFor(viewer(req)) });
}
export async function run(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.runReport(req.params.key as ReportKey, req.query as ReportQuery, viewer(req)));
}
export async function exportXlsx(req: Request, res: Response): Promise<void> {
  const { buffer, fileName } = await service.exportReport(req.params.key as ReportKey, req.query as ReportQuery, viewer(req), meta(req));
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
  res.status(200).send(buffer);
}
