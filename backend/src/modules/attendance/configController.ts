import type { Request, Response } from "express";
import * as service from "./configService";

const meta = (req: Request): service.Meta => ({ actorUserId: req.user!.userId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const id = (req: Request) => req.params.id as string;

export async function listShifts(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ shifts: await service.listShifts() });
}
export async function createShift(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createShift(req.body, meta(req)));
}
export async function updateShift(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateShift(id(req), req.body, meta(req)));
}

export async function listWeekOffPatterns(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ patterns: await service.listWeekOffPatterns() });
}
export async function createWeekOffPattern(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createWeekOffPattern(req.body, meta(req)));
}
export async function updateWeekOffPattern(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updateWeekOffPattern(id(req), req.body, meta(req)));
}

export async function listPolicies(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ policies: await service.listPolicies() });
}
export async function createPolicy(req: Request, res: Response): Promise<void> {
  res.status(201).json(await service.createPolicy(req.body, meta(req)));
}
export async function updatePolicy(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.updatePolicy(id(req), req.body, meta(req)));
}

export async function getDefaults(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getDefaults());
}
export async function setDefaults(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setDefaults(req.body, meta(req)));
}

export async function getCycle(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.getCycle());
}
export async function scheduleCycleChange(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.scheduleCycleChange(req.body, meta(req)));
}
export async function cancelCycleChange(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.cancelCycleChange(id(req), meta(req)));
}

export async function listAssignments(req: Request, res: Response): Promise<void> {
  res.status(200).json({ employees: await service.listAssignments(req.query as never) });
}
export async function getAssignmentHistory(req: Request, res: Response): Promise<void> {
  res.status(200).json({ history: await service.getAssignmentHistory(req.params.employeeId as string) });
}
export async function changeAssignment(req: Request, res: Response): Promise<void> {
  res.status(200).json({ history: await service.changeAssignment(req.params.employeeId as string, req.body, meta(req)) });
}
export async function bulkChangeAssignment(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.bulkChangeAssignment(req.body, meta(req)));
}
export async function cancelAssignmentChange(req: Request, res: Response): Promise<void> {
  res.status(200).json({ history: await service.cancelAssignmentChange(req.params.employeeId as string, req.params.rowId as string, meta(req)) });
}

export async function listManualBranchHolders(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ holders: await service.listManualBranchHolders() });
}
export async function setManualBranches(req: Request, res: Response): Promise<void> {
  res.status(200).json(await service.setManualBranches(req.params.userId as string, req.body.locationIds, meta(req)));
}
