import type { Request, Response } from "express";
import * as auditLogService from "./service";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";

/** The Developer role never sees a value (a director who also holds it does). Same test as middleware/refuseDeveloper. */
export const valuesHiddenFor = (req: Request) => req.user!.roleCodes.includes(DEVELOPER_ROLE_CODE) && !req.user!.roleCodes.includes("SUPER_ADMIN");

export async function exportAuditLogs(req: Request, res: Response): Promise<void> {
  const { buffer } = await auditLogService.exportAuditLogs(req.query as never, { canSeePayroll: req.user!.permissions.has("payroll.salary.view") }, { actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.headers["user-agent"] ?? null });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="audit-log-${new Date().toISOString().slice(0, 10)}.xlsx"`);
  res.setHeader("Cache-Control", "no-store");
  res.status(200).send(buffer);
}

export async function listAuditLogs(req: Request, res: Response): Promise<void> {
  // PEEPS-BEGIN exits
  res.status(200).json(await auditLogService.listAuditLogs(req.query as never, { userId: req.user!.userId, canSeePayroll: req.user!.permissions.has("payroll.salary.view"), valuesHidden: valuesHiddenFor(req) }));
  // PEEPS-END exits
}
