import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { financialYearOf } from "@shared/utils/financialYear";
import { storageService } from "../../../integrations/storage";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { namesOn } from "../../../lib/effectiveDating";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { prepareDocumentUpload } from "../../../lib/uploads";
import { getPeopleDocumentsSettings } from "../../../lib/peopleDocumentsSettings";
import { canonicalDecimal, dec, sum, type Money } from "../money";

// P7-5 (docs/plans/P7_5_REIMBURSEMENTS.md): reimbursements. A claim is the person's own; the directors (the payroll team) decide, never on their own claim; an approved
// claim is paid only through the next payroll run (a pending earning adjustment). Rows are immutable; a claim has at most one decision.

export interface Actor {
  userId: string;
  ip?: string | null;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const day = (s: string) => new Date(`${s}T00:00:00Z`);
const MONEY = /^\d+(\.\d{1,2})?$/;

export const typeSchema = z
  .object({
    typeKey: z.string().regex(/^[A-Z][A-Z0-9_]{1,31}$/, "Capital letters, digits and _"),
    name: z.string().trim().min(2).max(60),
    employeesMayClaim: z.boolean().nullable(),
    billsRequired: z.boolean().nullable(),
    monthlyCapSet: z.boolean(),
    monthlyCap: z.string().regex(MONEY).nullable(),
    yearlyCapSet: z.boolean(),
    yearlyCap: z.string().regex(MONEY).nullable(),
    payHead: z.string().min(1).max(40).nullable(),
    retired: z.boolean().default(false),
    reason: z.string().trim().min(3).max(300),
  })
  .strict()
  .refine((v) => v.monthlyCapSet || v.monthlyCap === null, "A monthly cap needs 'set' chosen")
  .refine((v) => v.yearlyCapSet || v.yearlyCap === null, "A yearly cap needs 'set' chosen");

type TypeRow = Awaited<ReturnType<typeof prisma.claimTypeVersion.findFirstOrThrow>>;
async function latestTypes() {
  const rows = await prisma.claimTypeVersion.findMany({ orderBy: [{ typeKey: "asc" }, { version: "asc" }] });
  const latest = new Map<string, TypeRow>();
  for (const r of rows) latest.set(r.typeKey, r);
  return latest;
}

/** What a claim type still lacks (Not set until a director chooses; "no cap" is a choice, made by setting the cap with no figure). */
export function typeGaps(t: Pick<TypeRow, "employeesMayClaim" | "billsRequired" | "monthlyCapSet" | "yearlyCapSet" | "payHead" | "retired">): string[] {
  const gaps: string[] = [];
  if (t.retired) gaps.push("the type is retired");
  if (t.employeesMayClaim === null) gaps.push("whether employees may claim it");
  if (t.billsRequired === null) gaps.push("whether a bill is required");
  if (!t.monthlyCapSet) gaps.push("the monthly cap (or no cap)");
  if (!t.yearlyCapSet) gaps.push("the cap for the financial year (or no cap)");
  if (!t.payHead) gaps.push("the earning pay head it is paid under");
  return gaps;
}
const typeView = (t: TypeRow) => ({ ...t, monthlyCap: t.monthlyCap ? canonicalDecimal(dec(t.monthlyCap.toString())) : null, yearlyCap: t.yearlyCap ? canonicalDecimal(dec(t.yearlyCap.toString())) : null, gaps: typeGaps(t) });

export async function listTypes(actor: Actor) {
  await requireDirector(actor.userId, "see claim types");
  return { types: [...(await latestTypes()).values()].map(typeView) };
}

export async function saveType(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "set claim types");
  const parsed = typeSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  if (v.payHead) {
    const head = await prisma.payrollItemVersion.findFirst({ where: { kind: "COMPONENT", key: v.payHead }, orderBy: { version: "desc" } });
    if ((head?.value as { type?: string } | undefined)?.type !== "EARNING") throw new HttpError(400, "A claim is paid under an earning pay head.", "VALIDATION_ERROR");
  }
  const prev = (await latestTypes()).get(v.typeKey);
  const row = await prisma.claimTypeVersion.create({ data: { ...v, version: (prev?.version ?? 0) + 1, setByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.claim_type.saved", entityType: "ClaimType", entityId: v.typeKey, after: { version: row.version, reason: v.reason } });
  return typeView(row);
}

// ── Claims (the person's own) ─────────────────────────────────────────────────────────────────────────────────────────────

export const claimSchema = z.object({ typeKey: z.string().min(2).max(32), spentOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), amount: z.string().regex(MONEY, "Digits with up to two decimals"), description: z.string().trim().min(3).max(300) }).strict();

export async function createClaim(raw: unknown, files: Express.Multer.File[], who: Actor & { employeeId: string }) {
  const parsed = claimSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  const type = (await latestTypes()).get(v.typeKey);
  if (!type) throw new HttpError(400, "No such claim type.", "VALIDATION_ERROR");
  const gaps = typeGaps(type);
  if (gaps.length) throw new HttpError(409, `This claim type is not ready: ${gaps.join(", ")}.`, "TYPE_NOT_SET");
  if (!type.employeesMayClaim) throw new HttpError(403, "This kind of claim cannot be made by employees.", "NOT_CLAIMABLE");
  if (v.spentOn > iso(businessToday())) throw new HttpError(400, "The money cannot have been spent in the future.", "VALIDATION_ERROR");
  if (dec(v.amount).lte(dec("0"))) throw new HttpError(400, "The amount must be more than zero.", "VALIDATION_ERROR");
  if (type.billsRequired && files.length === 0) throw new HttpError(400, "This kind of claim needs a bill.", "BILL_REQUIRED");
  const settings = await getPeopleDocumentsSettings();
  const bills: Array<{ fileKey: string; fileName: string; sha256: string }> = [];
  for (const f of files) {
    const prepared = await prepareDocumentUpload(f, settings);
    const fileKey = `claims/${who.employeeId}/${randomUUID()}${path.extname(prepared.fileName).toLowerCase()}`;
    await storageService.putObject(fileKey, prepared.buffer, prepared.mimeType);
    bills.push({ fileKey, fileName: prepared.fileName.slice(0, 120), sha256: createHash("sha256").update(prepared.buffer).digest("hex") });
  }
  const row = await prisma.reimbursementClaim.create({ data: { employeeId: who.employeeId, typeKey: type.typeKey, typeVersion: type.version, spentOn: day(v.spentOn), amount: v.amount, description: v.description, bills } });
  await writeAuditLog({ actorUserId: who.userId, ipAddress: who.ip ?? null, action: "payroll.claim.created", entityType: "ReimbursementClaim", entityId: row.id, after: { type: type.typeKey, bills: bills.length } });
  return { id: row.id };
}

type ClaimRow = Awaited<ReturnType<typeof prisma.reimbursementClaim.findFirstOrThrow>> & { decision: Awaited<ReturnType<typeof prisma.claimDecision.findFirst>> };

async function views(rows: ClaimRow[]) {
  const adj = await prisma.payrollAdjustment.findMany({ where: { source: "REIMBURSEMENT", sourceRef: { in: rows.map((r) => r.id) } }, include: { consumedByRun: { select: { cycleLabel: true, status: true } } } });
  const byClaim = new Map(adj.map((a) => [a.sourceRef!, a]));
  return rows.map((r) => {
    const a = byClaim.get(r.id);
    const paidIn = a?.status === "CONSUMED" && a.consumedByRun?.status === "FINALISED" ? a.consumedByRun.cycleLabel : null;
    const status = !r.decision ? "SUBMITTED" : r.decision.kind === "APPROVED" ? (paidIn ? "PAID" : "APPROVED") : r.decision.kind;
    return {
      id: r.id,
      employeeId: r.employeeId,
      typeKey: r.typeKey,
      spentOn: iso(r.spentOn),
      amount: canonicalDecimal(dec(r.amount.toString())),
      description: r.description,
      bills: (r.bills as Array<{ fileName: string }>).map((b) => b.fileName),
      status,
      approvedAmount: r.decision?.approvedAmount ? canonicalDecimal(dec(r.decision.approvedAmount.toString())) : null,
      reason: r.decision?.reason ?? null,
      paidIn,
      createdAt: r.createdAt.toISOString(),
    };
  });
}

export async function myClaims(employeeId: string) {
  const rows = await prisma.reimbursementClaim.findMany({ where: { employeeId }, include: { decision: true }, orderBy: { createdAt: "desc" } });
  const types = await latestTypes();
  return { claims: await views(rows), claimable: [...types.values()].filter((t) => t.employeesMayClaim && typeGaps(t).length === 0).map((t) => ({ typeKey: t.typeKey, name: t.name, billsRequired: !!t.billsRequired })) };
}

export async function withdraw(claimId: string, who: Actor & { employeeId: string }) {
  const claim = await prisma.reimbursementClaim.findUnique({ where: { id: claimId }, include: { decision: true } });
  if (!claim || claim.employeeId !== who.employeeId) throw new HttpError(404, "Claim not found.", "NOT_FOUND");
  if (claim.decision) throw new HttpError(409, "This claim has already been decided.", "ALREADY_DECIDED");
  await prisma.claimDecision.create({ data: { claimId, kind: "WITHDRAWN", decidedByUserId: who.userId, reason: "Withdrawn by the person" } });
  await writeAuditLog({ actorUserId: who.userId, ipAddress: who.ip ?? null, action: "payroll.claim.withdrawn", entityType: "ReimbursementClaim", entityId: claimId });
  return { id: claimId, status: "WITHDRAWN" };
}

// ── The directors' queue and decision ──────────────────────────────────────────────────────────────────────────────────────

export async function queue(actor: Actor, status?: "SUBMITTED" | "ALL") {
  await requireDirector(actor.userId, "see reimbursement claims");
  const rows = await prisma.reimbursementClaim.findMany({ where: status === "ALL" ? {} : { decision: null }, include: { decision: true }, orderBy: { createdAt: "asc" }, take: 500 });
  const names = await namesOn([...new Set(rows.map((r) => r.employeeId))], businessToday());
  return { claims: (await views(rows)).map((c) => ({ ...c, name: names.get(c.employeeId) ?? "" })) };
}

/** Pure: whether approving `amount` keeps the person within a cap, given what is already approved in the same period. Exported for tests. */
export function withinCap(cap: Money | null, alreadyApproved: Money, amount: Money): boolean {
  return cap === null || alreadyApproved.plus(amount).lte(cap);
}

export const decisionSchema = z.object({ decision: z.enum(["APPROVE", "REJECT"]), amount: z.string().regex(MONEY).optional(), reason: z.string().trim().max(300).default("") }).strict();

export async function decide(claimId: string, raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "decide a reimbursement claim");
  const parsed = decisionSchema.safeParse(raw);
  if (!parsed.success) throw new HttpError(400, parsed.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  const v = parsed.data;
  const claim = await prisma.reimbursementClaim.findUnique({ where: { id: claimId }, include: { decision: true } });
  if (!claim) throw new HttpError(404, "Claim not found.", "NOT_FOUND");
  const own = await prisma.user.findUnique({ where: { id: actor.userId }, select: { employeeId: true } });
  if (own?.employeeId === claim.employeeId) throw new HttpError(403, "This is your own claim: another director decides it.", "OWN_CLAIM");
  if (claim.decision) throw new HttpError(409, "This claim has already been decided or withdrawn.", "ALREADY_DECIDED");
  if (v.decision === "REJECT") {
    if (v.reason.length < 3) throw new HttpError(400, "Say why it is rejected (the person sees it).", "VALIDATION_ERROR");
    await prisma.claimDecision.create({ data: { claimId, kind: "REJECTED", reason: v.reason, decidedByUserId: actor.userId } });
    await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.claim.rejected", entityType: "ReimbursementClaim", entityId: claimId, after: { reason: v.reason } });
    return { id: claimId, status: "REJECTED" };
  }
  const claimed = dec(claim.amount.toString());
  const amount = v.amount ? dec(v.amount) : claimed;
  if (amount.lte(dec("0")) || amount.gt(claimed)) throw new HttpError(400, "Approve the amount claimed or a lower one.", "VALIDATION_ERROR");
  if (amount.lt(claimed) && v.reason.length < 3) throw new HttpError(400, "Say why a lower amount is approved.", "VALIDATION_ERROR");
  const type = await prisma.claimTypeVersion.findUniqueOrThrow({ where: { typeKey_version: { typeKey: claim.typeKey, version: claim.typeVersion } } });
  // Caps: what is already approved for this person and type in the same month spent, and in the same financial year.
  const spent = iso(claim.spentOn);
  const fy = financialYearOf(spent);
  const approved = await prisma.reimbursementClaim.findMany({ where: { employeeId: claim.employeeId, typeKey: claim.typeKey, decision: { kind: "APPROVED" }, spentOn: { gte: day(fy.start), lte: day(fy.end) } }, include: { decision: true } });
  const sumOf = (rows: typeof approved) => sum(rows.map((r) => dec(r.decision!.approvedAmount!.toString())));
  const monthRows = approved.filter((r) => iso(r.spentOn).slice(0, 7) === spent.slice(0, 7));
  if (!withinCap(type.monthlyCap ? dec(type.monthlyCap.toString()) : null, sumOf(monthRows), amount)) throw new HttpError(409, `This would go over the monthly cap of ${canonicalDecimal(dec(type.monthlyCap!.toString()))} for ${spent.slice(0, 7)}.`, "OVER_CAP");
  if (!withinCap(type.yearlyCap ? dec(type.yearlyCap.toString()) : null, sumOf(approved), amount)) throw new HttpError(409, `This would go over the cap of ${canonicalDecimal(dec(type.yearlyCap!.toString()))} for the financial year ${fy.label}.`, "OVER_CAP");
  await prisma.$transaction(async (tx) => {
    await tx.claimDecision.create({ data: { claimId, kind: "APPROVED", approvedAmount: amount.toFixed(2), reason: v.reason, decidedByUserId: actor.userId } });
    await tx.payrollAdjustment.create({ data: { employeeId: claim.employeeId, componentCode: type.payHead!, direction: "EARNING", amount: amount.toFixed(2), source: "REIMBURSEMENT", sourceRef: claimId, reason: `Reimbursement (${claim.typeKey})`, createdByUserId: actor.userId } });
  });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.claim.approved", entityType: "ReimbursementClaim", entityId: claimId, after: { lower: amount.lt(claimed) } }); // never a figure in the audit row
  return { id: claimId, status: "APPROVED" };
}
