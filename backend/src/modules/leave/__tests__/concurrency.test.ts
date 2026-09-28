import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { consumeCompOffFifo, creditCompOff } from "../compOff";
import { withEmployeeLeaveLock } from "../concurrency";
import { InsufficientLeaveBalanceError } from "../ledger";
import { cleanupMinimalTestEmployee, createMinimalTestEmployee, utcDate } from "./leaveTestHelpers";

describe("concurrency — withEmployeeLeaveLock serializes racing writes for one employee", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("two simultaneous approvals against a balance that can satisfy only one: exactly one succeeds, the ledger never goes negative", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    // Exactly 1.0 day available — enough for only one of the two 1.0-day
    // "approvals" firing concurrently below.
    await creditCompOff({ employeeId, earnedDate: utcDate("2026-06-01"), hoursWorked: 8, source: "MANUAL_GRANT" });

    const attemptApproval = (requestId: string) => withEmployeeLeaveLock(employeeId, (tx) => consumeCompOffFifo(tx, employeeId, requestId, 1, 2026, utcDate("2026-08-01")));

    const results = await Promise.allSettled([attemptApproval(randomUUID()), attemptApproval(randomUUID())]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(InsufficientLeaveBalanceError);

    const credit = await prisma.compOffCredit.findFirstOrThrow({ where: { employeeId } });
    expect(credit.remainingDays.toNumber()).toBe(0); // consumed exactly once, never pushed negative
    expect(credit.status).toBe("CONSUMED");

    const consumedEntries = await prisma.leaveLedger.findMany({ where: { compOffCreditId: credit.id, entryType: "CONSUMED" } });
    expect(consumedEntries).toHaveLength(1); // only the winning attempt wrote a ledger row
  });

  it("a concurrent approve and a concurrent grant for the same employee both apply correctly, serialized rather than racing", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await creditCompOff({ employeeId, earnedDate: utcDate("2026-06-01"), hoursWorked: 8, source: "MANUAL_GRANT" });

    const [consumeResult] = await Promise.allSettled([
      withEmployeeLeaveLock(employeeId, (tx) => consumeCompOffFifo(tx, employeeId, randomUUID(), 1, 2026, utcDate("2026-08-01"))),
      creditCompOff({ employeeId, earnedDate: utcDate("2026-07-01"), hoursWorked: 8, source: "MANUAL_GRANT" }),
    ]);

    expect(consumeResult.status).toBe("fulfilled");
    const credits = await prisma.compOffCredit.findMany({ where: { employeeId } });
    expect(credits).toHaveLength(2); // both the original grant's lot and the new concurrent grant exist
    const totalRemaining = credits.reduce((sum, c) => sum + c.remainingDays.toNumber(), 0);
    expect(totalRemaining).toBe(1); // 2 earned, 1 consumed
  });
});
