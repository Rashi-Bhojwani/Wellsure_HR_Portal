import type { Request, Response } from "express";
import { HttpError } from "../../middleware/errorHandler";
import * as admin from "./adminService";
import * as agentService from "./agentService";
import { bulkAcceptFlagged, previewBulkAccept as previewBulkAcceptFlagged, type FlaggedFilter, type FlaggedSelection } from "./flaggedBulk";
import { listDeviceWarnings } from "./deviceHealth";
import { peopleWithoutMapping } from "./health/people";
import { ingestionVolume, listIncidents } from "./health/queries";
import { businessToday } from "../../lib/businessDate";

const meta = (req: Request): admin.Meta => ({ actorUserId: req.user!.userId, actorEmployeeId: req.user!.employeeId, ipAddress: req.ip ?? null, userAgent: req.get("user-agent") ?? null });
const id = (req: Request) => req.params.id as string;

// ── The sync agent ──
export async function agentPunches(req: Request, res: Response): Promise<void> {
  res.status(200).json(await agentService.postPunches(req.agent!, req.body));
}
export async function agentHeartbeat(req: Request, res: Response): Promise<void> {
  res.status(200).json(await agentService.heartbeat(req.agent!, req.body));
}

// ── Admin ──
export async function listDevices(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.listDevices());
}
export async function deviceWarnings(_req: Request, res: Response): Promise<void> {
  res.status(200).json(await listDeviceWarnings());
}
export async function createDevice(req: Request, res: Response): Promise<void> {
  res.status(201).json(await admin.createDevice(req.body, meta(req)));
}
export async function updateDevice(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.updateDevice(id(req), req.body, meta(req)));
}
export async function listAgents(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ agents: await admin.listAgents() });
}
export async function createAgent(req: Request, res: Response): Promise<void> {
  res.status(201).json(await admin.createAgent(req.body, meta(req)));
}
export async function rotateAgentKey(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.rotateAgentKey(id(req), meta(req)));
}
export async function updateAgent(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.updateAgent(id(req), req.body, meta(req)));
}
export async function listBatches(req: Request, res: Response): Promise<void> {
  res.status(200).json({ batches: await admin.listBatches(req.query as never) });
}
export async function listUnmapped(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ unmapped: await admin.listUnmapped() });
}
export async function mapUnmapped(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.mapUnmapped(req.body, meta(req)));
}
export async function listFlagged(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.listFlagged(req.query as FlaggedFilter));
}
export async function resolveFlag(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.resolveFlag(id(req), req.body, meta(req)));
}
export async function previewImport(req: Request, res: Response): Promise<void> {
  if (!req.file) throw new HttpError(400, "Attach the ATTLOG file.", "VALIDATION_ERROR");
  res.status(200).json(await admin.previewImport(req.body.deviceId, req.file, meta(req)));
}
export async function commitImport(req: Request, res: Response): Promise<void> {
  res.status(200).json(await admin.commitImport(id(req), req.body, meta(req)));
}

export async function incidents(req: Request, res: Response): Promise<void> {
  res.status(200).json({ incidents: await listIncidents(req.query as never) });
}
export async function volume(req: Request, res: Response): Promise<void> {
  res.status(200).json(await ingestionVolume(req.query as never));
}
export async function peopleWithoutMappingList(_req: Request, res: Response): Promise<void> {
  res.status(200).json({ people: await peopleWithoutMapping(businessToday().toISOString().slice(0, 10)) });
}

export async function previewBulkAccept(req: Request, res: Response): Promise<void> {
  res.status(200).json(await previewBulkAcceptFlagged(req.body as FlaggedSelection, req.user!.employeeId));
}
export async function bulkAccept(req: Request, res: Response): Promise<void> {
  const { fingerprint, reason, ids, filter } = req.body as FlaggedSelection & { fingerprint: string; reason: string };
  res.status(200).json(await bulkAcceptFlagged({ ids, filter }, { fingerprint, reason }, meta(req)));
}
