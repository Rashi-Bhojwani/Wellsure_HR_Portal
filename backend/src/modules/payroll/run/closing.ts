import type { PayrollApproval, PayrollApprovalSubject, PayrollRun } from "@prisma/client";
import { RUN_STATUS_LABEL } from "@shared/constants/payrollRun";
import { writeAuditLog } from "../../../lib/audit";
import { namesOn } from "../../../lib/effectiveDating";
import { peopleWithoutPayslip } from "./held";
import { resolveAccess } from "../../../lib/permissions";
import { prisma } from "../../../lib/prisma";
import { permissionRoom, getSocketServer } from "../../../realtime/emit";
import { HttpError } from "../../../middleware/errorHandler";
import type { DirectorStep } from "@shared/constants/directorAuthority";
import { authorityFor, authorityForDisplay, unsetRequiredSteps } from "../../../lib/directorAuthority";
import { adapterFor, authorise, checkerAvailability, decide as decideApproval, liveApproval, noteFiguresChanged, registerSubject, submit as submitApproval, voidApproval, voidLive, type CheckerAvailability } from "../approvals";
import { recordEvent, figureEditorsSince } from "../events";
import { payrollHash } from "../hash";
import { canonicalDecimal, dec } from "../money";
import { namesOfUsers } from "../names";
import { assertRunIsReal, pinStatuses, watermarkFromStatuses, type RulePin, type Watermark } from "../rules/context";
import { employeeIdOfUser } from "../salary/guards";
import { buildPayslips } from "./payslip";
import { bankHashParts, planBank } from "./bank";
import { computeRun } from "./engine";
import { assessForSubmission, type Assessment, type Blocker } from "./submitCheck";
import { varianceJson } from "./variance";
import { iso } from "./days";

// Submitting, approving, finalising and unlocking, publishing and the bank file: every step that makes a run real or undoes that, each through the one
// maker-checker core (docs/plans/PHASE_6.md §14F). A step is the same four calls whatever it is: a preview that lists what stands in the way and what would be
// affected, a request that repeats every check on the server and must carry the preview's fingerprint, a decision by a different person bound to the exact figures,
// and a withdrawal. The act that an approval authorises (finalising, unlocking) is in finaliser.ts, the only file that may do it.

export type Slug = "run" | "finalise" | "unlock" | "publish" | "bank-file";
export const SLUGS = ["run", "finalise", "unlock", "publish", "bank-file"] as const;
export const SUBJECT_OF: Record<Slug, PayrollApprovalSubject> = { run: "RUN_APPROVAL", finalise: "PERIOD_FINALISE", unlock: "PERIOD_UNLOCK", publish: "PAYSLIP_PUBLISH", "bank-file": "BANK_FILE" };
/** Which switch governs each step (docs/plans/DIRECTOR_AUTHORITY.md §2.1). */
export const STEP_OF: Record<Slug, DirectorStep> = { run: "RUN_APPROVAL", finalise: "PERIOD_FINALISE", unlock: "PERIOD_UNLOCK", publish: "PAYSLIP_PUBLISH", "bank-file": "BANK_FILE" };
export const MAKER_PERMISSION: Record<Slug, string> = { run: "payroll.run", finalise: "payroll.run", unlock: "payroll.unlock", publish: "payroll.run", "bank-file": "payroll.run" };
const LABEL: Record<Slug, string> = { run: "Submit the run for approval", finalise: "Finalise the payroll period", unlock: "Unlock the payroll period", publish: "Publish payslips", "bank-file": "Generate the bank file" };

/** The governed item the bank file's layout lives in. Built in P6-5; until it exists and is Confirmed no bank file can be requested. */
export const BANK_TEMPLATE_KEY = "BANK_TEMPLATE";

type Actor = { userId: string; ip?: string | null };
const cycleOf = (r: Pick<PayrollRun, "cycleStart" | "cycleEnd" | "cycleLabel">) => ({ start: r.cycleStart, end: r.cycleEnd, label: r.cycleLabel });
const m = (v: { toString(): string }) => canonicalDecimal(dec(v.toString()));
const pinsOf = (r: PayrollRun) => (r.pins as unknown as RulePin[]) ?? [];

async function loadRun(runId: string): Promise<PayrollRun> {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run) throw new HttpError(404, "No such payroll run.", "NOT_FOUND");
  return run;
}

/** The hash of the figures a run would have if it were calculated this moment. If it cannot be worked out at all (a rule has no value), that is a hash nothing else equals. */
export async function liveHashOf(run: PayrollRun): Promise<string> {
  try {
    return (await computeRun(cycleOf(run))).runHash;
  } catch (err) {
    if (err instanceof HttpError) return `unavailable:${err.code ?? err.status}`;
    throw err;
  }
}

const finaliseHash = (run: Pick<PayrollRun, "id" | "cycleLabel">, live: string) => payrollHash({ t: "finalise", run: run.id, live, cycle: run.cycleLabel });
const releasesOf = (runId: string) => prisma.payrollRunRelease.findMany({ where: { runId }, orderBy: { createdAt: "asc" } });

// ── The seven subjects' adapters that belong to a run (rules and salary revisions register theirs where they live) ──

registerSubject({
  subject: "RUN_APPROVAL",
  makerPermission: "payroll.run",
  checkerPermission: "payroll.approve",
  async describe(id) {
    return `the payroll run for ${(await loadRun(id)).cycleLabel}`;
  },
  async hash(id) {
    return liveHashOf(await loadRun(id));
  },
  // A run is SUBMITTED or APPROVED only while its approval is live. Whenever that approval is voided, for whatever reason, the run goes back to a draft in the same
  // transaction, and a period approval resting on it goes with it.
  async onVoided(approval, reason, actorUserId, db) {
    await db.payrollRun.updateMany({ where: { id: approval.subjectId, status: { in: ["SUBMITTED", "APPROVED"] } }, data: { status: "CALCULATED" } });
    await voidLive("PERIOD_FINALISE", approval.subjectId, reason, actorUserId, db);
  },
});
registerSubject({
  subject: "PERIOD_FINALISE",
  makerPermission: "payroll.run",
  checkerPermission: "payroll.approve",
  async describe(id) {
    return `closing the payroll period for ${(await loadRun(id)).cycleLabel}`;
  },
  async hash(id) {
    const run = await loadRun(id);
    return finaliseHash(run, await liveHashOf(run));
  },
});
registerSubject({
  subject: "PERIOD_UNLOCK",
  makerPermission: "payroll.unlock",
  checkerPermission: "payroll.approve",
  async describe(id) {
    return `unlocking the payroll period for ${(await loadRun(id)).cycleLabel}`;
  },
  async hash(id) {
    const run = await loadRun(id);
    return payrollHash({ t: "unlock", run: run.id, status: run.status, runHash: run.runHash, releases: (await releasesOf(id)).map((r) => r.kind) });
  },
});
registerSubject({
  subject: "PAYSLIP_PUBLISH",
  makerPermission: "payroll.run",
  checkerPermission: "payroll.approve",
  async describe(id) {
    return `publishing the payslips for ${(await loadRun(id)).cycleLabel}`;
  },
  // A final run never changes, so the payslips built from it are fixed too; their content hashes (name, placement and last four digits as they stand now) are what the
  // approval is bound to, so a change to somebody's bank account or name between approval and publishing voids it.
  async hash(id) {
    const run = await loadRun(id);
    if (run.status !== "FINALISED") return payrollHash({ t: "publish", run: id, final: false });
    const slips = await buildPayslips(run);
    return payrollHash({ t: "publish", run: id, runHash: run.runHash, slips: [...slips].sort(([a], [b]) => (a < b ? -1 : 1)).map(([employeeId, s]) => [employeeId, s.contentHash]) });
  },
});
registerSubject({
  subject: "BANK_FILE",
  makerPermission: "payroll.run",
  checkerPermission: "payroll.approve",
  async describe(id) {
    return `the bank file for ${(await loadRun(id)).cycleLabel}`;
  },
  // The rows, the accounts they go to (by hash), the payment date and the exact layout: a bank account changed after approval, or a layout edited, voids it.
  async hash(id) {
    const run = await loadRun(id);
    if (run.status !== "FINALISED") return payrollHash({ t: "bank", run: id, final: false });
    return payrollHash({ t: "bank", run: id, ...(bankHashParts(run.runHash, await planBank(run)) as Record<string, unknown>) });
  },
});

// ── Realtime ──

function emitTo(permissions: string[], event: string, payload: Record<string, unknown>): void {
  getSocketServer()?.to(permissions.map(permissionRoom)).emit(event, payload);
}

// ── Keeping the state true: an approval is only as good as the figures it was given for ──

/**
 * Compares the figures a run would have now with the ones its approval was given for, and if they differ voids the approval (and with it the run's SUBMITTED or
 * APPROVED state), recording who made the change so they can never be the one who approves it afterwards. Called after every payroll-owned change that can move the
 * figures, and whenever a run waiting for a decision is read or acted on.
 */
export async function reverifyRun(runId: string, what: string, actorUserId: string | null): Promise<{ voided: boolean }> {
  const run = await prisma.payrollRun.findUnique({ where: { id: runId } });
  if (!run || (run.status !== "SUBMITTED" && run.status !== "APPROVED")) return { voided: false };
  const approval = await liveApproval("RUN_APPROVAL", runId);
  const expected = approval ? (approval.status === "APPROVED" ? approval.hashAtDecision : approval.contentHash) : null;
  const live = await liveHashOf(run);
  if (approval && live === expected) return { voided: false };
  const voided = await prisma.$transaction(async (tx) => {
    if (!approval) {
      const { count } = await tx.payrollRun.updateMany({ where: { id: runId, status: { in: ["SUBMITTED", "APPROVED"] } }, data: { status: "CALCULATED" } });
      return count === 1;
    }
    if (actorUserId) return (await noteFiguresChanged("RUN_APPROVAL", runId, actorUserId, what, tx)).voided;
    return voidApproval(approval, `The figures were changed: ${what}`, null, tx);
  });
  if (voided) {
    emitTo(["payroll.run", "payroll.approve"], "payroll.run.approval_voided", { runId, cycle: run.cycleLabel, reason: what });
    await writeAuditLog({ actorUserId, action: "payroll.run.approval_voided", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, reason: what } });
  }
  return { voided };
}

export async function reverifyOpenRuns(what: string, actorUserId: string | null): Promise<void> {
  const open = await prisma.payrollRun.findMany({ where: { status: { in: ["SUBMITTED", "APPROVED"] } }, select: { id: true } });
  for (const r of open) await reverifyRun(r.id, what, actorUserId);
}

// ── Previews ──

export interface Preview {
  slug: Slug;
  subject: PayrollApprovalSubject;
  title: string;
  runId: string;
  cycle: { start: string; end: string; label: string };
  runStatus: string;
  runStatusLabel: string;
  blockers: Blocker[];
  canRequest: boolean;
  /** Who could decide this, in words, and whether that is one person or nobody. */
  checkers: CheckerAvailability;
  authority: "DIRECTOR_AUTHORITY" | "SECOND_DIRECTOR";
  fingerprint: string;
  watermark: Watermark;
  totals: { gross: string; deductions: string; net: string; employerCost: string };
  counts: { people: number; payable: number; held: number; excluded: number; exceptions: number };
  /** The people the submit screen puts first. Only for the run. */
  leftOut?: Assessment["leftOut"];
  blockingExceptions?: Assessment["blockingExceptions"];
  held?: Assessment["held"];
  variance?: Awaited<ReturnType<typeof varianceJson>>;
  affected?: { people: number; payable: number; held: number; ownLine: { employeeId: string; name: string; net: string } | null; changes: Record<string, number> };
  [more: string]: unknown;
}

function statusBlocker(run: PayrollRun, need: string, doing: string): Blocker | null {
  if (run.status === need) return null;
  const now = RUN_STATUS_LABEL[run.status].toLowerCase();
  return { code: "RUN_STATE", title: "Not at this step", message: `This run is ${now}, so it cannot be ${doing} now.` };
}

async function envelope(slug: Slug, run: PayrollRun, actor: Actor, blockers: Blocker[], fingerprintHash: string, extra: Record<string, unknown>): Promise<Preview> {
  const subject = SUBJECT_OF[slug];
  const approval = await liveApproval(subject, run.id);
  const authority = await authorityForDisplay(STEP_OF[slug]);
  if (!blockers.some((b) => b.code === "DIRECTOR_CHOICE_NOT_SET")) blockers = [...(await choiceBlockers(slug === "run" ? "approved" : "carried out")), ...blockers];
  const checkers =
    authority === "DIRECTOR_AUTHORITY" && !approval
      ? ({ eligible: [], excluded: [], state: "SELF", message: "You can do this yourself. It takes effect at once, and the other director is told." } satisfies CheckerAvailability)
      : await checkerAvailability(subject, { makerUserId: approval ? approval.makerUserId : actor.userId, ...(approval ? { subjectId: run.id, since: approval.submittedAt } : {}) });
  const watermark = run.runHash === null ? { test: false, text: "", rules: [] } : watermarkFromStatuses(await pinStatuses(pinsOf(run)));
  return {
    slug,
    subject,
    title: LABEL[slug],
    runId: run.id,
    cycle: { start: iso(run.cycleStart), end: iso(run.cycleEnd), label: run.cycleLabel },
    runStatus: run.status,
    runStatusLabel: RUN_STATUS_LABEL[run.status],
    blockers,
    canRequest: blockers.length === 0,
    /** Who decides this step now: one director alone ("DIRECTOR_AUTHORITY") or the other director too ("SECOND_DIRECTOR"). */
    authority,
    checkers,
    fingerprint: payrollHash({ t: `close:${slug}`, run: run.id, hash: fingerprintHash }),
    watermark,
    totals: { gross: m(run.totalGross), deductions: m(run.totalDeductions), net: m(run.totalNet), employerCost: m(run.totalEmployerCost) },
    counts: { people: run.peopleCount, payable: run.payableCount, held: run.heldCount, excluded: run.excludedCount, exceptions: run.exceptionCount },
    ...extra,
  };
}

/** Payroll does not run while the two directors have not both chosen, for every step that can commit money or change pay rules, who decides it. */
async function choiceBlockers(action: string): Promise<Blocker[]> {
  const unset = await unsetRequiredSteps();
  if (unset.length === 0) return [];
  return [{ code: "DIRECTOR_CHOICE_NOT_SET", title: "Who decides each step is not set", message: `The two directors have not both chosen, and confirmed, who decides: ${unset.map((u) => u.label).join("; ")}. One sets it, the other confirms it (Admin Tools, Director authority). Until then the run cannot be ${action}.` }];
}

async function realBlocker(run: PayrollRun, action: string): Promise<Blocker[]> {
  const unsetChoice = await choiceBlockers(action);
  if (unsetChoice.length > 0) return unsetChoice;
  try {
    await assertRunIsReal(pinsOf(run), action);
    return [];
  } catch (err) {
    if (!(err instanceof HttpError)) throw err;
    return [{ code: err.code ?? "RULES", title: err.code === "RULES_CHANGED" ? "A rule has changed" : "Placeholder rules", message: err.message, ...(err.details ? { details: err.details as Record<string, unknown> } : {}) }];
  }
}

export async function previewStep(slug: Slug, runId: string, actor: Actor): Promise<Preview> {
  const run = await loadRun(runId);
  if (slug === "run") {
    const blockers: Blocker[] = [];
    // A run that is already waiting (or approved) is shown to its checker with the same content the maker saw; it just cannot be submitted again.
    const review = run.status === "SUBMITTED" || run.status === "APPROVED";
    const wrong = review ? null : statusBlocker(run, "CALCULATED", "submitted for approval");
    if (wrong) return envelope(slug, run, actor, [wrong], payrollHash({ state: run.status }), {});
    const a = await assessForSubmission(run);
    blockers.push(...a.blockers);
    const variance = await varianceJson(run.id, { page: 1, pageSize: 25, changedOnly: false, flaggedOnly: true });
    const own = await employeeIdOfUser(actor.userId);
    const mine = own ? await prisma.payrollRunItem.findUnique({ where: { runId_employeeId: { runId: run.id, employeeId: own } } }) : null;
    const names = mine ? ((await namesOn([mine.employeeId], run.cycleEnd)).get(mine.employeeId) ?? null) : null;
    const people = run.peopleCount;
    const out = await envelope(slug, run, actor, blockers, a.computed.runHash, {
      review,
      leftOut: a.leftOut,
      blockingExceptions: a.blockingExceptions,
      held: a.held,
      variance,
      affected: { people, payable: a.payable, held: a.held.length, ownLine: mine ? { employeeId: mine.employeeId, name: names ?? mine.employeeId, net: m(mine.netPay) } : null, changes: variance.tagCounts },
    });
    if (review) out.canRequest = false;
    return out;
  }

  if (slug === "finalise") {
    const wrong = statusBlocker(run, "APPROVED", "finalised");
    if (wrong) return envelope(slug, run, actor, [wrong], payrollHash({ state: run.status }), {});
    const blockers: Blocker[] = [];
    const approval = await prisma.payrollApproval.findFirst({ where: { subject: "RUN_APPROVAL", subjectId: run.id, status: "APPROVED" } });
    const live = await liveHashOf(run);
    if (!approval || approval.hashAtDecision !== live || run.runHash !== live) {
      blockers.push({ code: "RUN_STALE", title: "The figures have moved", message: "The figures changed after they were approved, so the approval is void. Reopen the run, calculate it again and have it approved again." });
      await reverifyRun(run.id, "the figures no longer match what was approved", null);
    }
    blockers.push(...(await realBlocker(run, "finalised")));
    const inRun = (await prisma.payrollRunItem.findMany({ where: { runId: run.id, status: { not: "EXCLUDED" } }, select: { employeeId: true } })).map((i) => i.employeeId);
    const adjustments = await prisma.payrollAdjustment.findMany({ where: { status: "PENDING", employeeId: { in: inRun } }, select: { source: true } });
    const bySource: Record<string, number> = {};
    for (const a of adjustments) bySource[a.source] = (bySource[a.source] ?? 0) + 1;
    return envelope(slug, run, actor, blockers, finaliseHash(run, live), {
      approvedBy: approval ? ((await namesOfUsers([approval.checkerUserId ?? ""])).get(approval.checkerUserId ?? "") ?? "Someone") : null,
      lock: { from: iso(run.cycleStart), to: iso(run.cycleEnd), refuses: ["Changes to someone's job, name, bank account, salary or separation dated inside these days.", "Attendance for these days stays as finalised; unlocking it later shows a warning that payroll has used it."] },
      adjustmentsMarkedPaid: { count: adjustments.length, bySource },
    });
  }

  if (slug === "unlock") {
    const wrong = statusBlocker(run, "FINALISED", "unlocked");
    if (wrong) return envelope(slug, run, actor, [wrong], payrollHash({ state: run.status }), {});
    const releases = await releasesOf(run.id);
    const blockers: Blocker[] = [];
    if (releases.length > 0) {
      const what = [...new Set(releases.map((r) => (r.kind === "PAYSLIPS_PUBLISHED" ? "payslips have been published" : "a bank file has been generated")))].join(" and ");
      blockers.push({ code: "RUN_RELEASED", title: "This period can no longer be unlocked", message: `${what[0]!.toUpperCase()}${what.slice(1)} for this period, so it cannot be unlocked. Put corrections through an adjustment in the next run.` });
    }
    const consumed = await prisma.payrollAdjustment.count({ where: { consumedByRunId: run.id } });
    return envelope(slug, run, actor, blockers, payrollHash({ run: run.id, status: run.status, releases: releases.map((r) => r.kind) }), {
      allows: [
        "History changes, cancellations and separations dated inside the period are allowed again.",
        "This final run is set aside as a record of what was once final. A new run can be calculated for the period.",
        `${consumed} ${consumed === 1 ? "adjustment" : "adjustments"} this run paid become owed again.`,
        "An approval waiting to publish the payslips or make the bank file is withdrawn.",
        "Attendance for the period stays finalised. Unlocking that is a separate step, and no longer warns that payroll used it.",
      ],
      adjustmentsReturned: consumed,
    });
  }

  // Publishing payslips and the bank file: from a final run only. The approval is bound to exactly what the act will write (payslip content, or the bank rows and layout).
  const wrong = statusBlocker(run, "FINALISED", slug === "publish" ? "published" : "turned into a bank file");
  if (wrong) return envelope(slug, run, actor, [wrong], payrollHash({ state: run.status }), {});
  const blockers = await realBlocker(run, slug === "publish" ? "published" : "turned into a bank file");
  const releases = await releasesOf(run.id);
  if (slug === "publish") {
    if (releases.some((r) => r.kind === "PAYSLIPS_PUBLISHED")) blockers.push({ code: "ALREADY_RELEASED", title: "Already published", message: "The payslips for this period have already been published." });
    const slips = await buildPayslips(run);
    const noPayslip = await peopleWithoutPayslip(run);
    if (slips.size === 0) blockers.push({ code: "NO_PAYSLIPS", title: "Nobody to publish payslips to", message: "Nobody in this run is payable, so there are no payslips to publish." });
    return envelope(slug, run, actor, blockers, await adapterFor("PAYSLIP_PUBLISH").hash(run.id), {
      payslips: slips.size,
      netTotal: canonicalDecimal([...slips.values()].reduce((a, v) => a.plus(dec(v.content.totals.net)), dec("0"))),
      noPayslip,
      willDo: ["Each payable person can read their own payslip the moment this is carried out; nobody else can.", "A PDF of each is prepared in the background and the person is told, in the app and by email. The email has no figure in it.", "From then on this period can no longer be unlocked. A correction goes through an adjustment in the next run."],
    });
  }
  const plan = await planBank(run);
  if (releases.some((r) => r.kind === "BANK_FILE_GENERATED")) blockers.push({ code: "ALREADY_RELEASED", title: "Already generated", message: "A bank file has already been generated for this period." });
  if (!plan.template.ready) {
    blockers.push({
      code: "BANK_TEMPLATE_PLACEHOLDER",
      title: "The bank file layout is not confirmed",
      message: plan.template.status === "NOT_SET" ? "The layout of the bank file has not been entered yet. It comes from your bank's own specification or a sample file; once entered, a second person must confirm it." : "The layout of the bank file has been entered but not confirmed by a second person yet, so a bank file cannot be asked for.",
    });
  }
  if (plan.paymentDate === null) blockers.push({ code: "PAYMENT_DATE_UNSET", title: "The payment date is not set", message: "The rule \"Payment date\" has no value, so it is not known which bank account applies. Set and confirm it under Rules and setup, then calculate the run again." });
  if (plan.rows.length === 0) blockers.push({ code: "NOTHING_TO_PAY", title: "No rows for the file", message: "Nobody in this run has a bank account in force on the payment date, so the file would be empty." });
  return envelope(slug, run, actor, blockers, await adapterFor("BANK_FILE").hash(run.id), {
    rows: plan.rows.length,
    rowsTotal: plan.total,
    paymentDate: plan.paymentDate,
    excluded: plan.excluded,
    held: plan.held,
    people: plan.rows.map((r) => ({ employeeCode: r.employeeCode, name: r.name, bankName: r.bankName, accountLast4: r.accountLast4, ifsc: r.ifsc, amount: r.amount })),
    willDo: ["A file is made in the layout your bank gave, from exactly these rows. The account numbers are read from the encrypted store only while the file is being written, and each is logged.", "Nothing is sent anywhere. HR downloads the file and uploads it to the bank's own net banking.", "From then on this period can no longer be unlocked."],
  });
}

// ── Requesting ──

export async function requireHolds(userId: string, permission: string): Promise<void> {
  if (!(await resolveAccess(userId)).permissions.has(permission)) throw new HttpError(403, `Missing permission: ${permission}`, "FORBIDDEN");
}

export async function requestStep(slug: Slug, runId: string, input: { fingerprint: string; note?: string | undefined }, actor: Actor) {
  const subject = SUBJECT_OF[slug];
  await requireHolds(actor.userId, MAKER_PERMISSION[slug]);
  const note = (input.note ?? "").trim();
  if (slug === "unlock" && note.length < 5) throw new HttpError(400, "Say why the period is being unlocked (a few words).", "VALIDATION_ERROR");
  const run = await loadRun(runId);
  // The checks are made again here, from scratch: a preview is a courtesy, never the thing that was trusted.
  const p = await previewStep(slug, runId, actor);
  if (p.review) throw new HttpError(409, "This run has already been sent for approval.", "RUN_STATE");
  const first = p.blockers[0];
  if (first) throw new HttpError(409, first.message, first.code, { blockers: p.blockers, ...(first.details ?? {}) });
  if (p.fingerprint !== input.fingerprint) throw new HttpError(409, "Something changed since you looked. Look at it again before you go on.", "PREVIEW_STALE");
  const runStep = async (tx: Parameters<NonNullable<Parameters<typeof submitApproval>[0]["inTransaction"]>>[0], to: "SUBMITTED" | "APPROVED") => {
    const { count } = await tx.payrollRun.updateMany({ where: { id: runId, status: "CALCULATED", runHash: run.runHash }, data: { status: to } });
    if (count !== 1) throw new HttpError(409, "This run was just changed by somebody else. Look at it again.", "CONFLICT");
  };
  // Director authority (docs/plans/DIRECTOR_AUTHORITY.md §5.3): unless the owners have switched the second-director check on for this step, the director prepares and decides in
  // one act, at once; the approval is recorded as such, the other director is told, and the hash is still bound and re-checked when the act is carried out.
  if ((await authorityFor(STEP_OF[slug])) === "DIRECTOR_AUTHORITY") {
    const approved = await authorise({
      subject,
      subjectId: runId,
      actorUserId: actor.userId,
      previewFingerprint: input.fingerprint,
      step: STEP_OF[slug],
      subjectLabel: await adapterFor(subject).describe(runId),
      itemCount: slug === "bank-file" || slug === "publish" ? run.payableCount : run.peopleCount,
      note,
      ip: actor.ip ?? null,
      ...(slug === "run" ? { inTransaction: async (tx) => runStep(tx, "APPROVED") } : {}),
    });
    await writeAuditLog({ actorUserId: actor.userId, action: `payroll.run.${slug === "run" ? "approved_on_authority" : `${slug}_authorised`}`, entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, hash: approved.contentHash, authority: "DIRECTOR_AUTHORITY" }, ipAddress: actor.ip ?? null });
    emitTo(["payroll.run", "payroll.approve"], "payroll.approval.decided", { runId, slug, cycle: run.cycleLabel, decision: "APPROVED" });
    return { approvalId: approved.id, status: approved.status, authority: "DIRECTOR_AUTHORITY" as const, runStatus: slug === "run" ? "APPROVED" : run.status };
  }
  const approval = await submitApproval({
    subject,
    subjectId: runId,
    makerUserId: actor.userId,
    previewFingerprint: input.fingerprint,
    note,
    ip: actor.ip ?? null,
    notify: { step: STEP_OF[slug], subjectLabel: await adapterFor(subject).describe(runId), itemCount: slug === "bank-file" || slug === "publish" ? run.payableCount : run.peopleCount },
    ...(slug === "run"
      ? {
          inTransaction: async (tx) => {
            const { count } = await tx.payrollRun.updateMany({ where: { id: runId, status: "CALCULATED", runHash: run.runHash }, data: { status: "SUBMITTED" } });
            if (count !== 1) throw new HttpError(409, "This run was just changed by somebody else. Look at it again.", "CONFLICT");
          },
        }
      : {}),
  });
  await writeAuditLog({ actorUserId: actor.userId, action: `payroll.run.${slug === "run" ? "submitted" : `${slug}_requested`}`, entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, hash: approval.contentHash, ...(slug === "unlock" ? { reason: note } : {}) }, ipAddress: actor.ip ?? null });
  emitTo(["payroll.approve"], "payroll.approval.requested", { runId, slug, cycle: run.cycleLabel });
  return { approvalId: approval.id, status: approval.status, authority: "SECOND_DIRECTOR" as const, runStatus: slug === "run" ? "SUBMITTED" : run.status };
}

// ── Deciding ──

export async function decideStep(slug: Slug, runId: string, input: { decision: "APPROVE" | "REJECT"; note?: string | undefined; hash?: string | undefined }, actor: Actor) {
  const subject = SUBJECT_OF[slug];
  const run = await loadRun(runId);
  if (slug === "run" || slug === "finalise") {
    // A stale approval is voided here, not approved.
    if ((await reverifyRun(runId, "the figures changed before they were decided", null)).voided) {
      throw new HttpError(409, "The figures changed after they were submitted, so this approval is void. They need to be submitted again.", "APPROVAL_VOIDED");
    }
  }
  const approval = await liveApproval(subject, runId);
  if (!approval || approval.status !== "PENDING") throw new HttpError(409, "Nothing is waiting for a decision here.", "NOTHING_PENDING");
  if (input.decision === "APPROVE" && !input.hash) throw new HttpError(400, "Approving needs the hash of the figures you were shown.", "VALIDATION_ERROR");
  if (input.decision === "APPROVE") await realBlockerOrThrow(run, slug);
  const decided = await decideApproval({
    approvalId: approval.id,
    checkerUserId: actor.userId,
    decision: input.decision,
    ...(input.note !== undefined ? { note: input.note } : {}),
    ...(input.hash !== undefined ? { expectedHash: input.hash } : {}),
    ip: actor.ip ?? null,
    ...(slug === "run"
      ? {
          inTransaction: async (tx, a) => {
            const to = a.status === "APPROVED" ? "APPROVED" : "CALCULATED";
            const { count } = await tx.payrollRun.updateMany({ where: { id: runId, status: "SUBMITTED" }, data: { status: to } });
            if (count !== 1) throw new HttpError(409, "This run is no longer waiting for a decision.", "CONFLICT");
          },
        }
      : {}),
  });
  emitTo(["payroll.run"], "payroll.approval.decided", { runId, slug, cycle: run.cycleLabel, decision: decided.status });
  return { approvalId: decided.id, status: decided.status };
}

async function realBlockerOrThrow(run: PayrollRun, slug: Slug): Promise<void> {
  if (slug === "unlock") return;
  const b = await realBlocker(run, slug === "run" ? "approved" : slug === "finalise" ? "finalised" : slug === "publish" ? "published" : "turned into a bank file");
  if (b[0]) throw new HttpError(409, b[0].message, b[0].code, { blockers: b, ...(b[0].details ?? {}) });
}

// ── Withdrawing and reopening ──

async function liveFor(slug: Slug, runId: string): Promise<PayrollApproval[]> {
  const subjects: PayrollApprovalSubject[] = slug === "run" ? ["RUN_APPROVAL", "PERIOD_FINALISE"] : [SUBJECT_OF[slug]];
  const out: PayrollApproval[] = [];
  for (const s of subjects) {
    const a = await liveApproval(s, runId);
    if (a) out.push(a);
  }
  return out;
}

export async function withdrawPreview(slug: Slug, runId: string, actor: Actor) {
  void actor;
  const run = await loadRun(runId);
  const live = await liveFor(slug, runId);
  const names = await namesOfUsers(live.flatMap((a) => [a.makerUserId, ...(a.checkerUserId ? [a.checkerUserId] : [])]));
  return {
    slug,
    runId,
    cycle: run.cycleLabel,
    runStatus: run.status,
    willVoid: live.map((a) => ({ approvalId: a.id, subject: a.subject, status: a.status, maker: names.get(a.makerUserId) ?? "Someone", checker: a.checkerUserId ? (names.get(a.checkerUserId) ?? "Someone") : null, decidedAt: a.decidedAt?.toISOString() ?? null })),
    runWill: slug === "run" && (run.status === "SUBMITTED" || run.status === "APPROVED") ? "go back to a calculated draft, so it can be recalculated" : null,
    fingerprint: payrollHash({ t: `withdraw:${slug}`, run: runId, approvals: live.map((a) => [a.id, a.status]) }),
  };
}

export async function withdrawStep(slug: Slug, runId: string, input: { reason: string; fingerprint: string }, actor: Actor) {
  await requireHolds(actor.userId, MAKER_PERMISSION[slug]);
  const reason = input.reason.trim();
  if (reason.length < 3) throw new HttpError(400, "Say why (a few words).", "VALIDATION_ERROR");
  const run = await loadRun(runId);
  const p = await withdrawPreview(slug, runId, actor);
  if (p.willVoid.length === 0) throw new HttpError(409, "Nothing is waiting or approved here to withdraw.", "NOTHING_PENDING");
  if (p.fingerprint !== input.fingerprint) throw new HttpError(409, "Something changed since you looked. Look at it again.", "PREVIEW_STALE");
  await prisma.$transaction(async (tx) => {
    for (const a of await liveFor(slug, runId)) await voidApproval(a, reason, actor.userId, tx);
    await recordEvent({ subjectType: "PAYROLL_RUN", subjectId: runId, type: slug === "run" && run.status === "APPROVED" ? "REOPENED" : "WITHDRAWN", actorUserId: actor.userId, payload: { slug, reason } }, tx);
  });
  await writeAuditLog({ actorUserId: actor.userId, action: slug === "run" && run.status === "APPROVED" ? "payroll.run.reopened" : "payroll.run.withdrawn", entityType: "PayrollRun", entityId: runId, after: { cycle: run.cycleLabel, slug, reason }, ipAddress: actor.ip ?? null });
  emitTo(["payroll.run", "payroll.approve"], "payroll.approval.withdrawn", { runId, slug, cycle: run.cycleLabel });
  return { ok: true, runStatus: (await loadRun(runId)).status };
}

// ── The state of every approval on a run, for its screen ──

export interface ApprovalView {
  id: string;
  status: string;
  hash: string;
  maker: { userId: string; name: string };
  submittedAt: string;
  note: string;
  checker: { userId: string; name: string } | null;
  decidedAt: string | null;
  decisionNote: string | null;
  voidedAt: string | null;
  voidReason: string | null;
  consumedAt: string | null;
}

export async function approvalState(runId: string, viewerUserId: string) {
  await reverifyRun(runId, "the figures changed", null);
  const run = await loadRun(runId);
  const access = await resolveAccess(viewerUserId);
  const subjectsPresent = await prisma.payrollApproval.findMany({ where: { subjectId: runId, subject: { in: Object.values(SUBJECT_OF) } }, orderBy: { submittedAt: "desc" } });
  const names = await namesOfUsers(subjectsPresent.flatMap((a) => [a.makerUserId, ...(a.checkerUserId ? [a.checkerUserId] : [])]));
  const view = (a: PayrollApproval): ApprovalView => ({
    id: a.id,
    status: a.status,
    hash: a.contentHash,
    maker: { userId: a.makerUserId, name: names.get(a.makerUserId) ?? "Someone" },
    submittedAt: a.submittedAt.toISOString(),
    note: a.submitNote,
    checker: a.checkerUserId ? { userId: a.checkerUserId, name: names.get(a.checkerUserId) ?? "Someone" } : null,
    decidedAt: a.decidedAt?.toISOString() ?? null,
    decisionNote: a.decisionNote,
    voidedAt: a.voidedAt?.toISOString() ?? null,
    voidReason: a.voidReason,
    consumedAt: a.consumedAt?.toISOString() ?? null,
  });
  const steps = [];
  for (const slug of SLUGS) {
    const subject = SUBJECT_OF[slug];
    const mine = subjectsPresent.filter((a) => a.subject === subject);
    const live = mine.find((a) => a.status === "PENDING" || a.status === "APPROVED") ?? null;
    const last = mine.find((a) => a.status !== "PENDING" && a.status !== "APPROVED") ?? null;
    const editors = live ? await figureEditorsSince(subject, runId, live.submittedAt) : new Set<string>();
    // Who could decide it: for a request waiting, excluding its maker and anyone who changed the figures; for one not yet asked, as it would be if the viewer asked.
    const authority = await authorityForDisplay(STEP_OF[slug]);
    const checkers = live
      ? live.status === "PENDING"
        ? await checkerAvailability(subject, { makerUserId: live.makerUserId, subjectId: runId, since: live.submittedAt })
        : null
      : authority === "DIRECTOR_AUTHORITY"
        ? ({ eligible: [], excluded: [], state: "SELF", message: "You can do this yourself. It takes effect at once, and the other director is told." } satisfies CheckerAvailability)
        : await checkerAvailability(subject, { makerUserId: access.permissions.has(MAKER_PERMISSION[slug]) ? viewerUserId : null });
    steps.push({
      slug,
      subject,
      label: LABEL[slug],
      /** The mode in force now (an approval already written keeps the mode it was written under: see live.authority). */
      authority,
      live: live ? { ...view(live), authority: live.authority } : null,
      last: last ? view(last) : null,
      checkers,
      you: {
        canMake: access.permissions.has(MAKER_PERMISSION[slug]),
        canDecide: live?.status === "PENDING" && access.permissions.has("payroll.approve") && live.makerUserId !== viewerUserId && !editors.has(viewerUserId),
        isMaker: live?.makerUserId === viewerUserId,
        editedFigures: editors.has(viewerUserId),
      },
    });
  }
  return { runId, runStatus: run.status, runStatusLabel: RUN_STATUS_LABEL[run.status], cycle: run.cycleLabel, steps };
}
