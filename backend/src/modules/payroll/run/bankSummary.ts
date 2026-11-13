import { escapeHtml } from "../../../lib/htmlEscape";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { requireDirector } from "../../../lib/directorAuthority";
import { namesOn } from "../../../lib/effectiveDating";
import { embeddedFontCss, renderPdf } from "../../../lib/pdf/renderer";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { getLetterhead } from "../../letters/service";
import { dec, fixed, sum, type Money } from "../money";

// PY-37 (docs/plans/A_PARITY_ROWS.md; spec §7.5 "bank bulk-transfer file ... + summary PDF"): a one-page summary of a written bank file for the director who uploads
// it and the signatory who releases it. Company, run, payment date, rows and total, per bank (the IFSC's bank code) the count and the total, who wrote the file
// and who approved it, and a line to sign. No account number and no person's name or pay. Directors only; every download audited.

type Actor = { userId: string; ip?: string | null };
const esc = escapeHtml;

/** Per bank code (the IFSC's first four letters): rows and total, exact. Pure; exported for the test. */
export function byBank(rows: ReadonlyArray<{ ifsc: string; amount: string }>): Array<{ bank: string; rows: number; total: Money }> {
  const groups = new Map<string, string[]>();
  for (const r of rows) {
    const bank = r.ifsc.slice(0, 4).toUpperCase() || "—"; // allow-number: an IFSC's bank code is its first four letters
    groups.set(bank, [...(groups.get(bank) ?? []), r.amount]);
  }
  return [...groups].sort((a, b) => a[0].localeCompare(b[0])).map(([bank, amounts]) => ({ bank, rows: amounts.length, total: sum(amounts.map((a) => dec(a))) }));
}

async function nameOfUser(userId: string | null | undefined): Promise<string> {
  if (!userId) return "—";
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { employeeId: true } });
  if (!u?.employeeId) return "—";
  return (await namesOn([u.employeeId], businessToday())).get(u.employeeId) ?? "—";
}

/** The summary page's HTML (exported for the test that it carries no account number, name or pay). Callers check the director first. */
export async function bankSummaryHtml(batchId: string): Promise<{ html: string; cycle: string; id: string }> {
  const b = await prisma.bankTransferBatch.findUnique({ where: { id: batchId }, include: { run: { select: { cycleLabel: true } }, rows: { select: { ifsc: true, amount: true } } } });
  if (!b) throw new HttpError(404, "There is no such bank batch.", "NOT_FOUND");
  const approval = await prisma.payrollApproval.findFirst({ where: { subject: "BANK_FILE", subjectId: b.runId, status: { in: ["APPROVED", "CONSUMED"] } }, orderBy: { submittedAt: "desc" }, select: { checkerUserId: true, makerUserId: true } });
  const [letterhead, preparedBy, approvedBy] = await Promise.all([getLetterhead(), nameOfUser(b.generatedByUserId), nameOfUser(approval?.checkerUserId)]);
  const groups = byBank(b.rows.map((r) => ({ ifsc: r.ifsc, amount: r.amount.toString() })));
  const total = fixed(dec(b.total.toString()), 2);
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
${embeddedFontCss()}
@page { size: A4; margin: 16mm; }
body { font-family: "Letter Sans"; font-size: 10pt; color: #111; line-height: 1.45; margin: 0; }
.co { font-size: 14pt; font-weight: 700; } .addr { font-size: 8.5pt; color: #444; white-space: pre-line; border-bottom: 1.5px solid #333; padding-bottom: 6px; margin-bottom: 10px; }
h1 { font-size: 12pt; margin: 8px 0; } table { width: 100%; border-collapse: collapse; margin-top: 6px; }
td, th { padding: 4px 0; border-bottom: 1px solid #ddd; text-align: left; } .amt { text-align: right; white-space: nowrap; }
.tot td { font-weight: 700; border-top: 1px solid #333; border-bottom: none; } .note { margin-top: 10px; color: #555; font-size: 8.5pt; }
.sign { margin-top: 36px; display: flex; gap: 40px; } .sign div { flex: 1; border-top: 1px solid #333; padding-top: 4px; font-size: 9pt; }
</style></head><body>
<div class="co">${esc(letterhead.legalName || "Company")}</div><div class="addr">${esc(letterhead.registeredAddress)}</div>
<h1>Bank transfer summary: ${esc(b.run.cycleLabel)}</h1>
<table>
<tr><td>Payment date</td><td class="amt">${esc(b.paymentDate.toISOString().slice(0, 10))}</td></tr>
<tr><td>File</td><td class="amt">${esc(b.fileName)}</td></tr>
<tr><td>File fingerprint (SHA-256, first 16)</td><td class="amt">${esc(b.fileSha256.slice(0, 16))}</td></tr>
<tr><td>Rows</td><td class="amt">${b.rowCount}</td></tr>
<tr><td>Total</td><td class="amt">₹ ${esc(total)}</td></tr>
<tr><td>File written by</td><td class="amt">${esc(preparedBy)}</td></tr>
<tr><td>Bank file approved by</td><td class="amt">${esc(approvedBy)}</td></tr>
</table>
<table><tr><th>Bank (IFSC code)</th><th class="amt">Rows</th><th class="amt">Total</th></tr>
${groups.map((g) => `<tr><td>${esc(g.bank)}</td><td class="amt">${g.rows}</td><td class="amt">₹ ${esc(fixed(g.total, 2))}</td></tr>`).join("")}
<tr class="tot"><td>Total</td><td class="amt">${b.rowCount}</td><td class="amt">₹ ${esc(total)}</td></tr></table>
<div class="note">This app moves no money. The file is uploaded to net banking by a director and released there by the authorised signatory. No account number is shown here.</div>
<div class="sign"><div>Uploaded by (name, date)</div><div>Released by the authorised signatory (name, date)</div></div>
</body></html>`;
  return { html, cycle: b.run.cycleLabel, id: b.id };
}

export async function bankSummaryPdf(batchId: string, actor: Actor): Promise<{ pdf: Buffer; fileName: string }> {
  await requireDirector(actor.userId, "download a bank summary");
  const { html, cycle, id } = await bankSummaryHtml(batchId);
  const { pdf } = await renderPdf(html, new Date(0)); // allow-clock: a fixed PDF date, not a business date
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.bank.summary_downloaded", entityType: "BankTransferBatch", entityId: id, after: { cycle } });
  return { pdf, fileName: `bank-summary-${cycle.replace(/[^A-Za-z0-9]+/g, "-")}.pdf` };
}
