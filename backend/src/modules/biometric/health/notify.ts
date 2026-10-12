import type { DeviceIncident } from "@prisma/client";
import { mailService } from "../../../integrations/mail";
import { getDeviceAlertSettings, type DeviceAlertSettings } from "../../../lib/deviceAlertSettings";
import { logger } from "../../../lib/logger";
import { activeUsersHoldingPermission, SUPER_ADMIN_ROLE_CODE } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { emailLayout } from "../../auth/emails";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import { escalationMessage, openedMessage, recoveredMessage, type IncidentFacts, type Message, type RecoverySummary } from "./messages";

// Telling people (docs/plans/PHASE_2.md "P2-H build design"): an in-app
// notification to every holder of attendance.devices.manage, and an email to the
// same people plus (by setting) every active Super Admin and a free list. The
// in-app notification is the durable record; an email that fails is logged and
// does not stop the others.

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const LINK = "/admin/admin-tools/devices";

export interface Recipients {
  employeeIds: string[];
  emails: string[];
}

export async function resolveRecipients(settings?: DeviceAlertSettings): Promise<Recipients> {
  const s = settings ?? (await getDeviceAlertSettings());
  const holders = await activeUsersHoldingPermission("attendance.devices.manage");
  const employeeIds = new Set(holders.map((h) => h.employeeId));
  const emails = new Set(s.alertEmails.map((e) => e.trim().toLowerCase()).filter(Boolean));
  if (s.alertSuperAdmins) {
    const admins = await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } }, select: { employeeId: true } });
    for (const a of admins) employeeIds.add(a.employeeId);
  }
  const people = await prisma.employeePersonal.findMany({ where: { employeeId: { in: [...employeeIds] } }, select: { personalEmail: true } });
  for (const p of people) if (p.personalEmail) emails.add(p.personalEmail.trim().toLowerCase());
  return { employeeIds: [...employeeIds], emails: [...emails] };
}

async function deliver(type: string, message: Message, payload: Record<string, unknown>, recipients: Recipients): Promise<void> {
  for (const employeeId of recipients.employeeIds) {
    await notifyEmployee(employeeId, { type, title: message.title, body: message.body, link: LINK, payload });
  }
  const html = emailLayout(escapeHtml(message.title), `<p style="font-size:14px;line-height:1.5">${escapeHtml(message.body)}</p><p style="font-size:13px">Open the Devices screen (Admin Tools → Devices) for the details.</p>`);
  for (const to of recipients.emails) {
    try {
      await mailService.send({ to, subject: `[Attendance devices] ${message.title}`, html, text: `${message.title}\n\n${message.body}` });
    } catch (err) {
      logger.error({ event: "device.incident.email_failed", to, err }, "device incident email failed");
    }
  }
}

/** The names behind an incident's ids, for the words. */
export async function factsFor(incident: DeviceIncident): Promise<IncidentFacts> {
  let subject = "A device";
  let branch: string | null = null;
  if (incident.deviceId) {
    const d = await prisma.device.findUnique({ where: { id: incident.deviceId }, select: { name: true, location: { select: { name: true } } } });
    subject = d?.name ?? subject;
    branch = d?.location.name ?? null;
  } else if (incident.agentId) {
    const a = await prisma.biometricAgent.findUnique({ where: { id: incident.agentId }, select: { name: true, devices: { where: { isActive: true }, select: { location: { select: { name: true } } } } } });
    subject = a?.name ?? "A sync agent";
    const branches = [...new Set((a?.devices ?? []).map((d) => d.location.name))];
    branch = branches.length ? branches.join(", ") : null;
  }
  return { kind: incident.kind, subject, branch, openedAt: incident.openedAt, lastContactAt: incident.lastContactAt, details: incident.details as Record<string, unknown> };
}

const payloadOf = (i: DeviceIncident) => ({ incidentId: i.id, kind: i.kind, deviceId: i.deviceId, agentId: i.agentId });

export async function sendOpened(incident: DeviceIncident, settings?: DeviceAlertSettings): Promise<void> {
  await deliver("attendance.device.incident", openedMessage(await factsFor(incident)), payloadOf(incident), await resolveRecipients(settings));
}

export async function sendEscalation(incident: DeviceIncident, now: Date, settings?: DeviceAlertSettings): Promise<void> {
  await deliver("attendance.device.incident.escalated", escalationMessage(await factsFor(incident), now), payloadOf(incident), await resolveRecipients(settings));
}

export async function sendRecovered(incident: DeviceIncident, summary: RecoverySummary, settings?: DeviceAlertSettings): Promise<void> {
  await deliver("attendance.device.incident.recovered", recoveredMessage(await factsFor(incident), incident.resolvedAt!, summary), { ...payloadOf(incident), summary }, await resolveRecipients(settings));
}

