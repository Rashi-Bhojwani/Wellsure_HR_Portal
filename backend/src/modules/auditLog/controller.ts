import type { Request, Response } from "express";
import * as auditLogService from "./service";

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  // PEEPS-BEGIN exits
  res.status(200).json(await auditLogService.listAuditLogs(req.query as never, { userId: req.user!.userId, canSeePayroll: req.user!.permissions.has("payroll.salary.view") }));
  // PEEPS-END exits
}
