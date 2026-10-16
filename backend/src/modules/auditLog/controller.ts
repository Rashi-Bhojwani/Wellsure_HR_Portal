import type { Request, Response } from "express";
import * as auditLogService from "./service";

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  res.status(200).json(await auditLogService.listAuditLogs(req.query as never, { canSeePayroll: req.user!.permissions.has("payroll.salary.view") }));
}
