import { Router } from "express";
import multer from "multer";
import { authenticate } from "../../middleware/authenticate";
import { rateLimit } from "../../middleware/rateLimit";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { authenticateAgent } from "./agentAuth";
import * as controller from "./controller";
import {
  agentHeartbeatSchema,
  agentPunchesSchema,
  batchesQuerySchema,
  createAgentSchema,
  createDeviceSchema,
  idParamsSchema,
  incidentsQuerySchema,
  importCommitSchema,
  importPreviewBodySchema,
  mapUnmappedSchema,
  resolveFlagSchema,
  updateAgentSchema,
  updateDeviceSchema,
  volumeQuerySchema,
} from "./validators";

// The sync agent's API (docs/plans/PHASE_2.md §3). A machine credential —
// the agent key — not a user sign-in; rate-limited per office IP. Mounted
// before the bare /api router (app.ts) so no user authentication runs first.
export const biometricAgentRouter = Router();
biometricAgentRouter.use(rateLimit("biometric.rateLimit.agent", { maxAttempts: 600, windowSeconds: 60 }));
biometricAgentRouter.use(authenticateAgent);
biometricAgentRouter.post("/punches", validate({ body: agentPunchesSchema }), controller.agentPunches);
biometricAgentRouter.post("/heartbeat", validate({ body: agentHeartbeatSchema }), controller.agentHeartbeat);

// Admin (attendance.devices.manage — never manager-grantable): devices,
// agents, recent batches, the unmapped and flagged queues, and the
// emergency ATTLOG upload.
export const biometricRouter = Router();
biometricRouter.use(authenticate);
const canManage = requirePermission("attendance.devices.manage");

// ATTLOG is a plain text export; memory only, never written to disk.
const attlogUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

biometricRouter.get("/devices", canManage, controller.listDevices);
// Clock drift, retention and a nearly full log, worded for HR (P2-F): the
// Devices screen banner and Admin Home.
biometricRouter.get("/device-warnings", canManage, controller.deviceWarnings);
biometricRouter.post("/devices", canManage, validate({ body: createDeviceSchema }), controller.createDevice);
biometricRouter.patch("/devices/:id", canManage, validate({ params: idParamsSchema, body: updateDeviceSchema }), controller.updateDevice);

biometricRouter.get("/agents", canManage, controller.listAgents);
biometricRouter.post("/agents", canManage, validate({ body: createAgentSchema }), controller.createAgent);
biometricRouter.patch("/agents/:id", canManage, validate({ params: idParamsSchema, body: updateAgentSchema }), controller.updateAgent);
biometricRouter.post("/agents/:id/rotate-key", canManage, validate({ params: idParamsSchema }), controller.rotateAgentKey);

// Health (P2-H): incidents (open first, then history), ingestion volume per device and route,
// and the people at device branches with no device user ID mapped.
biometricRouter.get("/incidents", canManage, validate({ query: incidentsQuerySchema }), controller.incidents);
biometricRouter.get("/volume", canManage, validate({ query: volumeQuerySchema }), controller.volume);
biometricRouter.get("/people-without-mapping", canManage, controller.peopleWithoutMappingList);

biometricRouter.get("/batches", canManage, validate({ query: batchesQuerySchema }), controller.listBatches);

biometricRouter.get("/unmapped", canManage, controller.listUnmapped);
biometricRouter.post("/unmapped/map", canManage, validate({ body: mapUnmappedSchema }), controller.mapUnmapped);

biometricRouter.get("/flagged", canManage, controller.listFlagged);
biometricRouter.post("/flagged/:id/resolve", canManage, validate({ params: idParamsSchema, body: resolveFlagSchema }), controller.resolveFlag);

biometricRouter.post("/import/preview", canManage, attlogUpload.single("file"), validate({ body: importPreviewBodySchema }), controller.previewImport);
biometricRouter.post("/import/:id/commit", canManage, validate({ params: idParamsSchema, body: importCommitSchema }), controller.commitImport);
