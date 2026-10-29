import type { PayrollSetupArea, PayrollSetupSignoff } from "@prisma/client";
import { writeAuditLog } from "../../../lib/audit";
import { businessToday } from "../../../lib/businessDate";
import { bankAccountsOn, namesOn, salariesOn } from "../../../lib/effectiveDating";
import { authorityFor, isDirector, requireDirectorTwoFactor } from "../../../lib/directorAuthority";
import { recordDirectorNotice, scheduleDelivery } from "../../../lib/directorNotices";
import { prisma } from "../../../lib/prisma";
import { HttpError } from "../../../middleware/errorHandler";
import { payrollHash } from "../hash";
import { loadItems, summarise } from "../items";
import { namesOfUsers } from "../names";
import { keyedHash } from "../sealed";

// People's data before the first real run (docs/plans/PHASE_6.md §14J): salaries, bank accounts, PF numbers. They are not governed items with a version a second person confirms,
// so a second person SIGNS OFF the whole set instead: "I checked these". The set is fixed by a keyed hash of the exact rows, so any later change to any of them makes the sign-off
// stale, and the signer can never be the requester or the person who entered any of the rows (where the row records who). Append-only.

export const AREAS = ["SALARIES", "BANK_ACCOUNTS", "STATUTORY_IDS"] as const satisfies readonly PayrollSetupArea[];

/** What a signer must be allowed to see to check the area, besides payroll.approve. */
export const AREA_VIEW_PERMISSION: Record<PayrollSetupArea, string> = { SALARIES: "payroll.salary.view", BANK_ACCOUNTS: "employee.bank.view", STATUTORY_IDS: "employee.statutory.view" };
export const AREA_LABEL: Record<PayrollSetupArea, string> = { SALARIES: "salaries", BANK_ACCOUNTS: "bank accounts", STATUTORY_IDS: "PF numbers (UAN)" };

export interface AreaSet {
  area: PayrollSetupArea;
  total: number;
  covered: number;
  missing: Array<{ employeeId: string; code: string; name: string }>;
  contentHash: string;
  /** Everyone who wrote any of the covered rows, where the row says who. */
  authorUserIds: string[];
}

/** The people a real run would pay: active, already joined. */
async function population(today: Date) {
  return prisma.employee.findMany({ where: { status: "ACTIVE", dateOfJoining: { lte: today } }, select: { id: true, employeeCode: true, employmentType: true }, orderBy: { employeeCode: "asc" } });
}

export async function currentSet(area: PayrollSetupArea, today: Date = businessToday()): Promise<AreaSet> {
  let people = await population(today);
  if (area === "STATUTORY_IDS") {
    // PF numbers are needed by the people the PF rule covers. If that rule has no value yet, everybody is counted (the stricter reading).
    const covered = summarise(await loadItems("RULE", ["PF_ELIGIBLE_TYPES"]), "PF_ELIGIBLE_TYPES").current?.value;
    if (Array.isArray(covered)) people = people.filter((p) => (covered as string[]).includes(p.employmentType));
  }
  const ids = people.map((p) => p.id);
  const have = new Map<string, { token: string; author: string | null }>();
  if (area === "SALARIES") {
    for (const [id, row] of await salariesOn(ids, today)) have.set(id, { token: row.id, author: row.createdByUserId });
  } else if (area === "BANK_ACCOUNTS") {
    for (const [id, row] of await bankAccountsOn(ids, today)) have.set(id, { token: row.id, author: row.createdByUserId });
  } else {
    for (const row of await prisma.employeeStatutory.findMany({ where: { employeeId: { in: ids }, uanEncrypted: { not: null } }, select: { employeeId: true, updatedAt: true, updatedByUserId: true } })) {
      have.set(row.employeeId, { token: row.updatedAt.toISOString(), author: row.updatedByUserId });
    }
  }
  const missing = people.filter((p) => !have.has(p.id));
  const names = await namesOn(missing.slice(0, 25).map((p) => p.id), today);
  return {
    area,
    total: people.length,
    covered: people.length - missing.length,
    missing: missing.slice(0, 25).map((p) => ({ employeeId: p.id, code: p.employeeCode, name: names.get(p.id) ?? p.employeeCode })),
    contentHash: keyedHash(`setup:${area}`, people.filter((p) => have.has(p.id)).map((p) => `${p.id}:${have.get(p.id)!.token}`)),
    authorUserIds: [...new Set([...have.values()].map((h) => h.author).filter((a): a is string => Boolean(a)))].sort(),
  };
}

export async function latestSignoff(area: PayrollSetupArea): Promise<PayrollSetupSignoff | null> {
  return prisma.payrollSetupSignoff.findFirst({ where: { area }, orderBy: { signedAt: "desc" } });
}

const fingerprintOf = (set: AreaSet): string => payrollHash({ t: "SETUP_SIGNOFF", area: set.area, hash: set.contentHash });

export interface SignoffPreview {
  area: PayrollSetupArea;
  label: string;
  covered: number;
  total: number;
  missing: AreaSet["missing"];
  /** The people who entered what is being checked: none of them can sign. */
  enteredBy: string[];
  blocked: string | null;
  fingerprint: string;
}

interface Block {
  message: string;
  status: number;
  code: string;
}

/** On director authority a director may sign off rows they entered themselves (recorded, and the other director is told); otherwise the entrant is barred, as before. */
async function blockReason(set: AreaSet, actorUserId: string, permissions: ReadonlySet<string>): Promise<Block | null> {
  if (!permissions.has("payroll.approve")) return { message: "Only a payroll approver can sign this off.", status: 403, code: "FORBIDDEN" };
  if (!permissions.has(AREA_VIEW_PERMISSION[set.area])) return { message: `To check ${AREA_LABEL[set.area]} you must be allowed to see them (${AREA_VIEW_PERMISSION[set.area]}).`, status: 403, code: "FORBIDDEN" };
  if (set.total === 0) return { message: `There is nobody whose ${AREA_LABEL[set.area]} could be checked yet.`, status: 409, code: "SIGNOFF_INCOMPLETE" };
  if (set.covered < set.total) return { message: `${set.total - set.covered} of ${set.total} people still have no ${AREA_LABEL[set.area]} on record. Enter them first; then this can be checked as a whole.`, status: 409, code: "SIGNOFF_INCOMPLETE" };
  if (set.authorUserIds.includes(actorUserId) && !((await isDirector(actorUserId)) && (await authorityFor("SETUP_SIGNOFF")) === "DIRECTOR_AUTHORITY")) return { message: `You entered some of these ${AREA_LABEL[set.area]}, so somebody else has to check them.`, status: 403, code: "SIGNER_ENTERED_THIS" };
  return null;
}

export async function previewSignoff(area: PayrollSetupArea, actorUserId: string, permissions: ReadonlySet<string>): Promise<SignoffPreview> {
  const set = await currentSet(area);
  const names = await namesOfUsers(set.authorUserIds);
  return {
    area,
    label: AREA_LABEL[area],
    covered: set.covered,
    total: set.total,
    missing: set.missing,
    enteredBy: set.authorUserIds.map((id) => names.get(id) ?? "Someone"),
    blocked: (await blockReason(set, actorUserId, permissions))?.message ?? null,
    fingerprint: fingerprintOf(set),
  };
}

export async function giveSignoff(
  area: PayrollSetupArea,
  input: { fingerprint: string; note: string },
  actor: { userId: string; permissions: ReadonlySet<string>; ip?: string | null; userAgent?: string | null },
): Promise<PayrollSetupSignoff> {
  const set = await currentSet(area);
  const blocked = await blockReason(set, actor.userId, actor.permissions);
  if (blocked) throw new HttpError(blocked.status, blocked.message, blocked.code);
  if (input.fingerprint !== fingerprintOf(set)) throw new HttpError(409, "This changed since you looked at it. Look at it again.", "PREVIEW_STALE");
  const note = input.note.trim();
  if (note.length < 5) throw new HttpError(400, "Say what you checked it against (a few words, for example the signed salary letters).", "VALIDATION_ERROR");
  const own = set.authorUserIds.includes(actor.userId);
  if (own) await requireDirectorTwoFactor(actor.userId);
  let noticeId: string | null = null;
  const row = await prisma.$transaction(async (tx) => {
    // Read inside the transaction: the mode recorded is the mode in force when it was signed.
    if (own && (await authorityFor("SETUP_SIGNOFF", tx)) !== "DIRECTOR_AUTHORITY") throw new HttpError(409, "The second-director check was switched on a moment ago, so a different director has to sign this off.", "SECOND_DIRECTOR_REQUIRED");
    const created = await tx.payrollSetupSignoff.create({
      data: { area, contentHash: set.contentHash, covered: set.covered, total: set.total, note, authorUserIds: set.authorUserIds, signedByUserId: actor.userId, ...(own ? { authority: "DIRECTOR_AUTHORITY" as const } : {}) },
    });
    if (own) {
      ({ noticeId } = await recordDirectorNotice(
        { kind: "ACTION", step: "SETUP_SIGNOFF", subjectType: "PAYROLL_SETUP", subjectId: area, subjectLabel: `the sign-off of ${AREA_LABEL[area]}`, itemCount: set.covered, actorUserId: actor.userId, approvalId: null, authority: "DIRECTOR_AUTHORITY" },
        tx,
      ));
    }
    return created;
  });
  if (noticeId) await scheduleDelivery(noticeId);
  await writeAuditLog({ actorUserId: actor.userId, action: "payroll.setup.signed_off", entityType: "PayrollSetup", entityId: area, after: { area, covered: set.covered, total: set.total, note }, ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null });
  return row;
}
