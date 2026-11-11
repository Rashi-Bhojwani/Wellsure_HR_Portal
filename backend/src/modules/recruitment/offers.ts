import { Prisma, type RecruitmentOffer } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { writeAuditLogs } from "../../lib/audit";
import { decryptField, encryptField } from "../../lib/encryption";
import { inForceOn } from "../../lib/effectiveDating";
import { HttpError } from "../../middleware/errorHandler";
import { absent, director, type Actor, type Meta } from "./access";
import { candidateName, retained } from "./candidates";
import { getSetting } from "./settings";
import { noPayReason } from "./offerText";
import { offerContext, requireOfferManage, requirePayDirector, type OfferContext } from "./offerAccess";

// C-4B offers. Non-pay terms are read by the Wellsure Office and the directors (HR onboarding: accepted offers only, for
// joining). Pay lives in recruitment_offer_compensation, encrypted, director-only in the service AND the database trigger.
// Peeps records the offer's state only: the letter that carries salary is issued by a director through the existing letters
// flow, and the director then marks the offer ISSUED here.

export const OFFER_STATES = ["DRAFT", "PROPOSED", "APPROVED", "ISSUED", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"] as const;
export type OfferState = (typeof OFFER_STATES)[number];
export const LIVE_STATES: readonly OfferState[] = ["DRAFT", "PROPOSED", "APPROVED", "ISSUED", "ACCEPTED"];
const EMPLOYMENT_TYPES = ["PERMANENT", "CONTRACT", "INTERN", "CONSULTANT", "PROBATION"] as const;

const noPayText = noPayReason;

export const offerInput = z.object({
  applicationId: z.string().min(1).max(100),
  title: noPayText(150),
  departmentId: z.string().min(1).max(100),
  locationId: z.string().min(1).max(100),
  reportingManagerId: z.string().min(1).max(100).nullable(),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  joiningDate: z.iso.date(),
}).strict();
export const offerListInput = z.object({ state: z.enum(OFFER_STATES).optional(), candidateId: z.string().min(1).max(100).optional() }).strict();
export const transitionInput = z.object({
  to: z.enum(["PROPOSED", "APPROVED", "ISSUED", "ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"]),
  version: z.number().int().min(0),
  reason: noPayText(500).optional(),
  letterSentThroughLetters: z.literal(true).optional(),
  letterReference: z.string().trim().regex(/^[A-Za-z0-9/_-]{1,60}$/, "Use the letter's reference code only.").optional(),
}).strict();
/** Exact decimal as text: never a float. */
export const money = z.string().trim().regex(/^\d{1,12}(\.\d{1,2})?$/, "Enter an amount with at most two decimals.").refine(v => new Prisma.Decimal(v).gt(0), "Enter an amount above zero.");
export const payInput = z.object({ amount: money, period: z.enum(["ANNUAL", "MONTHLY"]), version: z.number().int().min(0) }).strict();
export const expectedPayInput = z.object({ value: z.object({ amount: money, period: z.enum(["ANNUAL", "MONTHLY"]) }).strict().nullable() }).strict();
export type PayValue = { amount: string; period: "ANNUAL" | "MONTHLY"; currency: "INR" };
const sealPay = (amount: string, period: "ANNUAL" | "MONTHLY") => encryptField(JSON.stringify({ amount: new Prisma.Decimal(amount).toFixed(2), period, currency: "INR" } satisfies PayValue));
const openPay = (bytes: Uint8Array | null): PayValue | null => (bytes ? (JSON.parse(decryptField(bytes)) as PayValue) : null);

export function offerWhere(c: OfferContext): Prisma.RecruitmentOfferWhereInput {
  if (c.offerManage) return {};
  if (c.onboarding) return { state: "ACCEPTED" };
  return { id: { in: [] } };
}

async function names(row: RecruitmentOffer) {
  const [department, location, manager] = await Promise.all([
    prisma.department.findUnique({ where: { id: row.departmentId }, select: { id: true, name: true } }),
    prisma.location.findUnique({ where: { id: row.locationId }, select: { id: true, name: true } }),
    row.reportingManagerId ? prisma.employee.findUnique({ where: { id: row.reportingManagerId }, select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } }) : null,
  ]);
  return { department, location, reportingManager: manager ? { id: manager.id, name: manager.nameHistory[0]?.fullName ?? manager.employeeCode } : null };
}

type Loaded = RecruitmentOffer & { candidate: Prisma.CandidateGetPayload<object>; application: { job: { id: string; title: string } }; compensation: { version: number } | null; conversion: { employeeId: string } | null };
const include = { candidate: true, application: { select: { job: { select: { id: true, title: true } } } }, compensation: { select: { version: true } }, conversion: { select: { employeeId: true } } } as const;

/** The non-pay view. `pay` (whether pay is recorded, and its version) is added for directors only. */
async function view(row: Loaded, c: OfferContext, withEvents = false) {
  const events = withEvents ? await prisma.recruitmentOfferEvent.findMany({ where: { offerId: row.id }, orderBy: { version: "asc" }, select: { version: true, kind: true, fromState: true, toState: true, reason: true, letterReference: true, createdAt: true } }) : undefined;
  return {
    id: row.id, applicationId: row.applicationId, candidate: { id: row.candidateId, name: candidateName(row.candidate) }, job: row.application.job,
    title: row.title, ...(await names(row)), employmentType: row.employmentType, joiningDate: row.joiningDate.toISOString().slice(0, 10),
    state: row.state as OfferState, version: row.version, approvalRequired: row.approvalRequired, createdAt: row.createdAt.toISOString(),
    convertedEmployeeId: row.conversion?.employeeId ?? null,
    canManage: c.offerManage, isDirector: c.payDirector,
    ...(c.payDirector ? { pay: { recorded: Boolean(row.compensation), version: row.compensation?.version ?? 0 } } : {}),
    ...(events ? { events: events.map(e => ({ ...e, createdAt: e.createdAt.toISOString() })) } : {}),
  };
}

export async function readOffer(id: string, c: OfferContext) {
  const row = await prisma.recruitmentOffer.findFirst({ where: { id, AND: [offerWhere(c)] }, include });
  if (!row) throw absent();
  return row as Loaded;
}

export async function listOffers(actor: Actor, input: z.infer<typeof offerListInput>) {
  const c = await offerContext(actor);
  if (!c.offerManage && !c.onboarding) throw new HttpError(403, "Offers are unavailable.", "FORBIDDEN");
  const rows = await prisma.recruitmentOffer.findMany({ where: { AND: [offerWhere(c), input.state ? { state: input.state } : {}, input.candidateId ? { candidateId: input.candidateId } : {}] }, include, orderBy: { createdAt: "desc" }, take: 200 });
  return { items: await Promise.all(rows.map(r => view(r as Loaded, c))) };
}

export async function getOffer(id: string, actor: Actor) {
  const c = await offerContext(actor);
  return view(await readOffer(id, c), c, true);
}

async function assertTerms(input: z.infer<typeof offerInput>) {
  const [department, location] = await Promise.all([prisma.department.findUnique({ where: { id: input.departmentId } }), prisma.location.findUnique({ where: { id: input.locationId } })]);
  if (!department || !location) throw new HttpError(400, "Choose an existing department and location.", "VALIDATION_ERROR");
  if (input.reportingManagerId) {
    const m = await prisma.employee.findFirst({ where: { id: input.reportingManagerId, status: "ACTIVE", user: { status: "ACTIVE", roles: { none: { role: { code: "DEVELOPER" } } } } } });
    if (!m) throw new HttpError(400, "Choose an active reporting manager.", "VALIDATION_ERROR");
  }
}

export async function createOffer(actor: Actor, input: z.infer<typeof offerInput>, meta: Meta) {
  const c = await requireOfferManage(actor);
  await assertTerms(input);
  const app = await prisma.recruitmentApplication.findUnique({ where: { id: input.applicationId }, include: { candidate: true } });
  if (!app) throw absent();
  try {
    const id = await prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM candidates WHERE id=${app.candidateId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM applications WHERE id=${app.id} FOR UPDATE`;
      const [candidate, application] = await Promise.all([tx.candidate.findUniqueOrThrow({ where: { id: app.candidateId } }), tx.recruitmentApplication.findUniqueOrThrow({ where: { id: app.id } })]);
      if (!retained(candidate)) throw absent();
      if (application.status !== "ACTIVE") throw new HttpError(409, "Only an active application can receive an offer.", "CONFLICT");
      const live = await tx.recruitmentOffer.findFirst({ where: { applicationId: app.id, state: { in: [...LIVE_STATES] } } });
      if (live) throw new HttpError(409, "This application already has an offer in progress.", "CONFLICT");
      const row = await tx.recruitmentOffer.create({ data: { applicationId: app.id, candidateId: app.candidateId, title: input.title, departmentId: input.departmentId, locationId: input.locationId, reportingManagerId: input.reportingManagerId, employmentType: input.employmentType, joiningDate: new Date(input.joiningDate), createdByUserId: c.userId, changedByUserId: c.userId } });
      await tx.recruitmentOfferEvent.create({ data: { offerId: row.id, version: 0, kind: "CREATED", toState: "DRAFT", actorUserId: c.userId } });
      await writeAuditLogs([{ ...meta, action: "recruitment.offer.created", entityType: "RecruitmentOffer", entityId: row.id, after: { state: "DRAFT" } }], tx);
      return row.id;
    });
    return getOffer(id, actor);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw new HttpError(409, "This application already has an offer in progress.", "CONFLICT");
    throw error;
  }
}

const RESPONSE_STATES: readonly OfferState[] = ["ACCEPTED", "DECLINED", "EXPIRED"];
export async function transition(id: string, actor: Actor, input: z.infer<typeof transitionInput>, meta: Meta) {
  const c = await offerContext(actor);
  if (!c.offerManage) throw new HttpError(403, "Offers are managed by the Wellsure Office and the directors.", "FORBIDDEN");
  const initial = await readOffer(id, c);
  if (["APPROVED", "ISSUED"].includes(input.to) && !c.payDirector) throw new HttpError(403, "Only a director approves or issues an offer.", "FORBIDDEN");
  if (input.to === "WITHDRAWN" && !input.reason) throw new HttpError(400, "Give a reason for withdrawing the offer.", "VALIDATION_ERROR");
  const approval = input.to === "PROPOSED" ? (await getSetting("offerApproval"))?.required === true : null;
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM candidates WHERE id=${initial.candidateId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM recruitment_offers WHERE id=${id} FOR UPDATE`;
    const row = await tx.recruitmentOffer.findUniqueOrThrow({ where: { id }, include: { compensation: { select: { id: true } } } });
    if (row.state === input.to && row.version === input.version + 1) return; // a retried request
    if (row.version !== input.version) throw new HttpError(409, "This offer changed. Reload before continuing.", "CONFLICT");
    if (!retained(await tx.candidate.findUniqueOrThrow({ where: { id: row.candidateId } }))) throw absent();
    const from = row.state as OfferState;
    const allowed =
      (input.to === "PROPOSED" && from === "DRAFT") ||
      (input.to === "APPROVED" && from === "PROPOSED" && row.approvalRequired === true) ||
      (input.to === "ISSUED" && (from === "APPROVED" || (from === "PROPOSED" && row.approvalRequired === false))) ||
      (RESPONSE_STATES.includes(input.to) && from === "ISSUED") ||
      (input.to === "WITHDRAWN" && ["DRAFT", "PROPOSED", "APPROVED", "ISSUED"].includes(from));
    if (!allowed) throw new HttpError(409, `An offer cannot move from ${from} to ${input.to}.`, "CONFLICT");
    if (input.to === "ISSUED") {
      if (!row.compensation) throw new HttpError(409, "Record the offer's pay before issuing it.", "CONFLICT");
      if (input.letterSentThroughLetters !== true) throw new HttpError(400, "Confirm the letter was sent through the letters flow first.", "VALIDATION_ERROR");
    }
    await tx.recruitmentOffer.update({ where: { id }, data: { state: input.to, version: { increment: 1 }, changedByUserId: c.userId, ...(input.to === "PROPOSED" ? { approvalRequired: approval } : {}) } });
    await tx.recruitmentOfferEvent.create({ data: { offerId: id, version: row.version + 1, kind: "STATE", fromState: from, toState: input.to, reason: input.reason ?? null, letterReference: input.to === "ISSUED" ? (input.letterReference ?? null) : null, actorUserId: c.userId } });
    await writeAuditLogs([{ ...meta, action: "recruitment.offer.state", entityType: "RecruitmentOffer", entityId: id, before: { state: from }, after: { state: input.to } }], tx);
  });
  return getOffer(id, actor);
}

// ── Pay: directors only (service + trigger). Every director open is audited, never blocked (D-28). ──
export async function setCompensation(id: string, actor: Actor, input: z.infer<typeof payInput>, meta: Meta) {
  const c = await requirePayDirector(actor);
  const initial = await readOffer(id, c);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM recruitment_offers WHERE id=${id} FOR UPDATE`;
    const row = await tx.recruitmentOffer.findUniqueOrThrow({ where: { id }, include: { compensation: true } });
    if (!["DRAFT", "PROPOSED"].includes(row.state)) throw new HttpError(409, "Pay can change only while the offer is a draft or proposed.", "CONFLICT");
    if (!retained(await tx.candidate.findUniqueOrThrow({ where: { id: initial.candidateId } }))) throw absent();
    if ((row.compensation?.version ?? 0) !== input.version) throw new HttpError(409, "The offer's pay changed. Reload before saving.", "CONFLICT");
    const valueEncrypted = sealPay(input.amount, input.period);
    if (row.compensation) await tx.recruitmentOfferCompensation.update({ where: { offerId: id }, data: { valueEncrypted, version: { increment: 1 }, changedByUserId: c.userId, changedAt: new Date() } });
    else await tx.recruitmentOfferCompensation.create({ data: { offerId: id, valueEncrypted, changedByUserId: c.userId } });
    await tx.recruitmentOffer.update({ where: { id }, data: { version: { increment: 1 }, changedByUserId: c.userId } });
    await tx.recruitmentOfferEvent.create({ data: { offerId: id, version: row.version + 1, kind: "COMPENSATION", fromState: row.state, toState: row.state, actorUserId: c.userId } });
    // The audit row says pay changed, never the figure.
    await writeAuditLogs([{ ...meta, action: "recruitment.offer.compensation.set", entityType: "RecruitmentOffer", entityId: id, after: { payVersion: (row.compensation?.version ?? 0) + 1 } }], tx);
  });
  return getCompensation(id, actor, meta);
}

export async function getCompensation(id: string, actor: Actor, meta: Meta) {
  const c = await requirePayDirector(actor);
  await readOffer(id, c);
  const row = await prisma.recruitmentOfferCompensation.findUnique({ where: { offerId: id } });
  await writeAuditLogs([{ ...meta, action: "recruitment.offer.compensation.opened", entityType: "RecruitmentOffer", entityId: id }]);
  const candidate = await prisma.recruitmentOffer.findUniqueOrThrow({ where: { id }, include: { candidate: true } });
  return { offerId: id, version: row?.version ?? 0, value: retained(candidate.candidate) ? openPay(row?.valueEncrypted ?? null) : null };
}

export async function getExpectedPay(candidateId: string, actor: Actor, meta: Meta) {
  await requirePayDirector(actor);
  const row = await prisma.candidate.findUnique({ where: { id: candidateId } });
  if (!row) throw absent();
  await writeAuditLogs([{ ...meta, action: "recruitment.expected_pay.opened", entityType: "Candidate", entityId: candidateId }]);
  return { candidateId, value: retained(row) ? openPay(row.expectedPayEncrypted) : null };
}

export async function setExpectedPay(candidateId: string, actor: Actor, input: z.infer<typeof expectedPayInput>, meta: Meta) {
  const c = await requirePayDirector(actor);
  await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM candidates WHERE id=${candidateId} FOR UPDATE`;
    const row = await tx.candidate.findUnique({ where: { id: candidateId } });
    if (!row || !retained(row)) throw absent();
    await tx.candidate.update({ where: { id: candidateId }, data: { expectedPayEncrypted: input.value ? sealPay(input.value.amount, input.value.period) : null, expectedPayChangedByUserId: c.userId } });
    await writeAuditLogs([{ ...meta, action: input.value ? "recruitment.expected_pay.set" : "recruitment.expected_pay.cleared", entityType: "Candidate", entityId: candidateId }], tx);
  });
  return getExpectedPay(candidateId, actor, meta);
}

// ── Interface for Session A (payroll). No route, no payroll code here. ──
/**
 * Director-only read of the accepted offer behind a converted employee, for payroll to use later as the starting point of a
 * salary assignment (their decision). It never writes anything to payroll, pay or deductions. Each read is audited.
 * Returns null when the employee did not come through recruitment.
 */
export async function readAcceptedOfferForPayroll(directorUserId: string, employeeId: string, meta: Omit<Meta, "actorUserId"> = {}) {
  await director(directorUserId);
  const conversion = await prisma.recruitmentConversion.findUnique({ where: { employeeId }, include: { offer: { include: { compensation: true } } } });
  if (!conversion || conversion.offer.state !== "ACCEPTED") return null;
  await writeAuditLogs([{ ...meta, actorUserId: directorUserId, action: "recruitment.offer.compensation.opened", entityType: "RecruitmentOffer", entityId: conversion.offerId, after: { purpose: "PAYROLL_READ" } }]);
  return { offerId: conversion.offerId, employeeId, joiningDate: conversion.offer.joiningDate.toISOString().slice(0, 10), employmentType: conversion.offer.employmentType, compensation: openPay(conversion.offer.compensation?.valueEncrypted ?? null) };
}
