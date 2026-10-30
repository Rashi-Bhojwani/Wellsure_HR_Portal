import { getSetting } from "../../../lib/settings";
import { storageService } from "../../../integrations/storage";
import { renderPdf } from "../../../lib/pdf/renderer";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { watermarkFor, type RulePin } from "../rules/context";
import { peopleWithoutPayslip } from "./held";
import { buildPayslips, type PayslipContent } from "./payslip";
import { payslipHtml } from "./payslipHtml";
import { startDelivery } from "./release";
import { whyForPayslip } from "./why";

// Who reads a payslip, and how (docs/plans/PHASE_6.md §9, §14H). An employee reads only their own: the id of somebody else's payslip answers exactly as an id that does
// not exist (404), on every route including the PDF. HR with payroll.payslip.view reads any. A manager, an HR executive and everyone else reads none.

const SIGNED_SECONDS = 300;

const summary = (p: { id: string; cycleLabel: string; cycleStart: Date; cycleEnd: Date; content: unknown; publishedAt: Date; delivery: { fileKey: string | null } | null }) => {
  const c = p.content as PayslipContent;
  return { id: p.id, cycleLabel: p.cycleLabel, cycleStart: p.cycleStart.toISOString().slice(0, 10), cycleEnd: p.cycleEnd.toISOString().slice(0, 10), net: c.totals.net, netInWords: c.netInWords, publishedAt: p.publishedAt.toISOString(), pdfReady: Boolean(p.delivery?.fileKey) };
};

// ── An employee's own ──

export async function myPayslips(employeeId: string) {
  const rows = await prisma.payslip.findMany({ where: { employeeId }, orderBy: { cycleStart: "desc" }, include: { delivery: { select: { fileKey: true } } } });
  return { payslips: rows.map(summary) };
}

async function ownPayslip(employeeId: string, id: string) {
  const row = await prisma.payslip.findFirst({ where: { id, employeeId }, include: { delivery: true } });
  if (!row) throw new HttpError(404, "There is no such payslip.", "NOT_FOUND");
  return row;
}

export async function myPayslipWhy(employeeId: string, id: string) {
  return whyForPayslip(await ownPayslip(employeeId, id));
}

export async function anyPayslipWhy(id: string) {
  const row = await prisma.payslip.findUnique({ where: { id } });
  if (!row) throw new HttpError(404, "There is no such payslip.", "NOT_FOUND");
  return whyForPayslip(row);
}

export async function myPayslip(employeeId: string, id: string) {
  const row = await ownPayslip(employeeId, id);
  return { ...summary(row), content: row.content as unknown as PayslipContent };
}

// ── HR: any payslip of a run ──

export async function runPayslips(runId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId }, select: { id: true, cycleLabel: true, cycleEnd: true } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  const rows = await prisma.payslip.findMany({ where: { runId }, include: { delivery: true, employee: { select: { employeeCode: true } } }, orderBy: { employee: { employeeCode: "asc" } } });
  return {
    runId,
    cycle: run.cycleLabel,
    /** Everyone in the run who has no payslip, with the reason and what to do, so the list is still there after publishing. */
    noPayslip: await peopleWithoutPayslip(run),
    payslips: rows.map((r) => ({
      ...summary(r),
      employeeId: r.employeeId,
      employeeCode: r.employee.employeeCode,
      name: (r.content as unknown as PayslipContent).employee.name,
      delivery: { rendered: Boolean(r.delivery?.fileKey), renderError: r.delivery?.renderError ?? null, notified: Boolean(r.delivery?.notifiedAt), emailStatus: r.delivery?.emailStatus ?? "PENDING", emailTo: r.delivery?.emailTo ?? null, emailError: r.delivery?.emailError ?? null },
    })),
  };
}

export async function anyPayslip(id: string) {
  const row = await prisma.payslip.findUnique({ where: { id }, include: { delivery: true } });
  if (!row) throw new HttpError(404, "There is no such payslip.", "NOT_FOUND");
  return { ...summary(row), employeeId: row.employeeId, content: row.content as unknown as PayslipContent };
}

/** Prepare again: runs whatever is not yet done for a run's payslips (a PDF that failed, an email that failed), and nothing that is. */
export async function prepareAgain(runId: string) {
  if (!(await prisma.payslip.findFirst({ where: { runId }, select: { id: true } }))) throw new HttpError(409, "No payslips have been published for this run.", "NOTHING_PUBLISHED");
  return startDelivery(runId);
}

// ── The PDF ──

/** A short-lived link to the stored PDF, or "being prepared" (and the job is queued again). `row` must already have been shown to be the caller's to read. */
async function pdfLink(row: { id: string; runId: string; cycleLabel: string; delivery: { fileKey: string | null } | null }) {
  if (!row.delivery?.fileKey) {
    await startDelivery(row.runId);
    return { ready: false as const, message: "The PDF is being prepared. Try again in a minute." };
  }
  return { ready: true as const, url: await storageService.getObjectSignedUrl(row.delivery.fileKey, SIGNED_SECONDS, { downloadFileName: `payslip-${row.cycleLabel.replace(/[^A-Za-z0-9]+/g, "-")}.pdf` }), expiresInSeconds: SIGNED_SECONDS };
}

export async function myPayslipPdf(employeeId: string, id: string) {
  return pdfLink(await ownPayslip(employeeId, id));
}
export async function anyPayslipPdf(id: string) {
  const row = await prisma.payslip.findUnique({ where: { id }, include: { delivery: true } });
  if (!row) throw new HttpError(404, "There is no such payslip.", "NOT_FOUND");
  return pdfLink(row);
}

// ── A draft run's payslip, watermarked, never stored ──

export async function draftPreview(runId: string, employeeId: string) {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  if (run.runHash === null) throw new HttpError(409, "This run has not been calculated yet.", "CONFLICT");
  const slips = await buildPayslips(run);
  const slip = slips.get(employeeId);
  if (!slip) throw new HttpError(404, "That person is not payable in this run, so there is no payslip to preview.", "NOT_FOUND");
  const watermark = run.status === "FINALISED" ? null : (await watermarkFor((run.pins as unknown as RulePin[]) ?? [])).text;
  return { content: slip.content, watermark: run.status === "FINALISED" ? null : (watermark ?? "TEST") };
}

export async function draftPreviewPdf(runId: string, employeeId: string): Promise<Buffer> {
  const { content, watermark } = await draftPreview(runId, employeeId);
  const { pdf } = await renderPdf(payslipHtml(content, { watermark: watermark ?? ((await getSetting<boolean>("demo.company", false)) === true ? "DEMO COMPANY — NOT REAL" : "DRAFT — NOT A PAYSLIP") }), new Date(0)); // allow-clock: a fixed PDF date, not a business date
  return pdf;
}
