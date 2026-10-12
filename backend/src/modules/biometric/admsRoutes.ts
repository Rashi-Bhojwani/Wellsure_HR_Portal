import express, { Router, type Request, type Response } from "express";
import { zoneOffsetMinutes } from "@shared/attendance/attlog";
import { admsGate } from "../../lib/admsGate";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { rateLimit } from "../../middleware/rateLimit";
import { ingest } from "./ingestion";

// ADMS ("cloud server" / push) endpoints for ZKTeco/eSSL push firmware
// (spec §4.1 route 2, docs/plans/PHASE_2.md §3). The device authenticates
// by its registered serial number (?SN=…); an unknown or inactive serial,
// or a device registered for the agent route, is refused and logged.
// Responses are the plain text the device expects. The firmware-specific
// details (option names, OPERLOG shape) are unproven until a real push
// device is connected (§11).
export const admsRouter = Router();
// Off in production until the go-live checklist item is ticked: the path does not exist, as far as the internet can tell.
admsRouter.use((_req, res, next) => (admsGate.enabled() ? next() : void res.status(404).end()));
admsRouter.use(rateLimit("biometric.rateLimit.adms", { maxAttempts: 600, windowSeconds: 60 }));
admsRouter.use(express.text({ type: () => true, limit: "2mb" }));

async function pushDevice(req: Request, res: Response) {
  const sn = typeof req.query.SN === "string" ? req.query.SN.trim() : "";
  const device = sn ? await prisma.device.findUnique({ where: { serialNumber: sn } }) : null;
  if (!device?.isActive || device.route !== "PUSH") {
    logger.warn({ sn, ip: req.ip, path: req.path }, "ADMS request from an unknown, inactive or non-push device serial — refused");
    res.status(401).type("text/plain").send("Unknown device");
    return null;
  }
  return device;
}

// Handshake: the device asks for its options. Real-time upload of ATTLOG,
// no photos, no operation-log stamps needed.
admsRouter.get("/cdata", async (req, res, next) => {
  try {
    const device = await pushDevice(req, res);
    if (!device) return;
    await prisma.device.update({ where: { id: device.id }, data: { lastHeartbeatAt: new Date() } });
    const tzHours = zoneOffsetMinutes(device.timezone, new Date()) / 60;
    res
      .type("text/plain")
      .send(
        [
          `GET OPTION FROM: ${device.serialNumber}`,
          "ATTLOGStamp=None",
          "OPERLOGStamp=9999",
          "ATTPHOTOStamp=None",
          "ErrorDelay=30",
          "Delay=10",
          "TransTimes=00:00;14:05",
          "TransInterval=1",
          "TransFlag=TransData AttLog",
          `TimeZone=${tzHours}`,
          "Realtime=1",
          "Encrypt=None",
        ].join("\n"),
      );
  } catch (err) {
    next(err);
  }
});

// Uploads. ATTLOG goes through the one ingestion service; everything else
// (OPERLOG, user info, photos) is acknowledged and ignored.
admsRouter.post("/cdata", async (req, res, next) => {
  try {
    const device = await pushDevice(req, res);
    if (!device) return;
    const table = typeof req.query.table === "string" ? req.query.table.toUpperCase() : "";
    const body = typeof req.body === "string" ? req.body : "";
    if (table !== "ATTLOG") {
      await prisma.device.update({ where: { id: device.id }, data: { lastHeartbeatAt: new Date() } });
      res.type("text/plain").send("OK");
      return;
    }
    const result = await ingest({ route: "PUSH", device, text: body });
    res.type("text/plain").send(`OK: ${result.totalLines - result.rejectedCount}`);
  } catch (err) {
    next(err);
  }
});

// The device polls for commands; we never send any. Its poll is its heartbeat.
admsRouter.get("/getrequest", async (req, res, next) => {
  try {
    const device = await pushDevice(req, res);
    if (!device) return;
    await prisma.device.update({ where: { id: device.id }, data: { lastHeartbeatAt: new Date() } });
    res.type("text/plain").send("OK");
  } catch (err) {
    next(err);
  }
});

// Command results — there are none to receive, but the device may report.
admsRouter.post("/devicecmd", async (req, res, next) => {
  try {
    const device = await pushDevice(req, res);
    if (!device) return;
    res.type("text/plain").send("OK");
  } catch (err) {
    next(err);
  }
});
