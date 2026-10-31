import type { ApprovalAuthority, Prisma } from "@prisma/client";
import {
  DEFAULT_DIRECTOR_ESCALATION_DAYS,
  DIRECTOR_ESCALATION_DAYS_KEY,
  DIRECTOR_STEP_INFO,
  type DirectorNoticeKind,
  type DirectorNoticeView,
  type DirectorStep,
} from "@shared/constants/directorAuthority";
import { mailService } from "../integrations/mail";
import { DIRECTOR_NOTICE_RETRY, directorNoticeQueue } from "../jobs/directorNoticeQueue";
import { HttpError } from "../middleware/errorHandler";
import { emailLayout } from "../modules/auth/emails";
import { notifyEmployee } from "../modules/notifications/notifyEmployee";
import { getSocketServer } from "../realtime/emit";
import { writeAuditLog } from "./audit";
import { activeDirectors, requireDirector, requireDirectorTwoFactor, type Db } from "./directorAuthority";
import { inForceOn } from "./effectiveDating";
import { logger } from "./logger";
import { prisma } from "./prisma";
import { getSetting } from "./settings";

// What a director's own-authority act tells the other director (docs/plans/DIRECTOR_AUTHORITY.md §6, owner's answers Q-DA-5/6/7).
//   - The notice and one receipt per OTHER active director are written in the SAME transaction as the act: an act without a notice cannot exist.
//   - Delivery comes after (bell, realtime, e-mail) and never blocks or undoes the act. A failure is recorded on the receipt and retried.
//   - Counts only. A notice never carries an amount, an identifier or an employee's name; the e-mail leaves the system.
//   - Left unacknowledged past the escalation days (3), it raises a red banner. No extra e-mail.

export interface NoticeInput {
  kind: DirectorNoticeKind;
  step: DirectorStep;
  subjectType: string;
  subjectId: string;
  /** "the payroll run for October 2026". Never a figure, never a person. */
  subjectLabel: string;
  itemCount?: number | null;
  actorUserId: string;
  approvalId?: string | null;
  authority?: ApprovalAuthority | null;
  detail?: Record<string, unknown>;
}

/** Writes the notice and a receipt for every other active director. Pass the transaction client of the act itself. */
export async function recordDirectorNotice(input: NoticeInput, db: Db): Promise<{ noticeId: string; recipients: string[] }> {
  const notice = await db.directorActionNotice.create({
    data: {
      kind: input.kind,
      step: input.step,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      subjectLabel: input.subjectLabel,
      itemCount: input.itemCount ?? null,
      actorUserId: input.actorUserId,
      approvalId: input.approvalId ?? null,
      authority: input.authority ?? null,
      detail: (input.detail ?? {}) as Prisma.InputJsonValue,
    },
  });
  const others = (await activeDirectors(db)).filter((d) => d.userId !== input.actorUserId);
  if (others.length > 0) await db.directorActionReceipt.createMany({ data: others.map((d) => ({ noticeId: notice.id, recipientUserId: d.userId })) });
  return { noticeId: notice.id, recipients: others.map((d) => d.userId) };
}

/** A red banner for every Super Admin other than the actor, until one of them acknowledges it (the existing security-event banner). */
export async function raiseDirectorBanner(input: { noticeId: string; kind: string; targetUserId: string; summary: string; extra?: Record<string, unknown> }, db: Db): Promise<string> {
  const event = await db.securityEvent.create({
    data: { kind: input.kind, targetUserId: input.targetUserId, summary: input.summary, details: { noticeId: input.noticeId, ...(input.extra ?? {}) } as Prisma.InputJsonValue },
  });
  return event.id;
}

/** After the act has committed: hand the notice to the worker. A queue that is down is not an error for the act; the hourly sweep picks the notice up. */
export async function scheduleDelivery(noticeId: string | null): Promise<void> {
  if (!noticeId) return;
  getSocketServer()?.to("role:SUPER_ADMIN").emit("security.event", { noticeId });
  try {
    await directorNoticeQueue().add("deliver", { noticeId }, { jobId: `director-notice-${noticeId}`, ...DIRECTOR_NOTICE_RETRY });
  } catch (err) {
    logger.error({ event: "director.notice.not_queued", noticeId, err }, "director notice could not be queued; the sweep will deliver it");
  }
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function noticeTitle(n: { kind: string; step: string; subjectType?: string }): string {
  if (n.subjectType === "SELF_PAY_CHANGE") return "The other director changed their own pay";
  const label = DIRECTOR_STEP_INFO[n.step as DirectorStep]?.label ?? n.step;
  if (n.kind === "SWITCH_CHANGED") return "The other director changed a second-director check";
  if (n.kind === "SETTING_CHANGED") return "The other director changed a system setting";
  return `The other director acted on their own authority: ${label}`;
}

/** Delivers a notice to each recipient not yet reached. Throws if any delivery failed, so the queue retries; each success is recorded once. */
export async function deliverDirectorNotice(noticeId: string): Promise<{ delivered: number; failed: number }> {
  const notice = await prisma.directorActionNotice.findUnique({ where: { id: noticeId }, include: { receipts: true } });
  if (!notice) return { delivered: 0, failed: 0 };
  let delivered = 0;
  let failed = 0;
  for (const receipt of notice.receipts) {
    if (receipt.deliveredAt && receipt.emailedAt) continue;
    const user = await prisma.user.findUnique({
      where: { id: receipt.recipientUserId },
      select: { employeeId: true, employee: { select: { personal: { select: { personalEmail: true } } } } },
    });
    if (!user) continue;
    let reason: string | null = null;
    const now = new Date(); // allow-clock: an instant
    try {
      if (!receipt.deliveredAt) {
        await notifyEmployee(user.employeeId, {
          type: "director.action",
          title: noticeTitle(notice),
          body: `${notice.subjectLabel}${notice.itemCount != null ? ` · ${notice.itemCount}` : ""}`,
          link: "/admin/admin-tools/settings",
          payload: { noticeId: notice.id },
        });
        await prisma.directorActionReceipt.update({ where: { id: receipt.id }, data: { deliveredAt: now } });
      }
      if (!receipt.emailedAt) {
        const to = user.employee.personal?.personalEmail;
        if (to) {
          await mailService.send({
            to,
            subject: `[Wellsure HR] ${noticeTitle(notice)}`,
            html: emailLayout(
              escapeHtml(noticeTitle(notice)),
              `<p>${escapeHtml(notice.subjectLabel)}${notice.itemCount != null ? ` (${notice.itemCount})` : ""}</p>
               <p style="color:#595959">This took effect at once. It is recorded in the audit log. Sign in to read it and acknowledge it.</p>`,
            ),
          });
          await prisma.directorActionReceipt.update({ where: { id: receipt.id }, data: { emailedAt: new Date() } }); // allow-clock: an instant
        } else {
          reason = "no e-mail address on record";
        }
      }
    } catch (err) {
      reason = err instanceof Error ? err.message.slice(0, 200) : "delivery failed";
      logger.error({ event: "director.notice.delivery_failed", noticeId, err }, "director notice delivery failed");
    }
    if (reason) {
      failed += 1;
      await prisma.directorActionReceipt.update({ where: { id: receipt.id }, data: { failedReason: reason } });
    } else {
      delivered += 1;
    }
  }
  if (failed > 0) throw new Error(`director notice ${noticeId}: ${failed} delivery failure(s)`);
  return { delivered, failed };
}

/** Hourly. Delivers what was never delivered, and raises the red banner for a notice left unacknowledged past the escalation days. No extra e-mail. */
export async function sweepDirectorNotices(now: Date = new Date()): Promise<{ redelivered: number; escalated: number }> { // allow-clock: an instant
  const days = await getSetting<number>(DIRECTOR_ESCALATION_DAYS_KEY, DEFAULT_DIRECTOR_ESCALATION_DAYS);
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  const undelivered = await prisma.directorActionReceipt.findMany({ where: { OR: [{ deliveredAt: null }, { emailedAt: null }], createdAt: { lte: new Date(now.getTime() - 5 * 60 * 1000) } }, select: { noticeId: true }, distinct: ["noticeId"] });
  let redelivered = 0;
  for (const u of undelivered) {
    try {
      await deliverDirectorNotice(u.noticeId);
      redelivered += 1;
    } catch {
      // recorded on the receipt; tried again at the next sweep
    }
  }
  // One banner per notice, however many directors have not acknowledged it: the banner already reaches every Super Admin but the one who acted, and the first of them to
  // acknowledge the notice clears it.
  const due = await prisma.directorActionReceipt.findMany({
    where: { acknowledgedAt: null, escalatedAt: null, notice: { createdAt: { lte: cutoff }, kind: { in: ["ACTION", "SETTING_CHANGED"] } } },
    include: { notice: true },
  });
  let escalated = 0;
  const byNotice = new Map<string, typeof due>();
  for (const r of due) byNotice.set(r.noticeId, [...(byNotice.get(r.noticeId) ?? []), r]);
  for (const [noticeId, receipts] of byNotice) {
    const notice = receipts[0]!.notice;
    const raised = await prisma.$transaction(async (tx) => {
      const fresh = await tx.directorActionReceipt.findMany({ where: { id: { in: receipts.map((r) => r.id) }, acknowledgedAt: null, escalatedAt: null } });
      if (fresh.length === 0) return false;
      const already = await tx.securityEvent.count({ where: { kind: "director.unacknowledged", details: { path: ["noticeId"], equals: noticeId } } });
      if (already === 0) {
        await raiseDirectorBanner(
          {
            noticeId,
            kind: "director.unacknowledged",
            targetUserId: notice.actorUserId,
            summary: `A director action has waited ${days} days to be acknowledged: ${DIRECTOR_STEP_INFO[notice.step as DirectorStep]?.label ?? notice.step} — ${notice.subjectLabel}.`,
          },
          tx,
        );
      }
      await tx.directorActionReceipt.updateMany({ where: { id: { in: fresh.map((r) => r.id) } }, data: { escalatedAt: now } });
      return already === 0;
    });
    if (raised) escalated += 1;
  }
  if (escalated > 0) getSocketServer()?.to("role:SUPER_ADMIN").emit("security.event", { escalated });
  return { redelivered, escalated };
}

// ── What a director sees ──

async function nameOfUser(userId: string): Promise<string> {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { employee: { select: { employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } } });
  return u?.employee.nameHistory[0]?.fullName ?? u?.employee.employeeCode ?? "A director";
}

export async function listMyNotices(userId: string, status: "open" | "all", limit = 100): Promise<DirectorNoticeView[]> {
  await requireDirector(userId, "read director notices");
  const rows = await prisma.directorActionReceipt.findMany({
    where: { recipientUserId: userId, ...(status === "open" ? { acknowledgedAt: null } : {}) },
    include: { notice: true },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const names = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.notice.actorUserId))) names.set(id, await nameOfUser(id));
  return rows.map((r) => ({
    id: r.noticeId,
    kind: r.notice.kind as DirectorNoticeKind,
    step: r.notice.step,
    stepLabel: DIRECTOR_STEP_INFO[r.notice.step as DirectorStep]?.label ?? r.notice.step,
    subjectLabel: r.notice.subjectLabel,
    itemCount: r.notice.itemCount,
    authority: r.notice.authority,
    createdAt: r.notice.createdAt.toISOString(),
    actorName: names.get(r.notice.actorUserId) ?? "A director",
    seenAt: r.seenAt?.toISOString() ?? null,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    escalated: r.escalatedAt !== null,
  }));
}

export async function markNoticeSeen(noticeId: string, userId: string): Promise<void> {
  await requireDirector(userId, "read director notices");
  await prisma.directorActionReceipt.updateMany({ where: { noticeId, recipientUserId: userId, seenAt: null }, data: { seenAt: new Date() } }); // allow-clock: an instant
}

/** Acknowledging a notice also clears the red banner raised for it. Needs two-step sign-in outside development, like every director act. */
export async function acknowledgeNotice(noticeId: string, userId: string, note: string, meta: { ip?: string | null; userAgent?: string | null } = {}): Promise<void> {
  await requireDirector(userId, "acknowledge a director action");
  await requireDirectorTwoFactor(userId);
  const trimmed = note.trim();
  if (trimmed.length < 3) throw new HttpError(400, "Say what you checked (a few words).", "VALIDATION_ERROR");
  const receipt = await prisma.directorActionReceipt.findUnique({ where: { noticeId_recipientUserId: { noticeId, recipientUserId: userId } }, include: { notice: true } });
  if (!receipt) throw new HttpError(404, "No such notice for you.", "NOT_FOUND");
  if (receipt.acknowledgedAt) return;
  const at = new Date(); // allow-clock: an instant
  await prisma.$transaction(async (tx) => {
    await tx.directorActionReceipt.update({ where: { id: receipt.id }, data: { acknowledgedAt: at, seenAt: receipt.seenAt ?? at } });
    const banners = await tx.securityEvent.findMany({ where: { kind: { startsWith: "director." }, acknowledgedAt: null, details: { path: ["noticeId"], equals: noticeId } } });
    for (const b of banners) {
      // The banner is for the people who did not do the act; the one who did cannot clear it (the receipt belongs to a recipient, so this is never the actor).
      if (b.targetUserId !== userId) await tx.securityEvent.update({ where: { id: b.id }, data: { acknowledgedAt: at, acknowledgedByUserId: userId, acknowledgementNote: trimmed } });
    }
  });
  await writeAuditLog({ actorUserId: userId, action: "director.notice.acknowledged", entityType: "DirectorActionNotice", entityId: noticeId, after: { step: receipt.notice.step, note: trimmed }, ipAddress: meta.ip ?? null, userAgent: meta.userAgent ?? null });
  getSocketServer()?.to("role:SUPER_ADMIN").emit("security.event", { noticeId });
}

/** How many notices from directors are unread by this director (for the inbox). */
export async function openNoticeCount(userId: string): Promise<number> {
  return prisma.directorActionReceipt.count({ where: { recipientUserId: userId, acknowledgedAt: null } });
}
