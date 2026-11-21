import type { ApprovalAuthority, Prisma, PrismaClient } from "@prisma/client";
import {
  DIRECTOR_AUTHORITY_SETTING_KEY,
  DIRECTOR_CHOICE_MODES,
  DIRECTOR_RECOMMENDED_SECOND_STEPS,
  DIRECTOR_STEPS,
  DIRECTOR_STEP_INFO,
  isChoiceRequired,
  type DirectorChoiceMode,
  type DirectorStep,
  type DirectorSwitchView,
} from "@shared/constants/directorAuthority";
import { HttpError } from "../middleware/errorHandler";
import { writeAuditLog } from "./audit";
import { SUPER_ADMIN_ROLE_CODE } from "./permissions";
import { prisma } from "./prisma";

// Director authority (docs/plans/DIRECTOR_AUTHORITY.md). One place that knows: who a director is, which steps need a second director (the switches), and whether a
// director has two-step sign-in. Every guard reads the switches HERE, at the moment of the act and inside its transaction, never from the request.

export type Db = Prisma.TransactionClient | PrismaClient;

/** Directors are the active Super Admins. */
export async function activeDirectors(db: Db = prisma): Promise<Array<{ userId: string; employeeId: string }>> {
  const rows = await db.user.findMany({ where: { status: "ACTIVE", roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } }, select: { id: true, employeeId: true }, orderBy: { createdAt: "asc" } });
  return rows.map((u) => ({ userId: u.id, employeeId: u.employeeId }));
}

export async function isDirector(userId: string, db: Db = prisma): Promise<boolean> {
  return (await db.user.count({ where: { id: userId, status: "ACTIVE", roles: { some: { role: { code: SUPER_ADMIN_ROLE_CODE } } } } })) > 0;
}

export async function requireDirector(userId: string, what: string, db: Db = prisma): Promise<void> {
  if (!(await isDirector(userId, db))) throw new HttpError(403, `Only a director (a Super Admin) can ${what}.`, "DIRECTOR_ONLY");
}

/**
 * Two-step sign-in for directors is OPTIONAL. They can enrol any time and sign in normally without it. Whether it is REQUIRED of them is one setting, off by default, changeable only
 * by a director (System Settings, Security). When it is on, a director without it cannot act on payroll, change a switch or acknowledge a notice, and must enrol at sign-in.
 */
export const DIRECTOR_2FA_SETTING_KEY = "auth.requireDirectorTwoFactor";

// FIX-C1 (independent audit 2026-11-20): compulsory by default. The Default behaviour "auth.directorTwoFactorCompulsory" (on unless both directors confirmed
// turning it off) decides; the old one-director System Setting (DIRECTOR_2FA_SETTING_KEY) is no longer read.
export async function directorTwoFactorRequired(_db: Db = prisma): Promise<boolean> {
  const { behaviourValue } = await import("../modules/behaviours/service");
  return (await behaviourValue("auth.directorTwoFactorCompulsory")).value === true;
}

/** `enforced` overrides the setting (tests of the enforced mode); omitted, the setting decides. */
export async function requireDirectorTwoFactor(userId: string, db: Db = prisma, enforced?: boolean): Promise<void> {
  if (!(enforced ?? (await directorTwoFactorRequired(db)))) return;
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
  if (!user?.totpEnabled) throw new HttpError(403, "The owners have made two-step sign-in compulsory for directors. Turn it on for your account first (your profile, Security), then do this again.", "DIRECTOR_2FA_REQUIRED");
}

// ── The choices (no default for a payroll step) ──
// A choice is proposed by one director and confirmed by the other. Until it is confirmed the step is "Not set" and payroll refuses to run it. A change to a Confirmed choice is
// proposed the same way and takes effect only when the other director confirms; until then the Confirmed one stays in force. Stored in SystemSetting `payroll.secondDirector`:
//   { v: 2, steps: { STEP: { current?: Choice, pending?: Proposal } } }       (the old flat true/false form was never confirmed by anyone and reads as Not set)
// The history is the audit log and the director notices (both append-only).

interface Proposal {
  mode: DirectorChoiceMode;
  proposedBy: string;
  proposedAt: string;
  demo?: boolean;
}
interface Choice extends Proposal {
  confirmedBy: string;
  confirmedAt: string;
}
interface StepState {
  current?: Choice;
  pending?: Proposal;
}
type Stored = { v: 2; steps: Partial<Record<DirectorStep, StepState>> };

const isMode = (m: unknown): m is DirectorChoiceMode => (DIRECTOR_CHOICE_MODES as readonly unknown[]).includes(m);

async function readStored(db: Db): Promise<Stored> {
  const row = await db.systemSetting.findUnique({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
  const v = row?.value as { v?: number; steps?: Record<string, StepState> } | null | undefined;
  if (!v || v.v !== 2 || !v.steps || typeof v.steps !== "object") return { v: 2, steps: {} };
  const steps: Stored["steps"] = {};
  for (const step of DIRECTOR_STEPS) {
    const st = v.steps[step];
    if (!st) continue;
    const out: StepState = {};
    if (st.current && isMode(st.current.mode) && st.current.confirmedBy && st.current.confirmedBy !== st.current.proposedBy) out.current = st.current;
    if (st.pending && isMode(st.pending.mode)) out.pending = st.pending;
    steps[step] = out;
  }
  return { v: 2, steps };
}

/** The mode in force for a step, or null when it is Not set. */
export async function choiceMode(step: DirectorStep, db: Db = prisma): Promise<DirectorChoiceMode | null> {
  return (await readStored(db)).steps[step]?.current?.mode ?? null;
}

export async function requiresSecondDirector(step: DirectorStep, db: Db = prisma): Promise<boolean> {
  return (await choiceMode(step, db)) === "SECOND_DIRECTOR";
}

/**
 * The authority an act of this step is made under, read now. Call it inside the transaction that records the act. A payroll step whose choice is not Confirmed REFUSES:
 * payroll does not run on a default nobody chose. (Settings and a director's own identity entry are not payroll steps: unset, the director acts and the other is told.)
 */
// FIX-H4 (independent audit 2026-11-20): every pay step is two-director by default. A payroll step with no confirmed choice is decided by a different director
// (SECOND_DIRECTOR); "the acting director decides alone" applies only once BOTH directors have chosen it (one proposes, the other confirms), never to a director's
// own pay (approvals.ts authorise), and shows as a red row on Ready for First Run and on the audit screen while it is on.
export async function authorityFor(step: DirectorStep, db: Db = prisma): Promise<ApprovalAuthority> {
  const mode = await choiceMode(step, db);
  if (mode) return mode;
  if (isChoiceRequired(step)) return "SECOND_DIRECTOR";
  return "DIRECTOR_AUTHORITY";
}

/** FIX-H4: the payroll steps where one director currently decides alone (both directors chose it), for the red rows. */
export async function singleDirectorSteps(db: Db = prisma): Promise<Array<{ step: DirectorStep; label: string }>> {
  const stored = await readStored(db);
  return DIRECTOR_STEPS.filter((s) => isChoiceRequired(s) && stored.steps[s]?.current?.mode === "DIRECTOR_AUTHORITY").map((step) => ({ step, label: DIRECTOR_STEP_INFO[step].label }));
}

/** For screens that only DESCRIBE what would happen: an unset choice reads as the strictest (a different director), and the act itself refuses with the real reason. */
export async function authorityForDisplay(step: DirectorStep, db: Db = prisma): Promise<ApprovalAuthority> {
  return (await choiceMode(step, db)) ?? (isChoiceRequired(step) ? "SECOND_DIRECTOR" : "DIRECTOR_AUTHORITY");
}

export interface ChoiceNames {
  (userIds: string[]): Promise<Map<string, string>>;
}

export async function listSwitches(viewerUserId: string | null = null, db: Db = prisma): Promise<DirectorSwitchView[]> {
  const stored = await readStored(db);
  const { namesOfUsers } = await import("../modules/payroll/names");
  const ids = new Set<string>();
  for (const st of Object.values(stored.steps)) for (const x of [st.current?.confirmedBy, st.pending?.proposedBy]) if (x) ids.add(x);
  const names = await namesOfUsers([...ids]);
  const nameOf = (id: string) => names.get(id) ?? "A director";
  return DIRECTOR_STEPS.map((step) => {
    const st = stored.steps[step];
    const status = st?.pending ? "PENDING_CONFIRMATION" : st?.current ? "CONFIRMED" : "NOT_SET";
    return {
      step,
      label: DIRECTOR_STEP_INFO[step].label,
      covers: DIRECTOR_STEP_INFO[step].covers,
      required: isChoiceRequired(step),
      recommendedSecond: (DIRECTOR_RECOMMENDED_SECOND_STEPS as readonly string[]).includes(step),
      status,
      mode: st?.current?.mode ?? null,
      demo: st?.current?.demo === true,
      confirmed: st?.current ? { byName: nameOf(st.current.confirmedBy), at: st.current.confirmedAt } : null,
      proposed: st?.pending ? { mode: st.pending.mode, byName: nameOf(st.pending.proposedBy), at: st.pending.proposedAt, byMe: st.pending.proposedBy === viewerUserId } : null,
    } satisfies DirectorSwitchView;
  });
}

/** Steps that are required and not Confirmed, for the Ready-for-first-run screen. */
export async function unsetRequiredSteps(db: Db = prisma): Promise<Array<{ step: DirectorStep; label: string; status: "NOT_SET" | "PENDING_CONFIRMATION"; demo: boolean }>> {
  const stored = await readStored(db);
  return DIRECTOR_STEPS.filter((s) => isChoiceRequired(s) && !stored.steps[s]?.current).map((step) => ({
    step,
    label: DIRECTOR_STEP_INFO[step].label,
    status: stored.steps[step]?.pending ? ("PENDING_CONFIRMATION" as const) : ("NOT_SET" as const),
    demo: false,
  }));
}

export async function choiceFacts(db: Db = prisma): Promise<Array<{ step: DirectorStep; label: string; status: "NOT_SET" | "PENDING_CONFIRMATION" | "CONFIRMED"; demo: boolean; confirmedBy: string | null; confirmedAt: string | null }>> {
  const stored = await readStored(db);
  return DIRECTOR_STEPS.filter((s) => isChoiceRequired(s)).map((step) => {
    const st = stored.steps[step];
    return { step, label: DIRECTOR_STEP_INFO[step].label, status: st?.pending ? "PENDING_CONFIRMATION" : st?.current ? "CONFIRMED" : "NOT_SET", demo: st?.current?.demo === true, confirmedBy: st?.current?.confirmedBy ?? null, confirmedAt: st?.current?.confirmedAt ?? null };
  });
}

export interface SwitchActor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

async function writeStored(tx: Db, next: Stored, actorUserId: string): Promise<void> {
  await tx.systemSetting.upsert({
    where: { key: DIRECTOR_AUTHORITY_SETTING_KEY },
    create: { key: DIRECTOR_AUTHORITY_SETTING_KEY, value: next as unknown as Prisma.InputJsonValue, updatedByUserId: actorUserId },
    update: { value: next as unknown as Prisma.InputJsonValue, updatedByUserId: actorUserId },
  });
}

async function tellTheOther(tx: Db, step: DirectorStep, actorUserId: string, text: string, detail: Record<string, unknown>): Promise<string> {
  const { recordDirectorNotice, raiseDirectorBanner } = await import("./directorNotices");
  const { noticeId } = await recordDirectorNotice({ kind: "SWITCH_CHANGED", step, subjectType: "SecondDirectorChoice", subjectId: step, subjectLabel: text, actorUserId, detail }, tx);
  await raiseDirectorBanner({ noticeId, kind: "director.switch_changed", targetUserId: actorUserId, summary: `A director ${text}.` }, tx);
  return noticeId;
}

/** One director proposes the choice for a step. It takes effect only when the OTHER director confirms it. */
export async function proposeChoice(step: DirectorStep, mode: DirectorChoiceMode, actor: SwitchActor, opts: { demo?: boolean } = {}): Promise<{ changed: boolean; noticeId: string | null }> {
  if (!(DIRECTOR_STEPS as readonly string[]).includes(step)) throw new HttpError(400, "Unknown step.", "VALIDATION_ERROR");
  if (!isMode(mode)) throw new HttpError(400, "Unknown choice.", "VALIDATION_ERROR");
  await requireDirector(actor.userId, "choose how a payroll step is decided");
  await requireDirectorTwoFactor(actor.userId);
  const label = DIRECTOR_STEP_INFO[step].label;
  const phrase = mode === "SECOND_DIRECTOR" ? "a different director must decide" : "the acting director decides alone, the other is told";
  const result = await prisma.$transaction(async (tx) => {
    const stored = await readStored(tx);
    const st = stored.steps[step] ?? {};
    if (!st.pending && st.current?.mode === mode) return { changed: false as const, noticeId: null as string | null };
    if (st.pending && st.pending.mode === mode && st.pending.proposedBy === actor.userId) return { changed: false as const, noticeId: null };
    const proposal: Proposal = { mode, proposedBy: actor.userId, proposedAt: new Date().toISOString(), ...(opts.demo ? { demo: true } : {}) }; // allow-clock: an instant
    stored.steps[step] = { ...st, pending: proposal };
    await writeStored(tx, stored, actor.userId);
    const noticeId = await tellTheOther(tx, step, actor.userId, `proposed that “${label}” is decided this way: ${phrase}. It waits for your confirmation`, { mode, kind: "proposed" });
    return { changed: true as const, noticeId };
  });
  if (result.changed) {
    await writeAuditLog({ actorUserId: actor.userId, action: "director.choice.proposed", entityType: "SystemSetting", entityId: DIRECTOR_AUTHORITY_SETTING_KEY, after: { step, mode }, ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null });
    const { scheduleDelivery } = await import("./directorNotices");
    await scheduleDelivery(result.noticeId);
  }
  return result;
}

/** The OTHER director confirms the proposal they were shown. `expectMode` binds the confirmation to what was on their screen. */
export async function confirmChoice(step: DirectorStep, expectMode: DirectorChoiceMode, actor: SwitchActor, opts: { demo?: boolean } = {}): Promise<{ noticeId: string }> {
  if (!(DIRECTOR_STEPS as readonly string[]).includes(step)) throw new HttpError(400, "Unknown step.", "VALIDATION_ERROR");
  await requireDirector(actor.userId, "confirm how a payroll step is decided");
  await requireDirectorTwoFactor(actor.userId);
  const label = DIRECTOR_STEP_INFO[step].label;
  const result = await prisma.$transaction(async (tx) => {
    const stored = await readStored(tx);
    const st = stored.steps[step];
    if (!st?.pending) throw new HttpError(409, "Nothing is waiting for your confirmation on this step.", "NOTHING_PENDING");
    if (st.pending.proposedBy === actor.userId) throw new HttpError(403, "You proposed this, so the other director has to confirm it.", "CHOICE_CONFIRMER_IS_PROPOSER");
    if (st.pending.mode !== expectMode) throw new HttpError(409, "The proposal changed since you looked at it. Look at it again.", "PREVIEW_STALE");
    const now = new Date().toISOString(); // allow-clock: an instant
    stored.steps[step] = { current: { ...st.pending, confirmedBy: actor.userId, confirmedAt: now, ...(opts.demo ? { demo: true } : {}) } };
    await writeStored(tx, stored, actor.userId);
    const phrase = expectMode === "SECOND_DIRECTOR" ? "a different director must decide" : "the acting director decides alone, the other is told";
    const noticeId = await tellTheOther(tx, step, actor.userId, `confirmed that “${label}” is decided this way: ${phrase}`, { mode: expectMode, kind: "confirmed" });
    return { noticeId, proposer: st.pending.proposedBy };
  });
  await writeAuditLog({ actorUserId: actor.userId, action: "director.choice.confirmed", entityType: "SystemSetting", entityId: DIRECTOR_AUTHORITY_SETTING_KEY, after: { step, mode: expectMode, proposedBy: result.proposer }, ipAddress: actor.ip ?? null, userAgent: actor.userAgent ?? null });
  const { scheduleDelivery } = await import("./directorNotices");
  await scheduleDelivery(result.noticeId);
  return { noticeId: result.noticeId };
}
