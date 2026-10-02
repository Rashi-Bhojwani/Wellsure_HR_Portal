import { hostname, userInfo } from "node:os";
import { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { mailService, type MailMessage } from "../integrations/mail";
import { SECURITY_ALERT_RETRY, securityAlertQueue } from "../jobs/securityAlertQueue";
import { emailLayout } from "../modules/auth/emails";
import { notifyEmployee } from "../modules/notifications/notifyEmployee";
import { getSocketServer } from "../realtime/emit";
import { logger } from "./logger";
import { SUPER_ADMIN_ROLE_CODE } from "./permissions";
import { prisma } from "./prisma";

// Making the break-glass CLIs loud (Phase 5 commit E1.1, docs/plans/PHASE_5.md).
//
// Whoever runs admin:recover / admin:bootstrap has a shell and the database
// credentials, so they could skip these CLIs entirely; nothing in the app can
// prevent that (spec §9 says so plainly). What this module guarantees is that
// using the CLI is never quiet, and that the first record of it is written
// OUTSIDE the database:
//   1. a structured log line (event "security.breakglass") — stdout, which is
//      CloudWatch Logs in AWS, alarmed on in Phase 1.5;
//   2. an email to every active Super Admin (the target included) and to
//      SECURITY_ALERT_EMAIL, sent BEFORE anything changes. If any send fails
//      the caller stops, unless the operator said --mail-is-down, in which
//      case the failed sends are queued and retried for 24 hours;
//   3. an append-only security_events row — a red banner for every Super
//      Admin until one OTHER than the target acknowledges it — plus an
//      in-app notification to each Super Admin.

export type BreakGlassKind = "break_glass.recover" | "break_glass.bootstrap";

export interface BreakGlassAlert {
  kind: BreakGlassKind;
  targetUserId: string | null;
  target: string; // "1000 · Aditi Sharma"
  actions: string[];
  reason: string;
  justification: string | null;
  operator: string;
}

export interface BreakGlassAlertResult {
  eventId: string;
  emailed: string[];
  queued: string[];
}

export class AlertNotDelivered extends Error {}

export function breakGlassOrigin() {
  let osUser: string | null = null;
  try {
    osUser = userInfo().username;
  } catch {
    osUser = null;
  }
  return {
    hostname: hostname(),
    osUser,
    // Set inside ECS tasks; ties the run to a task, and CloudTrail ties the
    // ECS Exec session that opened the shell to an AWS identity.
    ecsMetadata: process.env.ECS_CONTAINER_METADATA_URI_V4 ?? null,
    appEnv: env.APP_ENV,
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

async function activeSuperAdmins() {
  return prisma.user.findMany({
    where: { status: "ACTIVE", roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } },
    select: { id: true, employeeId: true, lastLoginAt: true, employee: { select: { employeeCode: true, personal: { select: { personalEmail: true } }, nameHistory: { where: { effectiveTo: null }, select: { fullName: true } } } } },
  });
}

// For the CLI's "who else could have done this in the app?" listing.
export async function listActiveSuperAdmins() {
  return (await activeSuperAdmins()).map((u) => ({
    userId: u.id,
    employeeCode: u.employee.employeeCode,
    name: u.employee.nameHistory[0]?.fullName ?? u.employee.employeeCode,
    lastLoginAt: u.lastLoginAt,
  }));
}

function alertEmail(to: string, a: BreakGlassAlert, origin: ReturnType<typeof breakGlassOrigin>, at: Date): MailMessage {
  const title = a.kind === "break_glass.recover" ? "Break-glass recovery was used on a Super Admin account" : "A Super Admin was created with the bootstrap tool";
  const rows: Array<[string, string]> = [
    ["When", `${at.toISOString()} (UTC)`],
    ["Account", a.target],
    ["Actions", a.actions.join("; ")],
    ["Reason given", a.reason],
    ...(a.justification ? ([["Why the in-app route wasn't used", a.justification]] as Array<[string, string]>) : []),
    ["Operator (self-declared)", a.operator],
    ["Machine", `${origin.hostname}${origin.osUser ? ` (user ${origin.osUser})` : ""} · ${origin.appEnv}`],
  ];
  const table = rows.map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#595959;vertical-align:top">${escapeHtml(k)}</td><td style="padding:4px 0">${escapeHtml(v)}</td></tr>`).join("");
  return {
    to,
    subject: `[Security] ${title}`,
    html: emailLayout(
      title,
      `<p>This was done from a server shell, outside the normal sign-in screens. Every Super Admin receives this email.</p>
       <table style="border-collapse:collapse;font-size:14px">${table}</table>
       <p><strong>If you didn't expect this, treat it as an incident:</strong> sign in, check the Security banner and the audit log, and review who has server access.</p>`,
    ),
  };
}

export async function raiseBreakGlassAlert(a: BreakGlassAlert, opts: { mailIsDown?: boolean } = {}): Promise<BreakGlassAlertResult> {
  const origin = breakGlassOrigin();
  const at = new Date();
  // 1. Outside the database first — this line exists even if everything after fails.
  logger.warn({ event: "security.breakglass", kind: a.kind, targetUserId: a.targetUserId, target: a.target, actions: a.actions, reason: a.reason, justification: a.justification, operator: a.operator, origin }, "break-glass tool used");

  // 2. Email, before anything changes.
  const admins = await activeSuperAdmins();
  const recipients = [...new Set([...admins.map((u) => u.employee.personal?.personalEmail).filter((e): e is string => Boolean(e)), ...(env.SECURITY_ALERT_EMAIL ? [env.SECURITY_ALERT_EMAIL] : [])])];
  const emailed: string[] = [];
  const failed: MailMessage[] = [];
  for (const to of recipients) {
    const message = alertEmail(to, a, origin, at);
    try {
      await mailService.send(message);
      emailed.push(to);
    } catch (err) {
      logger.error({ event: "security.breakglass.alert_failed", to, err }, "break-glass alert email failed");
      failed.push(message);
    }
  }
  const queued: string[] = [];
  if (failed.length > 0) {
    if (!opts.mailIsDown) {
      logger.warn({ event: "security.breakglass.aborted", kind: a.kind, target: a.target, undelivered: failed.map((m) => m.to) }, "break-glass aborted: alert email not delivered");
      throw new AlertNotDelivered(
        `The alert email couldn't be sent to ${failed.map((m) => m.to).join(", ")}, so nothing was changed. Fix email, or re-run with --mail-is-down to proceed anyway (the alert is then queued and retried for 24 hours).`,
      );
    }
    for (const m of failed) {
      try {
        await securityAlertQueue().add("alert", m, SECURITY_ALERT_RETRY);
        queued.push(m.to);
      } catch (err) {
        // Redis down too: the log line and the security event still stand.
        logger.error({ event: "security.breakglass.alert_not_queued", to: m.to, err }, "break-glass alert could not even be queued");
      }
    }
  }

  // 3. The permanent in-app record, the banner, and a notification each.
  const event = await prisma.securityEvent.create({
    data: {
      kind: a.kind,
      targetUserId: a.targetUserId,
      summary: `${a.kind === "break_glass.recover" ? "Break-glass recovery" : "Super Admin bootstrap"} on ${a.target}: ${a.actions.join("; ")}`,
      details: { reason: a.reason, justification: a.justification, operator: a.operator, origin, actions: a.actions, emailed, queued } as Prisma.InputJsonValue,
    },
  });
  for (const admin of admins) {
    await notifyEmployee(admin.employeeId, {
      type: "access.alert",
      title: "Security: break-glass tool used",
      body: `${a.target} — ${a.actions.join("; ")}. Reason: ${a.reason}`,
      link: "/admin",
      payload: { securityEventId: event.id },
    });
  }
  getSocketServer()?.to(`role:${SUPER_ADMIN_ROLE_CODE}`).emit("security.event", { id: event.id });
  return { eventId: event.id, emailed, queued };
}
