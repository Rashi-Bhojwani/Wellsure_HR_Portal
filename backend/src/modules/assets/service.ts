import { Prisma } from "@prisma/client";
import { formatAssetId, myAssetsPath, type AssetEventKind } from "@shared/constants/assets";
import { writeAuditLogs } from "../../lib/audit";
import { buildEmployeeScopeWhere } from "../../lib/dataScope";
import { inForceOn } from "../../lib/effectiveDating";
import { prisma } from "../../lib/prisma";
import { HttpError } from "../../middleware/errorHandler";
import { getSocketServer, permissionRoom } from "../../realtime/emit";
import { notifyEmployee } from "../notifications/notifyEmployee";
import { assertReady, loadInForce, type InForceLists } from "./settings";
import { PEEPS_REQUIRED } from "@shared/constants/peeps";
import { businessToday } from "../../lib/businessDate";
import { assertSettings, getSetting as getPeepsSetting } from "../peeps/settings";
import type { ActorMeta, AssetDetail, AssetSummary, AssetViewer, AssignmentView, AssetEventView, HolderRef, MyAssetView, PersonRef } from "./types";

// The asset register (docs/plans/PEEPS_PLAN.md §B.2, Peeps module 1).
//
//   - An asset has at most one open assignment. Two guards, each enough alone: every action that touches assignments locks the asset row first
//     (SELECT … FOR UPDATE), and the partial unique index asset_assignments_one_open refuses a second open row whatever the code does (a race that
//     slips past the lock becomes a 409, never a duplicate).
//   - Every action writes an append-only asset_events row and an audit_logs row in the same transaction, then notifies the holder.
//   - Scope: the register's routes need assets.view / assets.manage, and a viewer whose data scope is not ALL only sees assets held by people in their
//     scope (and can only issue or transfer to them). Holders outside the scope are never named.
//   - No money, no deduction: a loss or damage is recorded as an event only (recovery is Session A's — see PEEPS_STAGE_REPORTS.md).

type Tx = Prisma.TransactionClient;

const personInclude = { select: { id: true, employeeCode: true, status: true, nameHistory: { where: inForceOn(), select: { fullName: true } } } } as const;
type PersonRow = { id: string; employeeCode: string; nameHistory: { fullName: string }[] };
const person = (e: PersonRow): PersonRef => ({ employeeId: e.id, employeeCode: e.employeeCode, name: e.nameHistory[0]?.fullName ?? e.employeeCode });

const OPEN = { endedAt: null } as const;

async function scopedEmployeeIds(viewer: AssetViewer): Promise<Set<string> | null> {
  if (viewer.dataScope === "ALL") return null;
  const where = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  return new Set((await prisma.employee.findMany({ where, select: { id: true } })).map((e) => e.id));
}
const holderRef = (e: PersonRow, scope: Set<string> | null): HolderRef => (scope === null || scope.has(e.id) ? person(e) : { hidden: true });

function lockAsset(tx: Tx, assetId: string): Promise<Array<{ id: string }>> {
  return tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM assets WHERE id = ${assetId} FOR UPDATE`;
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
function rethrowOneOpen(err: unknown): never {
  if (isUniqueViolation(err)) throw new HttpError(409, "This asset is already issued to someone. Return or transfer it first.", "ASSET_ALREADY_ISSUED");
  throw err;
}

function notifyRegister(assetId: string): void {
  // Signal only (no asset content on a socket): open register screens refetch.
  getSocketServer()?.to(permissionRoom("assets.view")).emit("assets.changed", { assetId });
}

function requireCode(list: { code: string }[], code: string, what: string): void {
  if (!list.some((i) => i.code === code)) throw new HttpError(400, `${code} is not one of the confirmed ${what}.`, "VALIDATION_ERROR");
}
const isIssuable = (lists: InForceLists, statusCode: string) => lists.statuses.some((s) => s.code === statusCode && s.issuable);

async function activeEmployeeInScope(tx: Tx, employeeId: string, viewer: AssetViewer): Promise<PersonRow> {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const e = await tx.employee.findFirst({ where: { AND: [{ id: employeeId }, scope] }, ...personInclude });
  if (!e) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  if (e.status !== "ACTIVE") throw new HttpError(409, "Assets can only be issued to an active employee.", "EMPLOYEE_NOT_ACTIVE");
  return e;
}

/** An asset the viewer may act on: it exists, and (outside ALL scope) its current holder is in scope. 404 otherwise, so out-of-scope assets look absent. */
async function loadAssetForViewer(id: string, scope: Set<string> | null) {
  const asset = await prisma.asset.findUnique({ where: { id }, include: { assignments: { where: OPEN, include: { employee: personInclude } } } });
  if (!asset) throw new HttpError(404, "Asset not found.", "NOT_FOUND");
  const holder = asset.assignments[0]?.employee;
  if (scope !== null && (!holder || !scope.has(holder.id))) throw new HttpError(404, "Asset not found.", "NOT_FOUND");
  return asset;
}

interface EventInput {
  assetId: string;
  kind: AssetEventKind;
  assignmentId?: string | null;
  employeeId?: string | null;
  conditionCode?: string | null;
  statusCode?: string | null;
  note?: string | null;
  details?: Prisma.InputJsonValue;
}
async function record(tx: Tx, meta: ActorMeta, ev: EventInput, audit: { before?: unknown; after?: unknown } = {}): Promise<void> {
  const row = await tx.assetEvent.create({ data: { ...ev, actorUserId: meta.actorUserId } });
  await writeAuditLogs([{ ...meta, action: `assets.${ev.kind.toLowerCase()}`, entityType: "Asset", entityId: ev.assetId, before: audit.before, after: { eventId: row.id, ...ev, ...(audit.after as object | undefined) } }], tx);
}

function summary(
  a: Prisma.AssetGetPayload<{ include: { assignments: { include: { employee: typeof personInclude } } } }>,
  lists: InForceLists,
  scope: Set<string> | null,
): AssetSummary {
  const open = a.assignments.find((x) => x.endedAt === null) ?? null;
  return {
    id: a.id,
    assetId: formatAssetId(a.number),
    name: a.name,
    category: { code: a.categoryCode, label: lists.label("CATEGORIES", a.categoryCode)! },
    status: { code: a.statusCode, label: lists.label("STATUSES", a.statusCode)!, issuable: isIssuable(lists, a.statusCode) },
    serialNumber: a.serialNumber,
    model: a.model,
    holder: open ? holderRef(open.employee, scope) : null,
    openAssignmentId: open?.id ?? null,
    acknowledged: open ? open.acknowledgedAt !== null : null,
    updatedAt: a.updatedAt.toISOString(),
  };
}

// ── Reading ────────────────────────────────────────────────────────────────

export async function listAssets(
  viewer: AssetViewer,
  q: { q?: string; categoryCode?: string; statusCode?: string; holder: "any" | "assigned" | "unassigned"; page: number; pageSize: number },
): Promise<{ total: number; items: AssetSummary[]; ready: boolean; missing: string[] }> {
  const [lists, scope] = await Promise.all([loadInForce(), scopedEmployeeIds(viewer)]);
  const and: Prisma.AssetWhereInput[] = [];
  if (q.categoryCode) and.push({ categoryCode: q.categoryCode });
  if (q.statusCode) and.push({ statusCode: q.statusCode });
  if (q.holder === "assigned") and.push({ assignments: { some: OPEN } });
  if (q.holder === "unassigned") and.push({ assignments: { none: OPEN } });
  if (scope !== null) and.push({ assignments: { some: { ...OPEN, employeeId: { in: [...scope] } } } });
  if (q.q) {
    const n = Number(q.q.replace(/^AST-?/i, ""));
    and.push({
      OR: [
        { name: { contains: q.q, mode: "insensitive" } },
        { serialNumber: { contains: q.q, mode: "insensitive" } },
        { model: { contains: q.q, mode: "insensitive" } },
        ...(Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? [{ number: n }] : []),
        // A holder's name or code, but only among people the viewer may see.
        {
          assignments: {
            some: {
              ...OPEN,
              ...(scope !== null ? { employeeId: { in: [...scope] } } : {}),
              employee: { OR: [{ employeeCode: { contains: q.q, mode: "insensitive" } }, { nameHistory: { some: { ...inForceOn(), fullName: { contains: q.q, mode: "insensitive" } } } }] },
            },
          },
        },
      ],
    });
  }
  const where: Prisma.AssetWhereInput = { AND: and };
  const [total, rows] = await Promise.all([
    prisma.asset.count({ where }),
    prisma.asset.findMany({ where, orderBy: { number: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { assignments: { where: OPEN, include: { employee: personInclude } } } }),
  ]);
  return { total, items: rows.map((r) => summary(r, lists, scope)), ready: lists.ready, missing: lists.missing };
}

export async function getAsset(id: string, viewer: AssetViewer): Promise<AssetDetail> {
  const [lists, scope] = await Promise.all([loadInForce(), scopedEmployeeIds(viewer)]);
  await loadAssetForViewer(id, scope);
  const a = await prisma.asset.findUniqueOrThrow({
    where: { id },
    include: { assignments: { orderBy: { issuedAt: "desc" }, include: { employee: personInclude } }, events: { orderBy: [{ at: "desc" }, { id: "desc" }] } },
  });
  const eventPeople = await prisma.employee.findMany({ where: { id: { in: a.events.map((e) => e.employeeId).filter((x): x is string => Boolean(x)) } }, ...personInclude });
  const peopleById = new Map(eventPeople.map((p) => [p.id, p]));
  const actors = await prisma.user.findMany({ where: { id: { in: [...new Set(a.events.map((e) => e.actorUserId))] } }, select: { id: true, employee: personInclude } });
  const actorName = new Map(actors.map((u) => [u.id, person(u.employee).name]));
  const assignments: AssignmentView[] = a.assignments.map((x) => ({
    id: x.id,
    holder: holderRef(x.employee, scope),
    issuedAt: x.issuedAt.toISOString(),
    issueCondition: { code: x.issueConditionCode, label: lists.label("CONDITIONS", x.issueConditionCode)! },
    issueNote: x.issueNote,
    acknowledgedAt: x.acknowledgedAt?.toISOString() ?? null,
    endedAt: x.endedAt?.toISOString() ?? null,
    endReason: x.endReason,
    returnCondition: x.returnConditionCode ? { code: x.returnConditionCode, label: lists.label("CONDITIONS", x.returnConditionCode)! } : null,
    endNote: x.endNote,
  }));
  const events: AssetEventView[] = a.events.map((e) => {
    const p = e.employeeId ? peopleById.get(e.employeeId) : undefined;
    return {
      id: e.id,
      kind: e.kind,
      at: e.at.toISOString(),
      actorName: actorName.get(e.actorUserId) ?? null,
      holder: p ? holderRef(p, scope) : null,
      condition: e.conditionCode ? { code: e.conditionCode, label: lists.label("CONDITIONS", e.conditionCode)! } : null,
      status: e.statusCode ? { code: e.statusCode, label: lists.label("STATUSES", e.statusCode)! } : null,
      note: e.note,
    };
  });
  return { ...summary({ ...a, assignments: a.assignments }, lists, scope), notes: a.notes, createdAt: a.createdAt.toISOString(), assignments, events };
}

/** Another employee's assets (their profile, and later their exit checklist): assets.view and the viewer's data scope. */
export async function listEmployeeAssets(employeeId: string, viewer: AssetViewer): Promise<{ current: AssetSummary[]; past: AssignmentView[] }> {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const employee = await prisma.employee.findFirst({ where: { AND: [{ id: employeeId }, scope] }, select: { id: true } });
  if (!employee) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const [lists, scopeIds] = await Promise.all([loadInForce(), scopedEmployeeIds(viewer)]);
  const rows = await prisma.assetAssignment.findMany({ where: { employeeId }, orderBy: { issuedAt: "desc" }, include: { employee: personInclude, asset: { include: { assignments: { where: OPEN, include: { employee: personInclude } } } } } });
  return {
    current: rows.filter((r) => r.endedAt === null).map((r) => summary(r.asset, lists, scopeIds)),
    past: rows
      .filter((r) => r.endedAt !== null)
      .map((x) => ({
        id: x.id,
        holder: holderRef(x.employee, scopeIds),
        issuedAt: x.issuedAt.toISOString(),
        issueCondition: { code: x.issueConditionCode, label: lists.label("CONDITIONS", x.issueConditionCode)! },
        issueNote: x.issueNote,
        acknowledgedAt: x.acknowledgedAt?.toISOString() ?? null,
        endedAt: x.endedAt!.toISOString(),
        endReason: x.endReason,
        returnCondition: x.returnConditionCode ? { code: x.returnConditionCode, label: lists.label("CONDITIONS", x.returnConditionCode)! } : null,
        endNote: x.endNote,
      })),
  };
}

/** People an asset can be issued or transferred to: active, in the viewer's data scope, matching the search. */
export async function searchHolders(viewer: AssetViewer, q: string): Promise<PersonRef[]> {
  const scope = await buildEmployeeScopeWhere(viewer.employeeId, viewer.dataScope);
  const rows = await prisma.employee.findMany({
    where: {
      AND: [
        scope,
        { status: "ACTIVE" },
        q ? { OR: [{ employeeCode: { contains: q, mode: "insensitive" } }, { nameHistory: { some: { ...inForceOn(), fullName: { contains: q, mode: "insensitive" } } } }] } : {},
      ],
    },
    orderBy: { employeeCode: "asc" },
    take: 20,
    ...personInclude,
  });
  return rows.map(person);
}

/** The caller's own assets — open first, then the history. Self only; no permission key. */
export async function listMine(viewer: AssetViewer): Promise<{ current: MyAssetView[]; past: MyAssetView[] }> {
  const lists = await loadInForce();
  const rows = await prisma.assetAssignment.findMany({ where: { employeeId: viewer.employeeId }, orderBy: { issuedAt: "desc" }, include: { asset: true } });
  const view = (r: (typeof rows)[number]): MyAssetView => ({
    assignmentId: r.id,
    assetId: formatAssetId(r.asset.number),
    name: r.asset.name,
    category: lists.label("CATEGORIES", r.asset.categoryCode)!,
    serialNumber: r.asset.serialNumber,
    model: r.asset.model,
    issuedAt: r.issuedAt.toISOString(),
    issueCondition: lists.label("CONDITIONS", r.issueConditionCode)!,
    acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    endReason: r.endReason,
  });
  return { current: rows.filter((r) => r.endedAt === null).map(view), past: rows.filter((r) => r.endedAt !== null).map(view) };
}

// ── HR at onboarding (Q-14) ─────────────────────────────────────────────────
// HR does not see the register. It may issue an asset only to a new joiner, only while the directors' asset audience setting says HR may, and only once
// "who counts as a new joiner" is set: until both are confirmed, issuing refuses.

async function assertOnboardingOpen(): Promise<number> {
  await assertSettings(PEEPS_REQUIRED["assets.hrOnboarding"], "Issuing assets at onboarding");
  const audience = await getPeepsSetting<{ hrOnboardingIssue: boolean }>("audience.assets");
  if (!audience?.hrOnboardingIssue) throw new HttpError(403, "The directors have not allowed HR to issue assets at onboarding.", "FORBIDDEN");
  return (await getPeepsSetting<number>("assets.newJoinerWindowDays"))!;
}

/** What HR may hand to a new joiner: assets nobody holds whose status allows issuing. Name, ID and category only; no holders, no history. */
export async function onboardingAvailable(): Promise<Array<{ id: string; assetId: string; name: string; category: string; serialNumber: string | null }>> {
  await assertOnboardingOpen();
  const lists = await loadInForce();
  assertReady(lists);
  const issuable = lists.statuses.filter((s) => s.issuable).map((s) => s.code);
  const rows = await prisma.asset.findMany({ where: { statusCode: { in: issuable }, assignments: { none: OPEN } }, orderBy: { number: "asc" }, take: 500 });
  return rows.map((a) => ({ id: a.id, assetId: formatAssetId(a.number), name: a.name, category: lists.label("CATEGORIES", a.categoryCode)!, serialNumber: a.serialNumber }));
}

export async function issueAtOnboarding(id: string, input: { employeeId: string; conditionCode: string; note?: string }, viewer: AssetViewer, meta: ActorMeta): Promise<{ assetId: string; issued: true }> {
  const windowDays = await assertOnboardingOpen();
  const joiner = await prisma.employee.findUnique({ where: { id: input.employeeId }, select: { dateOfJoining: true, status: true } });
  if (!joiner) throw new HttpError(404, "Employee not found.", "NOT_FOUND");
  const earliest = new Date(businessToday().getTime() - windowDays * 86_400_000);
  if (joiner.dateOfJoining < earliest) throw new HttpError(403, `Only a new joiner (joined within the last ${windowDays} days) can be issued an asset at onboarding.`, "NOT_A_NEW_JOINER");
  const done = await issueAsset(id, input, { ...viewer, dataScope: "ALL" }, meta);
  return { assetId: done.assetId, issued: true };
}

// ── Changing ───────────────────────────────────────────────────────────────

const notify = (employeeId: string, title: string, body: string, kind: string, assetId: string) =>
  notifyEmployee(employeeId, { type: `assets.${kind}`, title, body, link: myAssetsPath, payload: { assetId } });

export async function createAsset(
  input: { name: string; categoryCode: string; statusCode: string; serialNumber?: string | null; model?: string | null; notes?: string | null },
  viewer: AssetViewer,
  meta: ActorMeta,
): Promise<AssetDetail> {
  const lists = await loadInForce();
  assertReady(lists);
  requireCode(lists.categories, input.categoryCode, "categories");
  requireCode(lists.statuses, input.statusCode, "statuses");
  const asset = await prisma.$transaction(async (tx) => {
    const row = await tx.asset.create({
      data: { name: input.name, categoryCode: input.categoryCode, statusCode: input.statusCode, serialNumber: input.serialNumber ?? null, model: input.model ?? null, notes: input.notes ?? null, createdByUserId: meta.actorUserId },
    });
    await record(tx, meta, { assetId: row.id, kind: "CREATED", statusCode: row.statusCode, details: { name: row.name, categoryCode: row.categoryCode } });
    return row;
  });
  notifyRegister(asset.id);
  // A new asset has no holder yet; a viewer outside ALL scope could not open it, so answer with the register entry as everyone with ALL scope sees it.
  return getAsset(asset.id, { ...viewer, dataScope: "ALL" });
}

const EDITABLE = ["name", "categoryCode", "statusCode", "serialNumber", "model", "notes"] as const;

export async function updateAsset(
  id: string,
  input: Partial<Record<(typeof EDITABLE)[number], string | null>>,
  viewer: AssetViewer,
  meta: ActorMeta,
): Promise<AssetDetail> {
  const lists = await loadInForce();
  assertReady(lists);
  if (input.categoryCode) requireCode(lists.categories, input.categoryCode, "categories");
  if (input.statusCode) requireCode(lists.statuses, input.statusCode, "statuses");
  await loadAssetForViewer(id, await scopedEmployeeIds(viewer));
  await prisma.$transaction(async (tx) => {
    await lockAsset(tx, id);
    const before = await tx.asset.findUniqueOrThrow({ where: { id } });
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of EDITABLE) if (input[k] !== undefined && input[k] !== before[k]) changes[k] = { from: before[k], to: input[k] };
    if (Object.keys(changes).length === 0) return;
    await tx.asset.update({ where: { id }, data: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to])) });
    await record(tx, meta, { assetId: id, kind: "EDITED", statusCode: input.statusCode ?? null, details: changes as Prisma.InputJsonValue });
  });
  notifyRegister(id);
  return getAsset(id, viewer);
}

export async function issueAsset(id: string, input: { employeeId: string; conditionCode: string; note?: string }, viewer: AssetViewer, meta: ActorMeta): Promise<AssetDetail> {
  const lists = await loadInForce();
  assertReady(lists);
  requireCode(lists.conditions, input.conditionCode, "conditions");
  const holder = await prisma
    .$transaction(async (tx) => {
      if ((await lockAsset(tx, id)).length === 0) throw new HttpError(404, "Asset not found.", "NOT_FOUND");
      const asset = await tx.asset.findUniqueOrThrow({ where: { id } });
      if (await tx.assetAssignment.findFirst({ where: { assetId: id, ...OPEN }, select: { id: true } })) {
        throw new HttpError(409, "This asset is already issued to someone. Return or transfer it first.", "ASSET_ALREADY_ISSUED");
      }
      if (!isIssuable(lists, asset.statusCode)) throw new HttpError(409, `An asset whose status is "${lists.label("STATUSES", asset.statusCode)}" cannot be issued.`, "ASSET_NOT_ISSUABLE");
      const employee = await activeEmployeeInScope(tx, input.employeeId, viewer);
      const assignment = await tx.assetAssignment.create({
        data: { assetId: id, employeeId: employee.id, issuedByUserId: meta.actorUserId, issueConditionCode: input.conditionCode, issueNote: input.note ?? null },
      });
      await record(tx, meta, { assetId: id, kind: "ISSUED", assignmentId: assignment.id, employeeId: employee.id, conditionCode: input.conditionCode, note: input.note ?? null });
      return { employee, asset };
    })
    .catch(rethrowOneOpen);
  await notify(holder.employee.id, "An asset has been issued to you", `${holder.asset.name} (${formatAssetId(holder.asset.number)}). Please acknowledge that you have received it.`, "issued", id);
  notifyRegister(id);
  return getAsset(id, viewer);
}

/**
 * Taking an asset back. Idempotent on the assignment: returning an assignment that is already RETURNED changes nothing and answers with the asset as it
 * is (a double click, a retried request). Returning one that ended another way (transferred, lost) is a conflict.
 */
export async function returnAsset(
  id: string,
  input: { assignmentId: string; conditionCode: string; statusCode?: string; note?: string },
  viewer: AssetViewer,
  meta: ActorMeta,
): Promise<AssetDetail & { alreadyReturned: boolean }> {
  const lists = await loadInForce();
  assertReady(lists);
  requireCode(lists.conditions, input.conditionCode, "conditions");
  if (input.statusCode) requireCode(lists.statuses, input.statusCode, "statuses");
  const scope = await scopedEmployeeIds(viewer);
  const result = await prisma.$transaction(async (tx) => {
    if ((await lockAsset(tx, id)).length === 0) throw new HttpError(404, "Asset not found.", "NOT_FOUND");
    const assignment = await tx.assetAssignment.findFirst({ where: { id: input.assignmentId, assetId: id }, include: { asset: true } });
    if (!assignment || (scope !== null && !scope.has(assignment.employeeId))) throw new HttpError(404, "Assignment not found.", "NOT_FOUND");
    if (assignment.endedAt !== null) {
      if (assignment.endReason === "RETURNED") return { alreadyReturned: true, assignment };
      throw new HttpError(409, `This assignment already ended (${assignment.endReason === "LOST" ? "reported lost" : "transferred"}).`, "ASSIGNMENT_ENDED");
    }
    await tx.assetAssignment.update({
      where: { id: assignment.id },
      data: { endedAt: new Date(), endedByUserId: meta.actorUserId, endReason: "RETURNED", returnConditionCode: input.conditionCode, endNote: input.note ?? null }, // allow-clock: an instant
    });
    if (input.statusCode && input.statusCode !== assignment.asset.statusCode) await tx.asset.update({ where: { id }, data: { statusCode: input.statusCode } });
    await record(tx, meta, { assetId: id, kind: "RETURNED", assignmentId: assignment.id, employeeId: assignment.employeeId, conditionCode: input.conditionCode, statusCode: input.statusCode ?? null, note: input.note ?? null });
    return { alreadyReturned: false, assignment };
  });
  if (!result.alreadyReturned) {
    await notify(result.assignment.employeeId, "An asset has been returned", `${result.assignment.asset.name} (${formatAssetId(result.assignment.asset.number)}) is recorded as returned.`, "returned", id);
    notifyRegister(id);
  }
  return { ...(await getAsset(id, viewer)), alreadyReturned: result.alreadyReturned };
}

export async function transferAsset(id: string, input: { toEmployeeId: string; conditionCode: string; note?: string }, viewer: AssetViewer, meta: ActorMeta): Promise<AssetDetail> {
  const lists = await loadInForce();
  assertReady(lists);
  requireCode(lists.conditions, input.conditionCode, "conditions");
  const scope = await scopedEmployeeIds(viewer);
  const moved = await prisma
    .$transaction(async (tx) => {
      if ((await lockAsset(tx, id)).length === 0) throw new HttpError(404, "Asset not found.", "NOT_FOUND");
      const current = await tx.assetAssignment.findFirst({ where: { assetId: id, ...OPEN }, include: { asset: true } });
      if (!current || (scope !== null && !scope.has(current.employeeId))) throw new HttpError(409, "This asset is not issued to anyone, so there is nothing to transfer. Issue it instead.", "ASSET_NOT_ISSUED");
      if (current.employeeId === input.toEmployeeId) throw new HttpError(409, "The asset is already with this person.", "SAME_HOLDER");
      const to = await activeEmployeeInScope(tx, input.toEmployeeId, viewer);
      const now = new Date(); // allow-clock: an instant
      await tx.assetAssignment.update({ where: { id: current.id }, data: { endedAt: now, endedByUserId: meta.actorUserId, endReason: "REASSIGNED", endNote: input.note ?? null } });
      const next = await tx.assetAssignment.create({
        data: { assetId: id, employeeId: to.id, issuedAt: now, issuedByUserId: meta.actorUserId, issueConditionCode: input.conditionCode, issueNote: input.note ?? null },
      });
      await record(
        tx,
        meta,
        { assetId: id, kind: "REASSIGNED", assignmentId: next.id, employeeId: to.id, conditionCode: input.conditionCode, note: input.note ?? null, details: { fromAssignmentId: current.id, fromEmployeeId: current.employeeId } },
      );
      return { from: current.employeeId, to, asset: current.asset };
    })
    .catch(rethrowOneOpen);
  const label = `${moved.asset.name} (${formatAssetId(moved.asset.number)})`;
  await notify(moved.from, "An asset has been transferred from you", `${label} is now recorded with someone else.`, "transferred", id);
  await notify(moved.to.id, "An asset has been transferred to you", `${label}. Please acknowledge that you have received it.`, "transferred", id);
  notifyRegister(id);
  return getAsset(id, viewer);
}

/** A loss: the open assignment (if any) ends as LOST and the asset takes a status that cannot be issued. An event only — no amount, no deduction. */
export async function markLost(id: string, input: { statusCode: string; note: string }, viewer: AssetViewer, meta: ActorMeta): Promise<AssetDetail> {
  const lists = await loadInForce();
  assertReady(lists);
  requireCode(lists.statuses, input.statusCode, "statuses");
  if (isIssuable(lists, input.statusCode)) throw new HttpError(400, "A lost asset must be given a status that cannot be issued.", "VALIDATION_ERROR");
  await loadAssetForViewer(id, await scopedEmployeeIds(viewer));
  const done = await prisma.$transaction(async (tx) => {
    await lockAsset(tx, id);
    const asset = await tx.asset.findUniqueOrThrow({ where: { id } });
    const current = await tx.assetAssignment.findFirst({ where: { assetId: id, ...OPEN } });
    if (current) await tx.assetAssignment.update({ where: { id: current.id }, data: { endedAt: new Date(), endedByUserId: meta.actorUserId, endReason: "LOST", endNote: input.note } }); // allow-clock: an instant
    await tx.asset.update({ where: { id }, data: { statusCode: input.statusCode } });
    await record(tx, meta, { assetId: id, kind: "LOST", assignmentId: current?.id ?? null, employeeId: current?.employeeId ?? null, statusCode: input.statusCode, note: input.note }, { before: { statusCode: asset.statusCode } });
    return { asset, holderId: current?.employeeId ?? null };
  });
  if (done.holderId) await notify(done.holderId, "An asset has been reported lost", `${done.asset.name} (${formatAssetId(done.asset.number)}) is recorded as lost.`, "lost", id);
  notifyRegister(id);
  return getAsset(id, viewer);
}

/** Damage: recorded with the condition; the asset stays with its holder until it is returned. An event only — no amount, no deduction. */
export async function markDamaged(id: string, input: { conditionCode: string; statusCode?: string; note: string }, viewer: AssetViewer, meta: ActorMeta): Promise<AssetDetail> {
  const lists = await loadInForce();
  assertReady(lists);
  requireCode(lists.conditions, input.conditionCode, "conditions");
  if (input.statusCode) requireCode(lists.statuses, input.statusCode, "statuses");
  await loadAssetForViewer(id, await scopedEmployeeIds(viewer));
  const done = await prisma.$transaction(async (tx) => {
    await lockAsset(tx, id);
    const asset = await tx.asset.findUniqueOrThrow({ where: { id } });
    const current = await tx.assetAssignment.findFirst({ where: { assetId: id, ...OPEN } });
    if (input.statusCode && input.statusCode !== asset.statusCode) await tx.asset.update({ where: { id }, data: { statusCode: input.statusCode } });
    await record(
      tx,
      meta,
      { assetId: id, kind: "DAMAGED", assignmentId: current?.id ?? null, employeeId: current?.employeeId ?? null, conditionCode: input.conditionCode, statusCode: input.statusCode ?? null, note: input.note },
      { before: { statusCode: asset.statusCode } },
    );
    return { asset, holderId: current?.employeeId ?? null };
  });
  if (done.holderId) await notify(done.holderId, "Damage recorded on an asset you hold", `${done.asset.name} (${formatAssetId(done.asset.number)}) has damage recorded against it.`, "damaged", id);
  notifyRegister(id);
  return getAsset(id, viewer);
}

/** The holder confirms they received an asset. Idempotent: acknowledging twice changes nothing. Only the holder, only while it is with them. */
export async function acknowledge(assignmentId: string, viewer: AssetViewer, meta: ActorMeta): Promise<{ current: MyAssetView[]; past: MyAssetView[] }> {
  const changed = await prisma.$transaction(async (tx) => {
    const a = await tx.assetAssignment.findUnique({ where: { id: assignmentId } });
    // Someone else's assignment is indistinguishable from a missing one.
    if (!a || a.employeeId !== viewer.employeeId) throw new HttpError(404, "Assignment not found.", "NOT_FOUND");
    if (a.endedAt !== null) throw new HttpError(409, "This asset is no longer with you.", "ASSIGNMENT_ENDED");
    if (a.acknowledgedAt !== null) return null;
    await lockAsset(tx, a.assetId);
    const updated = await tx.assetAssignment.updateMany({ where: { id: a.id, acknowledgedAt: null, endedAt: null }, data: { acknowledgedAt: new Date() } }); // allow-clock: an instant
    if (updated.count === 0) return null;
    await record(tx, meta, { assetId: a.assetId, kind: "ACKNOWLEDGED", assignmentId: a.id, employeeId: a.employeeId });
    return a.assetId;
  });
  if (changed) notifyRegister(changed);
  return listMine(viewer);
}
