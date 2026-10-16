import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";

// Fixtures for the payroll tests. Payroll's own tables are append-only and shared with every other test file (and with the shipped
// Placeholders), so each test removes exactly the rows its own users made, by id, through the guarded delete: the shipped state is
// whatever it was before the test ran.

export async function cleanupPayrollRowsBy(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  const ids = async (rows: Promise<Array<{ id: string }>>) => (await rows).map((r) => r.id);
  await deleteWithDependents("PayrollItemConfirmation", await ids(prisma.payrollItemConfirmation.findMany({ where: { confirmedByUserId: { in: userIds } }, select: { id: true } })));
  await deleteWithDependents("PayrollItemVersion", await ids(prisma.payrollItemVersion.findMany({ where: { authorUserId: { in: userIds } }, select: { id: true } })));
  await deleteWithDependents(
    "PayrollApproval",
    await ids(prisma.payrollApproval.findMany({ where: { OR: [{ makerUserId: { in: userIds } }, { checkerUserId: { in: userIds } }] }, select: { id: true } })),
  );
  await deleteWithDependents("PayrollEvent", await ids(prisma.payrollEvent.findMany({ where: { actorUserId: { in: userIds } }, select: { id: true } })));
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
