import { z } from "zod";
import { writeAuditLog } from "../../../lib/audit";
import { requireDirector } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { MAIN } from "../run/company";
import { seal } from "../sealed";

// Part 3 B2a (docs/plans/A_PART3.md; owner decision 2026-11-13): each company's statutory registrations and bank details for payroll. Nothing is preset (Not set): a
// director enters them with a reason and a different director confirms; the debit account is sealed and shown by its last four. Entries are never changed.

type Actor = { userId: string; ip?: string | null };
const code = z.string().trim().min(1).max(40).regex(/^[A-Za-z0-9/-]+$/, "Letters, digits, / and - only").optional();
export const REGISTRATION_FIELDS = ["pfEstablishmentCode", "esiEmployerCode", "ptRegistration", "lwfRegistration", "tan"] as const;
export const entrySchema = z
  .object({
    companyKey: z.string().min(1).max(64),
    registrations: z.object({ pfEstablishmentCode: code, esiEmployerCode: code, ptRegistration: code, lwfRegistration: code, tan: code }).strict(),
    debitAccount: z.string().trim().regex(/^[0-9]{6,20}$/, "6 to 20 digits").optional(),
    reason: z.string().trim().min(3).max(300),
  })
  .strict();

async function companies() {
  const entities = await prisma.legalEntity.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return [{ key: MAIN, name: "Main company" }, ...entities.map((e) => ({ key: e.id, name: e.name }))];
}

export async function list(actor: Actor) {
  await requireDirector(actor.userId, "see company payroll settings");
  const rows = await prisma.payrollCompanySetting.findMany({ orderBy: { createdAt: "asc" }, include: { confirmation: true } });
  return {
    companies: (await companies()).map((c) => {
      const mine = rows.filter((r) => r.companyKey === c.key);
      const confirmed = [...mine].reverse().find((r) => r.confirmation);
      const pending = mine.filter((r) => !r.confirmation && (!confirmed || r.createdAt > confirmed.createdAt)).pop();
      const view = (r: (typeof mine)[number]) => ({ id: r.id, registrations: r.registrations as Record<string, string | undefined>, debitAccount: r.debitAccountLast4 ? `…${r.debitAccountLast4}` : null, reason: r.reason, enteredByMe: r.enteredByUserId === actor.userId, at: r.createdAt.toISOString() });
      return { ...c, inForce: confirmed ? view(confirmed) : null, waiting: pending ? view(pending) : null };
    }),
    note: "Not set until a director enters them and a different director confirms. Bank and statutory files for another company are not made yet.",
  };
}

export async function enter(raw: unknown, actor: Actor) {
  await requireDirector(actor.userId, "enter company payroll settings");
  const p = entrySchema.safeParse(raw);
  if (!p.success) throw new HttpError(400, p.error.issues.map((i) => i.message).join("; "), "VALIDATION_ERROR");
  if (!(await companies()).some((c) => c.key === p.data.companyKey)) throw new HttpError(404, "No such company.", "NOT_FOUND");
  const row = await prisma.payrollCompanySetting.create({
    data: { companyKey: p.data.companyKey, registrations: p.data.registrations, debitAccount: p.data.debitAccount ? (seal(p.data.debitAccount) as unknown as object) : undefined, debitAccountLast4: p.data.debitAccount ? p.data.debitAccount.slice(-4) : null, reason: p.data.reason, enteredByUserId: actor.userId },
  });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.company_settings.entered", entityType: "PayrollCompanySetting", entityId: row.id, after: { companyKey: p.data.companyKey, fields: Object.keys(p.data.registrations), debitAccount: !!p.data.debitAccount } }); // no value
  return { id: row.id };
}

export async function confirm(id: string, actor: Actor) {
  await requireDirector(actor.userId, "confirm company payroll settings");
  const row = await prisma.payrollCompanySetting.findUnique({ where: { id }, include: { confirmation: true } });
  if (!row) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (row.confirmation) throw new HttpError(409, "Already confirmed.", "ALREADY_CONFIRMED");
  if (row.enteredByUserId === actor.userId) throw new HttpError(403, "You entered these, so a different director confirms them.", "CHECKER_IS_MAKER");
  await prisma.payrollCompanySettingConfirmation.create({ data: { settingId: id, confirmedByUserId: actor.userId } });
  await writeAuditLog({ actorUserId: actor.userId, ipAddress: actor.ip ?? null, action: "payroll.company_settings.confirmed", entityType: "PayrollCompanySetting", entityId: id, after: { companyKey: row.companyKey } });
  return { id, confirmed: true };
}
