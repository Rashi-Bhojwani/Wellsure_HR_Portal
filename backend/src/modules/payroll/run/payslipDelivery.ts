import { getSetting } from "../../../lib/settings";
import { createHash } from "node:crypto";
import { env } from "../../../config/env";
import { mailService, describeMailError } from "../../../integrations/mail";
import { storageService } from "../../../integrations/storage";
import { renderPdf } from "../../../lib/pdf/renderer";
import { prisma } from "../../../lib/prisma";
import { logger } from "../../../lib/logger";
import { emailLayout } from "../../auth/emails";
import { notifyEmployee } from "../../notifications/notifyEmployee";
import type { PayslipContent } from "./payslip";
import { payslipHtml } from "./payslipHtml";

// Getting published payslips to their owners: the PDF, the notice in the app and the email (docs/plans/PHASE_6.md §9, §14H). Run by the payroll-payslips job in small
// batches, and safe to run again: each step is done only if it is not already done, so a stopped worker or a second press of Prepare again repeats nothing.
// The email has no figure in it, only a link; a failed email is recorded as failed and retried, never counted as sent.

const BATCH = 10;
const PAUSE_MS = 250; // between emails, so a full run does not hit a sender's rate limit

export const payslipPdfKey = (runId: string, payslipId: string) => `payroll/payslips/${runId}/${payslipId}.pdf`;

/** Renders one payslip to PDF and stores it. Returns the stored key. Never stores a draft: this is only for published payslips. */
async function renderAndStore(slip: { id: string; runId: string; content: unknown; publishedAt: Date }): Promise<{ key: string; sha256: string }> {
  // In the demo company every payslip says so across the page, so none can be taken for a real one.
  const demo = (await getSetting<boolean>("demo.company", false)) === true;
  const { pdf } = await renderPdf(payslipHtml(slip.content as PayslipContent, { watermark: demo ? "DEMO COMPANY — NOT REAL" : null }), slip.publishedAt);
  const key = payslipPdfKey(slip.runId, slip.id);
  await storageService.putObject(key, pdf, "application/pdf");
  return { key, sha256: createHash("sha256").update(pdf).digest("hex") };
}

export interface DeliverySummary {
  total: number;
  rendered: number;
  renderFailed: number;
  notified: number;
  emailSent: number;
  emailFileOnly: number;
  emailFailed: number;
}

export async function deliverPayslips(runId: string): Promise<DeliverySummary> {
  const summary: DeliverySummary = { total: 0, rendered: 0, renderFailed: 0, notified: 0, emailSent: 0, emailFileOnly: 0, emailFailed: 0 };
  let after: string | undefined;
  for (;;) {
    const slips = await prisma.payslip.findMany({ where: { runId }, orderBy: { id: "asc" }, take: BATCH, ...(after ? { skip: 1, cursor: { id: after } } : {}), include: { delivery: true, employee: { select: { id: true, personal: { select: { personalEmail: true } }, nameHistory: { take: 1, orderBy: { effectiveFrom: "desc" }, select: { fullName: true } } } } } });
    if (slips.length === 0) break;
    after = slips.at(-1)!.id;
    for (const slip of slips) {
      summary.total += 1;
      const delivery = slip.delivery ?? (await prisma.payslipDelivery.upsert({ where: { payslipId: slip.id }, create: { payslipId: slip.id }, update: {} }));
      let fileKey = delivery.fileKey;
      if (!fileKey) {
        try {
          const stored = await renderAndStore(slip);
          await prisma.payslipDelivery.update({ where: { id: delivery.id }, data: { fileKey: stored.key, fileSha256: stored.sha256, renderedAt: new Date(), renderError: null, attempts: { increment: 1 } } }); // allow-clock: an instant
          fileKey = stored.key;
          summary.rendered += 1;
        } catch (err) {
          logger.error({ err, payslipId: slip.id }, "payslip PDF could not be rendered");
          await prisma.payslipDelivery.update({ where: { id: delivery.id }, data: { renderError: err instanceof Error ? err.message.slice(0, 300) : "The PDF could not be made.", attempts: { increment: 1 } } });
          summary.renderFailed += 1;
        }
      }
      const content = slip.content as unknown as PayslipContent;
      if (!delivery.notifiedAt) {
        await notifyEmployee(slip.employeeId, { type: "payslip.published", title: `Your payslip for ${content.period.label} is ready`, body: "Open Salary to read it.", link: "/app/salary/payslips", payload: { payslipId: slip.id } });
        await prisma.payslipDelivery.update({ where: { id: delivery.id }, data: { notifiedAt: new Date() } }); // allow-clock: an instant
        summary.notified += 1;
      }
      if (delivery.emailStatus !== "SENT" && delivery.emailStatus !== "FILE_ONLY") {
        const to = slip.employee.personal?.personalEmail ?? "";
        const attemptedAt = new Date(); // allow-clock: an instant
        if (!to) {
          await prisma.payslipDelivery.update({ where: { id: delivery.id }, data: { emailStatus: "FAILED", emailTo: null, emailError: "No personal email on file.", emailAttemptedAt: attemptedAt } });
          summary.emailFailed += 1;
        } else {
          try {
            const name = slip.employee.nameHistory[0]?.fullName ?? content.employee.name;
            const receipt = await mailService.send({
              to,
              subject: `Your payslip for ${content.period.label} is ready`,
              html: emailLayout("Your payslip is ready", `<p>Hi ${name.replace(/[<>&"']/g, "")},</p><p>Your payslip for <strong>${content.period.label.replace(/[<>&"']/g, "")}</strong> is ready. Sign in to read it.</p><p><a href="${env.WEB_BASE_URL}/app/salary/payslips" style="display:inline-block;background:#2f6fed;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;">Open my payslips</a></p>`),
            });
            await prisma.payslipDelivery.update({ where: { id: delivery.id }, data: { emailStatus: receipt.delivered ? "SENT" : "FILE_ONLY", emailTo: to, emailError: null, emailAttemptedAt: attemptedAt } });
            if (receipt.delivered) summary.emailSent += 1;
            else summary.emailFileOnly += 1;
          } catch (err) {
            await prisma.payslipDelivery.update({ where: { id: delivery.id }, data: { emailStatus: "FAILED", emailTo: to, emailError: describeMailError(err), emailAttemptedAt: attemptedAt } });
            summary.emailFailed += 1;
          }
          await new Promise((r) => setTimeout(r, PAUSE_MS));
        }
      }
    }
  }
  return summary;
}
