import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { DIRECTOR_AUTHORITY_SETTING_KEY, DIRECTOR_STEPS } from "@shared/constants/directorAuthority";
import { prisma } from "../../../lib/prisma";

// Fixtures for the payroll tests. Payroll's own tables are append-only and shared with every other test file (and with the shipped
// Placeholders), so each test removes exactly the rows its own users made, by id, through the guarded delete: the shipped state is
// whatever it was before the test ran.

export async function cleanupPayrollRowsBy(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((r) => r.id);
  // What these directors' acts told the other director (and the receipts that go with each notice).
  await deleteWithDependents("DirectorActionNotice", await ids(prisma.directorActionNotice.findMany({ where: { actorUserId: { in: userIds } }, select: { id: true } })));
  // Salary holds and their releases, made by these directors (a release first: it points at its hold).
  const holdIds = await ids(prisma.payrollSalaryHold.findMany({ where: { heldByUserId: { in: userIds } }, select: { id: true } }));
  await deleteWithDependents("PayrollSalaryRelease", await ids(prisma.payrollSalaryRelease.findMany({ where: { OR: [{ holdId: { in: holdIds } }, { releasedByUserId: { in: userIds } }] }, select: { id: true } })));
  await deleteWithDependents("PayrollSalaryHold", holdIds);
  await deleteWithDependents("PayrollItemConfirmation", await ids(prisma.payrollItemConfirmation.findMany({ where: { confirmedByUserId: { in: userIds } }, select: { id: true } })));
  await deleteWithDependents("PayrollItemVersion", await ids(prisma.payrollItemVersion.findMany({ where: { authorUserId: { in: userIds } }, select: { id: true } })));
  await deleteWithDependents(
    "PayrollApproval",
    await ids(prisma.payrollApproval.findMany({ where: { OR: [{ makerUserId: { in: userIds } }, { checkerUserId: { in: userIds } }] }, select: { id: true } })),
  );
  await deleteWithDependents("PayrollEvent", await ids(prisma.payrollEvent.findMany({ where: { actorUserId: { in: userIds } }, select: { id: true } })));
  // Payroll runs these people made (their items and lines go with them), and the events that describe them.
  const runs = await ids(prisma.payrollRun.findMany({ where: { OR: [{ createdByUserId: { in: userIds } }, { calculatedByUserId: { in: userIds } }] }, select: { id: true } }));
  await deleteWithDependents("PayrollRun", runs);
  await deleteWithDependents("PayrollEvent", await ids(prisma.payrollEvent.findMany({ where: { subjectType: "PAYROLL_RUN", subjectId: { in: runs } }, select: { id: true } })));
  // Salary revisions these people made, and any salary rows they wrote (a person's own rows go with the person: see cleanupFullTestEmployee).
  const revisions = await ids(prisma.payrollSalaryRevision.findMany({ where: { createdByUserId: { in: userIds } }, select: { id: true } }));
  await deleteWithDependents("PayrollSalaryRevision", revisions);
  await deleteWithDependents("PayrollEvent", await ids(prisma.payrollEvent.findMany({ where: { subjectType: "SALARY_REVISION", subjectId: { in: revisions } }, select: { id: true } })));
}

/** Removes rows a test made with a fabricated subject id (no user involved). */
export async function cleanupPayrollSubject(subjectPrefix: string): Promise<void> {
  await deleteWithDependents("PayrollApproval", (await prisma.payrollApproval.findMany({ where: { subjectId: { startsWith: subjectPrefix } }, select: { id: true } })).map((r) => r.id));
  await deleteWithDependents("PayrollEvent", (await prisma.payrollEvent.findMany({ where: { subjectId: { startsWith: subjectPrefix } }, select: { id: true } })).map((r) => r.id));
}

/**
 * Puts the owners' second-director checks ON for every step, for tests that describe the two-director behaviour (a different director decides what one prepared), and returns
 * what puts the setting back. A new installation starts the other way round (a director acts alone, docs/plans/DIRECTOR_AUTHORITY.md §2), and the tests of that say so themselves.
 */
export async function useSecondDirectorChecks(on: boolean | Partial<Record<(typeof DIRECTOR_STEPS)[number], boolean>> = true): Promise<() => Promise<void>> {
  const before = await prisma.systemSetting.findUnique({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
  // Every step gets a CONFIRMED choice (true = a different director must decide, false = the acting director decides alone). A step not named is "alone", which is what an unset step
  // used to mean; the tests of "Not set" itself write nothing, or call setDirectorChoices directly.
  const mode = (s: (typeof DIRECTOR_STEPS)[number]) => ((typeof on === "boolean" ? on : on[s] === true) ? "SECOND_DIRECTOR" : "DIRECTOR_AUTHORITY");
  await setDirectorChoices(Object.fromEntries(DIRECTOR_STEPS.map((s) => [s, mode(s)])) as Record<string, "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY">);
  return async () => {
    if (before) await prisma.systemSetting.update({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY }, data: { value: before.value as object } });
    else await prisma.systemSetting.deleteMany({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
  };
}

/** Writes Confirmed choices straight into the setting (made-up ids: the setting holds no foreign keys). Steps not named are left Not set. */
export async function setDirectorChoices(modes: Partial<Record<(typeof DIRECTOR_STEPS)[number], "SECOND_DIRECTOR" | "DIRECTOR_AUTHORITY">>): Promise<void> {
  const at = new Date().toISOString(); // allow-clock: a test fixture
  const steps = Object.fromEntries(Object.entries(modes).map(([step, m]) => [step, { current: { mode: m, proposedBy: "test-proposer", proposedAt: at, confirmedBy: "test-confirmer", confirmedAt: at } }]));
  const value = { v: 2, steps };
  await prisma.systemSetting.upsert({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY }, create: { key: DIRECTOR_AUTHORITY_SETTING_KEY, value }, update: { value } });
}
