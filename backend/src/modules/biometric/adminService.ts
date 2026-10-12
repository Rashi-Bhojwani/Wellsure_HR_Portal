import { Prisma, type Device } from "@prisma/client";
import { env } from "../../config/env";
import { ADMS_PUSH_DISABLED_MESSAGE, admsGate } from "../../lib/admsGate";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { getDeviceHealthThresholds } from "../../lib/deviceHealthSettings";
import { employeesForDeviceUsersOn, namesOn, translateMappingConflict, writeDeviceMapping } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { requestRecompute } from "../attendance/recompute";
import { newAgentKey } from "./agentAuth";
import { deviceHealth, warningsFor } from "./deviceHealth";
import { flaggedWhere, type FlaggedFilter } from "./flaggedBulk";
import { ingest, previewCounts } from "./ingestion";
import { openIncidentKindsBySubject, statusOf } from "./health/queries";

// Admin side of biometric ingestion (P2-B): devices, sync agents (keys shown
// once), recent batches, the unmapped queue with "map to employee", flagged
// (implausible-time) punches, and the emergency ATTLOG upload. All on
// attendance.devices.manage; every change audited.

export interface Meta {
  actorUserId: string;
  /** The actor's own employee record: nobody decides the evidence of their own attendance. */
  actorEmployeeId?: string | null;
  ipAddress: string | null;
  userAgent: string | null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

async function uniqueSafe<T>(fn: () => Promise<T>, message: string): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new HttpError(409, message, "CONFLICT");
    throw err;
  }
}

// ── Devices ──────────────────────────────────────────────────────────────

/** Nothing has ever come from it: not read by its agent, not polling, nothing uploaded. */
const neverHeardFrom = (d: Device, health: ReturnType<typeof deviceHealth>) => (d.route === "PUSH" ? !d.lastHeartbeatAt && !d.lastReceivedAt : !health.lastReadAt);

export async function listDevices(now: Date = new Date()) {
  const [rows, thresholds, incidents] = await Promise.all([
    prisma.device.findMany({
      orderBy: [{ isActive: "desc" }, { name: "asc" }],
      include: { location: { select: { id: true, name: true, hasBiometricDevice: true } }, agent: { select: { id: true, name: true, lastHeartbeatAt: true } } },
    }),
    getDeviceHealthThresholds(),
    openIncidentKindsBySubject(),
  ]);
  const devices = rows.map((d) => {
    const health = deviceHealth(d, d.agent, thresholds, now);
    return {
      id: d.id,
      serialNumber: d.serialNumber,
      name: d.name,
      location: d.location,
      timezone: d.timezone,
      model: d.model,
      firmware: d.firmware,
      route: d.route,
      agent: d.agent ? { id: d.agent.id, name: d.agent.name } : null,
      lanIp: d.lanIp,
      isSimulated: d.isSimulated,
      isActive: d.isActive,
      lastHeartbeatAt: d.lastHeartbeatAt,
      lastPunchAt: d.lastPunchAt,
      lastReceivedAt: d.lastReceivedAt,
      syncFrom: iso(d.syncFrom),
      retentionDays: d.retentionDays,
      retentionRecords: d.retentionRecords,
      health,
      warnings: d.isActive ? warningsFor(d, health) : [],
      // At a glance (P2-H): from the open incidents; an agent that has stopped explains its devices.
      openIncidents: incidents.byDevice.get(d.id) ?? [],
      status: d.isActive ? statusOf(incidents.byDevice.get(d.id) ?? [], !!d.agent && (incidents.byAgent.get(d.agent.id) ?? []).includes("AGENT_SILENT"), neverHeardFrom(d, health)) : null,
    };
  });
  return { devices, thresholds };
}

interface DeviceInput {
  serialNumber?: string;
  name?: string;
  locationId?: string;
  timezone?: string;
  model?: string | null;
  firmware?: string | null;
  route?: "AGENT" | "PUSH";
  agentId?: string | null;
  lanIp?: string | null;
  isSimulated?: boolean;
  isActive?: boolean;
  syncFrom?: string;
  retentionDays?: number;
  retentionRecords?: number;
}

// The agent's report is operational state, not configuration: it changes
// every 30 s and would bury what an admin actually changed.
const auditView = ({ agentReport: _r, agentReportAt: _a, ...d }: Device) => ({ ...d, syncFrom: iso(d.syncFrom) });

function toDeviceData(input: DeviceInput) {
  const { syncFrom, ...rest } = input;
  return { ...rest, ...(syncFrom !== undefined ? { syncFrom: new Date(`${syncFrom}T00:00:00Z`) } : {}) };
}

async function assertDeviceInput(input: DeviceInput, current?: Device): Promise<void> {
  // Simulated devices exist to exercise the real routes before the machine
  // arrives (P2-G). They are refused outright on production.
  if (input.isSimulated && env.APP_ENV === "production") throw new HttpError(400, "Simulated devices can't be registered in production.", "SIMULATED_IN_PRODUCTION");
  const route = input.route ?? current?.route ?? "AGENT";
  if (route === "PUSH" && current?.route !== "PUSH" && !admsGate.enabled()) throw new HttpError(400, ADMS_PUSH_DISABLED_MESSAGE, "ADMS_PUSH_DISABLED");
  const agentId = input.agentId === undefined ? current?.agentId : input.agentId;
  if (route === "AGENT" && agentId) {
    const agent = await prisma.biometricAgent.findUnique({ where: { id: agentId } });
    if (!agent?.isActive) throw new HttpError(400, "Choose an active sync agent.", "VALIDATION_ERROR");
  }
  if (input.locationId) {
    const loc = await prisma.location.findUnique({ where: { id: input.locationId } });
    if (!loc?.isActive) throw new HttpError(400, "Choose an active branch.", "VALIDATION_ERROR");
  }
  // A later date would only hold punches back; the agent sends from this day on (D-F3).
  if (input.syncFrom && input.syncFrom > iso(businessToday())) {
    throw new HttpError(400, "\"Sync punches from\" can't be in the future.", "VALIDATION_ERROR");
  }
}

export async function createDevice(input: Required<Pick<DeviceInput, "serialNumber" | "name" | "locationId">> & DeviceInput, meta: Meta) {
  await assertDeviceInput(input);
  const { serialNumber, name, locationId, ...rest } = toDeviceData({ ...input, syncFrom: input.syncFrom ?? iso(businessToday()) });
  const device = await uniqueSafe(
    () => prisma.device.create({ data: { ...rest, serialNumber: serialNumber!, name: name!, locationId: locationId!, agentId: input.route === "PUSH" ? null : (input.agentId ?? null) } }),
    `A device with serial number "${input.serialNumber}" is already registered.`,
  );
  await writeAuditLog({ ...meta, action: "biometric.device.created", entityType: "Device", entityId: device.id, after: auditView(device) });
  return auditView(device);
}

export async function updateDevice(id: string, input: DeviceInput, meta: Meta) {
  const before = await prisma.device.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Device not found.", "NOT_FOUND");
  await assertDeviceInput(input, before);
  const data = { ...toDeviceData(input), ...(input.route === "PUSH" ? { agentId: null } : {}) };
  const after = await prisma.device.update({ where: { id }, data });
  await writeAuditLog({ ...meta, action: "biometric.device.updated", entityType: "Device", entityId: id, before: auditView(before), after: auditView(after) });
  return auditView(after);
}

// ── Sync agents ──────────────────────────────────────────────────────────

const agentView = (a: Prisma.BiometricAgentGetPayload<{ include: { devices: { select: { id: true; name: true; serialNumber: true } } } }>, kinds: Parameters<typeof statusOf>[0] = []) => ({
  openIncidents: kinds,
  status: a.isActive ? statusOf(kinds, false) : null,
  id: a.id,
  name: a.name,
  keyPrefix: a.keyPrefix,
  host: a.host,
  version: a.version,
  lastHeartbeatAt: a.lastHeartbeatAt,
  lastHeartbeat: a.lastHeartbeat,
  isActive: a.isActive,
  devices: a.devices,
  createdAt: a.createdAt,
});

export async function listAgents() {
  const [rows, incidents] = await Promise.all([prisma.biometricAgent.findMany({ orderBy: { createdAt: "asc" }, include: { devices: { select: { id: true, name: true, serialNumber: true } } } }), openIncidentKindsBySubject()]);
  return rows.map((a) => agentView(a, incidents.byAgent.get(a.id) ?? []));
}

/** Creates an agent and returns its key — the only time the key is ever shown. */
export async function createAgent(input: { name: string }, meta: Meta) {
  const { key, hash, prefix } = newAgentKey();
  const agent = await prisma.biometricAgent.create({ data: { name: input.name, keyHash: hash, keyPrefix: prefix, createdByUserId: meta.actorUserId }, include: { devices: { select: { id: true, name: true, serialNumber: true } } } });
  await writeAuditLog({ ...meta, action: "biometric.agent.created", entityType: "BiometricAgent", entityId: agent.id, after: { name: agent.name, keyPrefix: prefix } });
  return { agent: agentView(agent), key };
}

/** A new key; the old one stops working at once. */
export async function rotateAgentKey(id: string, meta: Meta) {
  const before = await prisma.biometricAgent.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Agent not found.", "NOT_FOUND");
  const { key, hash, prefix } = newAgentKey();
  const agent = await prisma.biometricAgent.update({ where: { id }, data: { keyHash: hash, keyPrefix: prefix }, include: { devices: { select: { id: true, name: true, serialNumber: true } } } });
  await writeAuditLog({ ...meta, action: "biometric.agent.key_rotated", entityType: "BiometricAgent", entityId: id, before: { keyPrefix: before.keyPrefix }, after: { keyPrefix: prefix } });
  return { agent: agentView(agent), key };
}

export async function updateAgent(id: string, input: { name?: string; isActive?: boolean }, meta: Meta) {
  const before = await prisma.biometricAgent.findUnique({ where: { id } });
  if (!before) throw new HttpError(404, "Agent not found.", "NOT_FOUND");
  const agent = await prisma.biometricAgent.update({ where: { id }, data: input, include: { devices: { select: { id: true, name: true, serialNumber: true } } } });
  await writeAuditLog({ ...meta, action: input.isActive === false ? "biometric.agent.deactivated" : "biometric.agent.updated", entityType: "BiometricAgent", entityId: id, before: { name: before.name, isActive: before.isActive }, after: input });
  return agentView(agent);
}

// ── Batches ──────────────────────────────────────────────────────────────

export async function listBatches(filter: { deviceId?: string; limit: number }) {
  const rows = await prisma.ingestionBatch.findMany({
    where: { status: "COMMITTED", ...(filter.deviceId ? { deviceId: filter.deviceId } : {}) },
    orderBy: { receivedAt: "desc" },
    take: filter.limit,
    include: { device: { select: { name: true, serialNumber: true } }, agent: { select: { name: true } } },
  });
  return rows.map(({ pendingText: _p, ...b }) => b);
}

// ── The unmapped queue ───────────────────────────────────────────────────

/** Punches nobody's device mapping covered on the day, grouped by device user ID. */
export async function listUnmapped() {
  const rows = await prisma.$queryRaw<Array<{ device_user_id: string; punches: bigint; first_at: Date; last_at: Date; first_day: Date; devices: string[] }>>`
    SELECT rp.device_user_id, count(*) AS punches, min(rp.punched_at) AS first_at, max(rp.punched_at) AS last_at,
           min(rp.business_date) AS first_day, array_agg(DISTINCT d.name) AS devices
    FROM raw_punches rp JOIN devices d ON d.id = rp.device_id
    WHERE rp.employee_id IS NULL
    GROUP BY rp.device_user_id
    ORDER BY max(rp.punched_at) DESC`;
  return rows.map((r) => ({ deviceUserId: r.device_user_id, punches: Number(r.punches), firstAt: r.first_at, lastAt: r.last_at, firstDay: iso(r.first_day), devices: r.devices }));
}

/**
 * Map a device user ID to an employee (through the effective-dating writer),
 * then re-resolve that ID's stored unmapped punches and recompute the days.
 * The mapping starts at `effectiveFrom`, or the first unmapped punch's date —
 * never before they joined; punches from before then stay unmapped.
 */
export async function mapUnmapped(input: { deviceUserId: string; employeeId: string; effectiveFrom?: string }, meta: Meta) {
  const employee = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { id: true, employeeCode: true, dateOfJoining: true } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (employee.id === meta.actorEmployeeId) throw new HttpError(403, "You can't map unmapped punches to yourself. Someone else does, so nobody rules on their own attendance.", "OWN_ATTENDANCE");
  const first = await prisma.rawPunch.findFirst({ where: { deviceUserId: input.deviceUserId, employeeId: null }, orderBy: { businessDate: "asc" }, select: { businessDate: true } });
  if (!first && !input.effectiveFrom) throw new HttpError(404, `No unmapped punches for device user ID "${input.deviceUserId}".`, "NOT_FOUND");
  const requested = input.effectiveFrom ? new Date(input.effectiveFrom) : first!.businessDate;
  const day = requested < employee.dateOfJoining ? employee.dateOfJoining : requested;

  const write = await prisma
    .$transaction((tx) => writeDeviceMapping(tx, employee.id, input.deviceUserId, day, { createdByUserId: meta.actorUserId }))
    .catch((err: unknown) => translateMappingConflict(err, input.deviceUserId));

  const reResolved = await reResolveUnmapped(input.deviceUserId);
  await writeAuditLog({
    ...meta,
    action: "biometric.device_user.mapped",
    entityType: "Employee",
    entityId: employee.id,
    before: write.before,
    after: { ...write.after, plan: write.plan, punchesResolved: reResolved.resolved, stillUnmapped: reResolved.stillUnmapped },
  });
  return { mapping: { deviceUserId: write.after.deviceUserId, validFrom: iso(write.after.validFrom), validTo: write.after.validTo ? iso(write.after.validTo) : null, plan: write.plan }, ...reResolved };
}

/** Give each still-unmapped punch of `deviceUserId` to whoever its mapping now says, and recompute those days. */
export async function reResolveUnmapped(deviceUserId: string): Promise<{ resolved: number; stillUnmapped: number }> {
  const punches = await prisma.rawPunch.findMany({ where: { deviceUserId, employeeId: null }, select: { id: true, businessDate: true, flag: true, flagResolution: { select: { decision: true } } } });
  const owners = await employeesForDeviceUsersOn(punches.map((p) => ({ deviceUserId, day: p.businessDate })));
  const byEmployee = new Map<string, typeof punches>();
  for (const p of punches) {
    const owner = owners.get(`${deviceUserId}|${iso(p.businessDate)}`);
    if (owner) byEmployee.set(owner, [...(byEmployee.get(owner) ?? []), p]);
  }
  let resolved = 0;
  for (const [employeeId, list] of byEmployee) {
    // The one change raw_punches allow (the immutability trigger checks it).
    const r = await prisma.rawPunch.updateMany({ where: { id: { in: list.map((p) => p.id) }, employeeId: null }, data: { employeeId } });
    resolved += r.count;
    // A flagged punch counts only if HR accepted it; one accepted while it still belonged to nobody is recomputed now that it does.
    await requestRecompute(list.filter((p) => !p.flag || p.flagResolution?.decision === "ACCEPTED").map((p) => ({ employeeId, date: p.businessDate })));
  }
  return { resolved, stillUnmapped: punches.length - resolved };
}

// ── Flagged (implausible-time) punches ───────────────────────────────────

export async function listFlagged(filter: FlaggedFilter = {}) {
  const where = flaggedWhere(filter);
  const [rows, total] = await Promise.all([
    prisma.rawPunch.findMany({ where, orderBy: { punchedAt: "desc" }, take: 500, include: { device: { select: { name: true, timezone: true } } } }),
    prisma.rawPunch.count({ where }),
  ]);
  const names = await namesOn([...new Set(rows.flatMap((r) => (r.employeeId ? [r.employeeId] : [])))], new Date());
  return {
    total,
    flagged: rows.map((r) => ({
      id: r.id,
      deviceId: r.deviceId,
      device: r.device.name,
      deviceUserId: r.deviceUserId,
      localTime: r.localTime,
      punchedAt: r.punchedAt,
      businessDate: iso(r.businessDate),
      receivedAt: r.receivedAt,
      flag: r.flag,
      employee: r.employeeId ? { id: r.employeeId, name: names.get(r.employeeId) ?? null } : null,
    })),
  };
}

/** HR's decision: accepted punches count from now on (their day is recomputed); discarded ones never do. */
export async function resolveFlag(punchId: string, input: { decision: "ACCEPTED" | "DISCARDED"; reason: string }, meta: Meta) {
  const punch = await prisma.rawPunch.findUnique({ where: { id: punchId }, include: { flagResolution: true } });
  if (!punch?.flag) throw new HttpError(404, "Flagged punch not found.", "NOT_FOUND");
  if (punch.flagResolution) throw new HttpError(409, "This punch has already been decided.", "ALREADY_RESOLVED");
  if (punch.employeeId && punch.employeeId === meta.actorEmployeeId) throw new HttpError(403, "This is one of your own punches. Someone else decides it, so nobody rules on their own attendance.", "OWN_ATTENDANCE");
  const resolution = await prisma.punchFlagResolution.create({ data: { punchId, decision: input.decision, reason: input.reason, decidedByUserId: meta.actorUserId } });
  if (input.decision === "ACCEPTED" && punch.employeeId) await requestRecompute([{ employeeId: punch.employeeId, date: punch.businessDate }]);
  await writeAuditLog({ ...meta, action: `biometric.punch.flag_${input.decision.toLowerCase()}`, entityType: "RawPunch", entityId: punchId, after: { ...resolution, flag: punch.flag, localTime: punch.localTime } });
  return resolution;
}

// ── Emergency file upload (Import Center → Punches (ATTLOG)) ─────────────

async function activeDevice(id: string) {
  const device = await prisma.device.findUnique({ where: { id } });
  if (!device?.isActive) throw new HttpError(400, "Choose an active device — ATTLOG lines don't say which device they came from.", "VALIDATION_ERROR");
  return device;
}

/** Parse and count the file against what's stored; nothing is written to raw_punches until commit. */
export async function previewImport(deviceId: string, file: { buffer: Buffer; originalname: string }, meta: Meta) {
  const device = await activeDevice(deviceId);
  const text = file.buffer.toString("utf8");
  const counts = await previewCounts(device, text);
  const batch = await prisma.ingestionBatch.create({
    data: {
      route: "IMPORT",
      status: "PREVIEW",
      deviceId,
      uploadedByUserId: meta.actorUserId,
      fileName: file.originalname,
      pendingText: text,
      totalLines: counts.totalLines,
      newCount: counts.newCount,
      duplicateCount: counts.duplicateCount,
      unmappedCount: counts.unmappedCount,
      rejectedCount: counts.rejectedCount,
      flaggedCount: counts.flaggedCount,
      rejectedLines: counts.rejected.slice(0, 1000) as never,
    },
  });
  return { batchId: batch.id, device: { id: device.id, name: device.name }, fileName: file.originalname, ...counts };
}

export async function commitImport(batchId: string, input: { reason: string }, meta: Meta) {
  const batch = await prisma.ingestionBatch.findUnique({ where: { id: batchId } });
  if (!batch || batch.route !== "IMPORT") throw new HttpError(404, "Upload not found.", "NOT_FOUND");
  if (batch.status !== "PREVIEW" || batch.pendingText === null) throw new HttpError(409, "This upload has already been committed.", "ALREADY_COMMITTED");
  const device = await activeDevice(batch.deviceId);
  const result = await ingest({
    route: "IMPORT",
    device,
    text: batch.pendingText,
    uploadedByUserId: meta.actorUserId,
    fileName: batch.fileName,
    reason: input.reason,
    previewBatchId: batch.id,
  });
  await writeAuditLog({
    ...meta,
    action: "biometric.punches.imported",
    entityType: "IngestionBatch",
    entityId: batch.id,
    after: { device: device.name, fileName: batch.fileName, reason: input.reason, newCount: result.newCount, duplicateCount: result.duplicateCount, unmappedCount: result.unmappedCount, rejectedCount: result.rejectedCount, flaggedCount: result.flaggedCount },
  });
  return result;
}
