import type { Request, Response } from "express";
import { resolveAccess } from "../../../lib/permissions";
import { raisePayslipQuery } from "./payslipQuery";

export const queryRoute = async (req: Request, res: Response): Promise<void> => {
  const permissions = (await resolveAccess(req.user!.userId)).permissions;
  res.status(201).json(await raisePayslipQuery({ userId: req.user!.userId, employeeId: req.user!.employeeId, permissions }, (req.params as { id: string }).id, req.body, req.ip ?? null));
};
