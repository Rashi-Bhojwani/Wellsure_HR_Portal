import { prisma } from "../../../lib/prisma";

/** A settled day with `excess` minutes beyond a 10:00–19:00 shift (made directly: the engine is not under test here). */
export async function settledDay(employeeId: string, date: string, excess: number, provisional = false) {
  await prisma.dailyAttendance.upsert({
    where: { employeeId_date: { employeeId, date: new Date(`${date}T00:00:00Z`) } },
    create: { employeeId, date: new Date(`${date}T00:00:00Z`), shiftCode: "GEN", shiftStart: "10:00", shiftEnd: "19:00", status: "P", source: "DEVICE", capture: "DEVICE", excessMinutes: excess, actualMinutes: 540 + excess, provisional, engineVersion: 1 },
    update: { excessMinutes: excess, provisional },
  });
}

/** Turns the overtime policy on or off directly (two different directors, as the store requires). */
export async function overtimePolicy(value: Record<string, unknown>, proposerUserId: string, confirmerUserId: string) {
  const p = await prisma.behaviourProposal.create({ data: { key: "policy.overtime", value: value as object, reason: "Test setting", proposedByUserId: proposerUserId } });
  await prisma.behaviourConfirmation.create({ data: { proposalId: p.id, confirmedByUserId: confirmerUserId } });
}
