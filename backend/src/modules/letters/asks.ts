import { prisma } from "../../lib/prisma";
import { writeAuditLog } from "../../lib/audit";
import { activeDirectors } from "../../lib/directorAuthority";
import { inForceOn } from "../../lib/effectiveDating";
import { HttpError } from "../../middleware/errorHandler";
import { behaviourValue } from "../behaviours/service";
import { findScopedEmployee } from "../employee/service";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { assertMayAct } from "./workflow";
import type { ActorMeta, LetterViewer } from "./service";

// LT-08 (M session): an employee asks for a letter (for example an address proof). Only from the templates the directors listed (the behaviour
// `letters.employeeMayAsk`, empty by default: nobody can ask until a director lists a template). An ask is only a request: the letter itself is
// prepared and issued through the existing workflow, by whoever may prepare that template (a director, or a person holding the template's grant).
// The ask is then marked done (naming the letter request) or declined with a reason; the employee is told either way.

const name = (e: { employeeCode: string; nameHistory: { fullName: string }[] }) => e.nameHistory[0]?.fullName ?? e.employeeCode;

async function askableTemplates() {
  const codes = (await behaviourValue("letters.employeeMayAsk")).value as string[];
  if (!codes.length) return [];
  return prisma.letterTemplate.findMany({ where: { code: { in: codes }, isActive: true }, orderBy: { name: "asc" }, select: { id: true, code: true, name: true, description: true } });
}

/** The templates the signed-in employee may ask for. */
export async function askOptions() {
  return askableTemplates();
}

export async function myAsks(employeeId: string) {
  const rows = await prisma.letterAsk.findMany({ where: { employeeId }, include: { template: { select: { name: true } } }, orderBy: { createdAt: "desc" }, take: 100 });
  return rows.map((r) => ({ id: r.id, template: r.template.name, purpose: r.purpose, status: r.status, note: r.note, createdAt: r.createdAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null }));
}

export async function ask(employeeId: string, input: { templateCode: string; purpose: string }, meta: ActorMeta) {
  const template = (await askableTemplates()).find((t) => t.code === input.templateCode);
  if (!template) throw new HttpError(400, "This letter cannot be asked for. Choose one from the list.", "NOT_ASKABLE");
  if (await prisma.letterAsk.findFirst({ where: { employeeId, templateId: template.id, status: "ASKED" }, select: { id: true } })) {
    throw new HttpError(409, "You have already asked for this letter; it is waiting.", "ALREADY_ASKED");
  }
  const row = await prisma.letterAsk.create({ data: { employeeId, templateId: template.id, purpose: input.purpose } });
  await writeAuditLog({ ...meta, action: "letters.ask.created", entityType: "LetterAsk", entityId: row.id, after: { template: template.code } });
  await tellPreparers(template.id, template.name, row.id);
  return { id: row.id, status: row.status };
}

export async function withdraw(id: string, employeeId: string, meta: ActorMeta) {
  const row = await prisma.letterAsk.findUnique({ where: { id } });
  if (!row || row.employeeId !== employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  if (row.status !== "ASKED") throw new HttpError(409, "This is already decided.", "ALREADY_DECIDED");
  await prisma.letterAsk.update({ where: { id }, data: { status: "WITHDRAWN", decidedAt: new Date(), decidedByUserId: meta.actorUserId } });
  await writeAuditLog({ ...meta, action: "letters.ask.withdrawn", entityType: "LetterAsk", entityId: id });
  return { id, status: "WITHDRAWN" as const };
}

/** Asks this person may act on: for a template they may prepare, about someone in their data scope, never their own. */
export async function listForPreparer(viewer: LetterViewer, status: "ASKED" | "DONE" | "DECLINED" | "WITHDRAWN") {
  const rows = await prisma.letterAsk.findMany({
    where: { status, employeeId: { not: viewer.employeeId } },
    include: { template: { select: { id: true, code: true, name: true } }, employee: { select: { id: true, employeeCode: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  const mayPrepare = new Map<string, boolean>();
  const out = [];
  for (const r of rows) {
    if (!mayPrepare.has(r.templateId)) mayPrepare.set(r.templateId, await assertMayAct(r.templateId, "PREPARE", viewer).then(() => true, () => false));
    if (!mayPrepare.get(r.templateId)) continue;
    const inScope = await findScopedEmployee(r.employeeId, viewer.employeeId, viewer.dataScope).then(() => true, () => false);
    if (!inScope) continue;
    const candidates = r.status === "ASKED" ? await prisma.letterRequest.findMany({ where: { employeeId: r.employeeId, templateId: r.templateId, status: { not: "VOID" } }, select: { id: true, status: true, serial: true, preparedAt: true }, orderBy: { preparedAt: "desc" }, take: 10 }) : [];
    out.push({
      id: r.id,
      candidates: candidates.map((c) => ({ id: c.id, status: c.status, serial: c.serial, preparedAt: c.preparedAt.toISOString() })),
      template: { id: r.template.id, code: r.template.code, name: r.template.name },
      employee: { id: r.employee.id, employeeCode: r.employee.employeeCode, fullName: name(r.employee) },
      purpose: r.purpose,
      status: r.status,
      note: r.note,
      letterRequestId: r.letterRequestId,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    });
  }
  return out;
}

async function loadForPreparer(id: string, viewer: LetterViewer) {
  const row = await prisma.letterAsk.findUnique({ where: { id }, include: { template: { select: { name: true } } } });
  if (!row || row.employeeId === viewer.employeeId) throw new HttpError(404, "Not found.", "NOT_FOUND");
  await findScopedEmployee(row.employeeId, viewer.employeeId, viewer.dataScope).catch(() => {
    throw new HttpError(404, "Not found.", "NOT_FOUND");
  });
  await assertMayAct(row.templateId, "PREPARE", viewer);
  if (row.status !== "ASKED") throw new HttpError(409, "This is already decided.", "ALREADY_DECIDED");
  return row;
}

/** Done: a letter request for the same person and template exists (prepared through the workflow). */
export async function markDone(id: string, letterRequestId: string, viewer: LetterViewer, meta: ActorMeta) {
  const row = await loadForPreparer(id, viewer);
  const lr = await prisma.letterRequest.findUnique({ where: { id: letterRequestId }, select: { employeeId: true, templateId: true, status: true } });
  if (!lr || lr.employeeId !== row.employeeId || lr.templateId !== row.templateId || lr.status === "VOID") {
    throw new HttpError(400, "Name a letter for this person from this template (prepared under Letters).", "LETTER_MISMATCH");
  }
  await prisma.letterAsk.update({ where: { id }, data: { status: "DONE", letterRequestId, decidedByUserId: meta.actorUserId, decidedAt: new Date() } });
  await writeAuditLog({ ...meta, action: "letters.ask.done", entityType: "LetterAsk", entityId: id, after: { letterRequestId } });
  await notifyEmployee(row.employeeId, { type: "letters.ask.done", title: `Your ${row.template.name} is being prepared`, body: "It appears in your Document Center when it is issued.", link: "/app/document-center" });
  return { id, status: "DONE" as const };
}

export async function decline(id: string, reason: string, viewer: LetterViewer, meta: ActorMeta) {
  const row = await loadForPreparer(id, viewer);
  await prisma.letterAsk.update({ where: { id }, data: { status: "DECLINED", note: reason, decidedByUserId: meta.actorUserId, decidedAt: new Date() } });
  await writeAuditLog({ ...meta, action: "letters.ask.declined", entityType: "LetterAsk", entityId: id, after: { reason } });
  await notifyEmployee(row.employeeId, { type: "letters.ask.declined", title: `Your request for a ${row.template.name} was declined`, body: reason, link: "/app/document-center" });
  return { id, status: "DECLINED" as const };
}

/** The directors and the holders of a live PREPARE grant on the template are told a new ask waits. */
async function tellPreparers(templateId: string, templateName: string, askId: string) {
  const grants = await prisma.letterTemplateGrant.findMany({ where: { templateId, action: "PREPARE", revokedAt: null }, select: { userId: true, roleCode: true } });
  const roleCodes = grants.map((g) => g.roleCode).filter((x): x is string => !!x);
  const viaRole = roleCodes.length ? await prisma.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: { in: roleCodes } } } } }, select: { employeeId: true } }) : [];
  const viaUser = await prisma.user.findMany({ where: { id: { in: grants.map((g) => g.userId).filter((x): x is string => !!x) }, status: "ACTIVE" }, select: { employeeId: true } });
  const targets = new Set([...(await activeDirectors()).map((d) => d.employeeId), ...viaRole.map((u) => u.employeeId), ...viaUser.map((u) => u.employeeId)]);
  for (const employeeId of targets) {
    await notifyEmployee(employeeId, { type: "letters.ask.created", title: `Someone asked for a ${templateName}`, body: "Open Employee → Letters to prepare it or decline it.", link: "/admin/employee/letters", payload: { askId } });
  }
}
