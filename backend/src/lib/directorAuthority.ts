import type { ApprovalAuthority, Prisma, PrismaClient } from "@prisma/client";
import { DIRECTOR_AUTHORITY_SETTING_KEY, DIRECTOR_STEPS, DIRECTOR_STEP_INFO, type DirectorStep, type DirectorSwitchView } from "@shared/constants/directorAuthority";
import { env } from "../config/env";
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

/** Two-step sign-in is required of every director outside development (the development laptop needs no authenticator app). */
export const twoFactorEnforced = (): boolean => env.APP_ENV !== "development";

export async function requireDirectorTwoFactor(userId: string, db: Db = prisma, enforced: boolean = twoFactorEnforced()): Promise<void> {
  if (!enforced) return;
  const user = await db.user.findUnique({ where: { id: userId }, select: { totpEnabled: true } });
  if (!user?.totpEnabled) throw new HttpError(403, "A director's actions need two-step sign-in. Turn it on for your account first (your profile, Security), then do this again.", "DIRECTOR_2FA_REQUIRED");
}

// ── The switches ──

type Switches = Partial<Record<DirectorStep, boolean>>;

export async function getSwitches(db: Db = prisma): Promise<Record<DirectorStep, boolean>> {
  const row = await db.systemSetting.findUnique({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
  const stored = (row?.value && typeof row.value === "object" && !Array.isArray(row.value) ? row.value : {}) as Switches;
  return Object.fromEntries(DIRECTOR_STEPS.map((s) => [s, stored[s] === true])) as Record<DirectorStep, boolean>;
}

export async function requiresSecondDirector(step: DirectorStep, db: Db = prisma): Promise<boolean> {
  return (await getSwitches(db))[step];
}

/** The authority an act of this step is made under, read now. Call it inside the transaction that records the act. */
export async function authorityFor(step: DirectorStep, db: Db = prisma): Promise<ApprovalAuthority> {
  return (await requiresSecondDirector(step, db)) ? "SECOND_DIRECTOR" : "DIRECTOR_AUTHORITY";
}

export async function listSwitches(db: Db = prisma): Promise<DirectorSwitchView[]> {
  const switches = await getSwitches(db);
  return DIRECTOR_STEPS.map((step) => ({ step, label: DIRECTOR_STEP_INFO[step].label, covers: DIRECTOR_STEP_INFO[step].covers, requireSecondDirector: switches[step] }));
}

export interface SwitchActor {
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Either director can switch any step either way at once (owner's answer to Q-DA-5, option a). The other director is told, a red banner is raised for them, and the
 * change is audited; none of it waits for anyone. Returns the notice id so the caller can deliver it after the response.
 */
export async function setSwitch(step: DirectorStep, requireSecondDirector: boolean, actor: SwitchActor): Promise<{ changed: boolean; noticeId: string | null }> {
  if (!(DIRECTOR_STEPS as readonly string[]).includes(step)) throw new HttpError(400, "Unknown step.", "VALIDATION_ERROR");
  await requireDirector(actor.userId, "change the second-director check");
  await requireDirectorTwoFactor(actor.userId);
  const { recordDirectorNotice, raiseDirectorBanner, scheduleDelivery } = await import("./directorNotices");
  const result = await prisma.$transaction(async (tx) => {
    const before = await getSwitches(tx);
    if (before[step] === requireSecondDirector) return { changed: false as const, noticeId: null, before: before[step] };
    const next = { ...before, [step]: requireSecondDirector };
    await tx.systemSetting.upsert({
      where: { key: DIRECTOR_AUTHORITY_SETTING_KEY },
      create: { key: DIRECTOR_AUTHORITY_SETTING_KEY, value: next as Prisma.InputJsonValue, updatedByUserId: actor.userId },
      update: { value: next as Prisma.InputJsonValue, updatedByUserId: actor.userId },
    });
    const { noticeId } = await recordDirectorNotice(
      {
        kind: "SWITCH_CHANGED",
        step,
        subjectType: "SecondDirectorSwitch",
        subjectId: step,
        subjectLabel: `the second-director check for “${DIRECTOR_STEP_INFO[step].label}” (now ${requireSecondDirector ? "ON" : "OFF"})`,
        actorUserId: actor.userId,
        detail: { from: before[step], to: requireSecondDirector },
      },
      tx,
    );
    await raiseDirectorBanner(
      {
        noticeId,
        kind: "director.switch_changed",
        targetUserId: actor.userId,
        summary: `A director switched the second-director check for “${DIRECTOR_STEP_INFO[step].label}” ${requireSecondDirector ? "ON" : "OFF"}.`,
      },
      tx,
    );
    return { changed: true as const, noticeId, before: before[step] };
  });
  if (result.changed) {
    await writeAuditLog({
      actorUserId: actor.userId,
      action: "director.switch.changed",
      entityType: "SystemSetting",
      entityId: DIRECTOR_AUTHORITY_SETTING_KEY,
      before: { step, requireSecondDirector: result.before },
      after: { step, requireSecondDirector },
      ipAddress: actor.ip ?? null,
      userAgent: actor.userAgent ?? null,
    });
    await scheduleDelivery(result.noticeId);
  }
  return { changed: result.changed, noticeId: result.noticeId };
}
