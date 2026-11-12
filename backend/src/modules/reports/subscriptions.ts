import { z } from "zod";
import { REPORT_CATALOG, REPORT_KEYS, type ReportKey } from "@shared/constants/reports";
import { env } from "../../config/env";
import { mailService } from "../../integrations/mail";
import { writeAuditLog } from "../../lib/audit";
import { businessToday } from "../../lib/businessDate";
import { resolveAccess } from "../../lib/permissions";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { emailLayout } from "../auth/emails";
import type { ReportQuery, ReportViewer } from "./context";
import { catalogFor, runReport } from "./service";

// RP-13 (M session): "email me this report". Only for oneself, only for a report one may open now. A daily job (07:41 IST) sends what is due:
// WEEKLY on Mondays (the last 7 days, or as of today), MONTHLY on the 1st (the last calendar month, or as of today). At send time the report is run
// with the person's access as it is then; anyone who lost access, or left, is stopped with the reason. The email holds the title, the row count
// and a link to open the report in the portal: never the rows, so no personal data or figure travels by email.

export const subscribeSchema = z
  .object({
    reportKey: z.enum(REPORT_KEYS),
    frequency: z.enum(["WEEKLY", "MONTHLY"]),
    filters: z
      .object({
        departmentId: z.string().min(1).max(60).optional(),
        locationId: z.string().min(1).max(60).optional(),
        employmentType: z.enum(["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"]).optional(),
        leaveTypeId: z.string().min(1).max(60).optional(),
        kind: z.enum(["all", "birthday", "anniversary"]).optional(),
      })
      .strict()
      .default({}),
  })
  .strict();

type Meta = { actorUserId: string; ipAddress?: string | null; userAgent?: string | null };
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** May this person open this report now? reports.view is the route's own gate, so it is checked here too (catalogFor assumes the route checked it). */
const mayOpen = (viewer: ReportViewer, key: string) => viewer.permissions.has("reports.view") && catalogFor(viewer).some((r) => r.key === key);

async function viewerOf(userId: string): Promise<ReportViewer | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { status: true, employeeId: true } });
  if (!user || user.status !== "ACTIVE") return null;
  const access = await resolveAccess(userId);
  return { userId, employeeId: user.employeeId, dataScope: access.dataScope, permissions: access.permissions };
}

export async function mine(viewer: ReportViewer) {
  const rows = await prisma.reportSubscription.findMany({ where: { userId: viewer.userId }, orderBy: { createdAt: "asc" } });
  return rows.map((r) => ({ id: r.id, reportKey: r.reportKey, title: REPORT_CATALOG[r.reportKey as ReportKey]?.title ?? r.reportKey, frequency: r.frequency, filters: r.filters, active: r.active, stoppedWhy: r.stoppedWhy, lastSentOn: r.lastSentOn ? iso(r.lastSentOn) : null }));
}

export async function subscribe(input: z.infer<typeof subscribeSchema>, viewer: ReportViewer, meta: Meta) {
  if (!mayOpen(viewer, input.reportKey)) throw new HttpError(403, "You cannot open this report, so it cannot be sent to you.", "FORBIDDEN");
  const row = await prisma.reportSubscription.upsert({
    where: { userId_reportKey: { userId: viewer.userId, reportKey: input.reportKey } },
    create: { userId: viewer.userId, reportKey: input.reportKey, frequency: input.frequency, filters: input.filters },
    update: { frequency: input.frequency, filters: input.filters, active: true, stoppedWhy: null },
  });
  await writeAuditLog({ ...meta, action: "reports.subscription.saved", entityType: "ReportSubscription", entityId: row.id, after: { reportKey: input.reportKey, frequency: input.frequency } });
  return mine(viewer);
}

export async function unsubscribe(id: string, viewer: ReportViewer, meta: Meta) {
  const row = await prisma.reportSubscription.findUnique({ where: { id } });
  if (!row || row.userId !== viewer.userId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  await prisma.reportSubscription.delete({ where: { id } });
  await writeAuditLog({ ...meta, action: "reports.subscription.removed", entityType: "ReportSubscription", entityId: id, before: { reportKey: row.reportKey } });
  return mine(viewer);
}

/** The dates a scheduled run covers, for a report's own date filter. */
export function datesFor(key: ReportKey, frequency: string, today: Date): Pick<ReportQuery, "asOf" | "from" | "to"> {
  const f = REPORT_CATALOG[key].filters;
  if ((f as readonly string[]).includes("asOf")) return { asOf: iso(today) };
  if (!(f as readonly string[]).includes("range")) return {};
  if (frequency === "WEEKLY") return { from: iso(new Date(today.getTime() - 7 * 86_400_000)), to: iso(new Date(today.getTime() - 86_400_000)) };
  const first = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
  const last = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0));
  return { from: iso(first), to: iso(last) };
}

export function isDue(frequency: string, today: Date): boolean {
  return frequency === "WEEKLY" ? today.getUTCDay() === 1 : today.getUTCDate() === 1;
}

/** The daily job. `today` is the business date (IST). Idempotent per day: a subscription is sent at most once a day. */
export async function sendDueReports(today: Date = businessToday()): Promise<{ sent: number; stopped: number }> {
  const subs = await prisma.reportSubscription.findMany({ where: { active: true, OR: [{ lastSentOn: null }, { lastSentOn: { lt: today } }] } });
  let sent = 0;
  let stopped = 0;
  for (const s of subs) {
    if (!isDue(s.frequency, today)) continue;
    const key = s.reportKey as ReportKey;
    const viewer = await viewerOf(s.userId);
    if (!viewer || !mayOpen(viewer, key)) {
      await prisma.reportSubscription.update({ where: { id: s.id }, data: { active: false, stoppedWhy: viewer ? "You can no longer open this report." : "The account is no longer active." } });
      await writeAuditLog({ action: "reports.subscription.stopped", entityType: "ReportSubscription", entityId: s.id, after: { reportKey: key, why: viewer ? "no access" : "inactive" } });
      stopped++;
      continue;
    }
    const q: ReportQuery = { ...(s.filters as ReportQuery), ...datesFor(key, s.frequency, today) };
    const result = await runReport(key, q, viewer);
    const employee = await prisma.employee.findUnique({ where: { id: viewer.employeeId }, select: { officialEmail: true, personal: { select: { personalEmail: true } } } });
    const to = employee?.officialEmail ?? employee?.personal?.personalEmail;
    if (!to) continue;
    const params = new URLSearchParams(Object.entries(q).filter(([, v]) => v !== undefined) as Array<[string, string]>);
    const url = `${env.WEB_BASE_URL}/admin/reports/${key}?${params.toString()}`;
    await mailService.send({
      to,
      subject: `${result.title}: ${result.rows.length} row${result.rows.length === 1 ? "" : "s"}`,
      html: emailLayout(result.title, `<p>Your ${s.frequency === "WEEKLY" ? "weekly" : "monthly"} report is ready: <strong>${result.rows.length}</strong> row${result.rows.length === 1 ? "" : "s"}${result.filtersApplied.length ? ` (${result.filtersApplied.join("; ").replace(/[<>&]/g, "")})` : ""}.</p><p><a href="${url}">Open it in the portal</a> (sign in first). The rows are not in this email.</p><p style="color: #8c8c8c; font-size: 12px;">To stop these emails, open Reports and remove the schedule.</p>`),
    });
    await prisma.reportSubscription.update({ where: { id: s.id }, data: { lastSentOn: today } });
    await writeAuditLog({ action: "reports.subscription.sent", entityType: "ReportSubscription", entityId: s.id, after: { reportKey: key, rows: result.rows.length } });
    sent++;
  }
  return { sent, stopped };
}
