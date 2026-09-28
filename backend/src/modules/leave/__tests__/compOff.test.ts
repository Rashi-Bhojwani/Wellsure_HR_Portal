import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { consumeCompOffFifo, creditCompOff, expireCompOffCredits, InsufficientHoursForCompOffError, reverseCompOffConsumption } from "../compOff";
import { InsufficientLeaveBalanceError } from "../ledger";
import { cleanupMinimalTestEmployee, createMinimalTestEmployee, utcDate } from "./leaveTestHelpers";

describe("comp-off — FIFO lot tracking, reversal, and expiry", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("creditCompOff rejects hours below the policy minimum", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await expect(creditCompOff({ employeeId, earnedDate: utcDate("2026-08-15"), hoursWorked: 2, source: "MANUAL_GRANT" })).rejects.toThrow(InsufficientHoursForCompOffError);
  });

  it("FIFO consumes the oldest lot first, splitting across two lots when one isn't enough", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const older = await creditCompOff({ employeeId, earnedDate: utcDate("2026-06-01"), hoursWorked: 8, source: "MANUAL_GRANT" });
    const newer = await creditCompOff({ employeeId, earnedDate: utcDate("2026-07-01"), hoursWorked: 8, source: "MANUAL_GRANT" });
    const leaveRequestId = randomUUID();

    await prisma.$transaction((tx) => consumeCompOffFifo(tx, employeeId, leaveRequestId, 1.5, 2026, utcDate("2026-08-01")));

    const olderRow = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: older.id } });
    const newerRow = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: newer.id } });
    expect(olderRow.remainingDays.toNumber()).toBe(0);
    expect(olderRow.status).toBe("CONSUMED");
    expect(newerRow.remainingDays.toNumber()).toBe(0.5);
    expect(newerRow.status).toBe("AVAILABLE");

    const consumedEntries = await prisma.leaveLedger.findMany({ where: { referenceType: "LEAVE_REQUEST", referenceId: leaveRequestId, entryType: "CONSUMED" } });
    expect(consumedEntries).toHaveLength(2);
    const byCredit = new Map(consumedEntries.map((e) => [e.compOffCreditId, e.days.toNumber()]));
    expect(byCredit.get(older.id)).toBe(-1);
    expect(byCredit.get(newer.id)).toBe(-0.5);
  });

  it("throws InsufficientLeaveBalanceError and writes nothing when lots can't cover the request", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const credit = await creditCompOff({ employeeId, earnedDate: utcDate("2026-06-01"), hoursWorked: 8, source: "MANUAL_GRANT" });
    const leaveRequestId = randomUUID();

    await expect(prisma.$transaction((tx) => consumeCompOffFifo(tx, employeeId, leaveRequestId, 2, 2026, utcDate("2026-08-01")))).rejects.toThrow(InsufficientLeaveBalanceError);

    const row = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(row.remainingDays.toNumber()).toBe(1); // untouched — the failed transaction rolled back
    const consumedEntries = await prisma.leaveLedger.findMany({ where: { referenceType: "LEAVE_REQUEST", referenceId: leaveRequestId } });
    expect(consumedEntries).toHaveLength(0);
  });

  it("reversal restores exactly the lots a specific request's approval touched", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const older = await creditCompOff({ employeeId, earnedDate: utcDate("2026-06-01"), hoursWorked: 8, source: "MANUAL_GRANT" });
    const newer = await creditCompOff({ employeeId, earnedDate: utcDate("2026-07-01"), hoursWorked: 8, source: "MANUAL_GRANT" });
    const leaveRequestId = randomUUID();

    await prisma.$transaction((tx) => consumeCompOffFifo(tx, employeeId, leaveRequestId, 1.5, 2026, utcDate("2026-08-01")));
    await prisma.$transaction((tx) => reverseCompOffConsumption(tx, leaveRequestId, 2026, utcDate("2026-08-05")));

    const olderRow = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: older.id } });
    const newerRow = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: newer.id } });
    expect(olderRow.remainingDays.toNumber()).toBe(1);
    expect(olderRow.status).toBe("AVAILABLE");
    expect(newerRow.remainingDays.toNumber()).toBe(1);
    expect(newerRow.status).toBe("AVAILABLE");

    const reversalEntries = await prisma.leaveLedger.findMany({ where: { referenceType: "LEAVE_REQUEST", referenceId: leaveRequestId, entryType: "REVERSAL" } });
    expect(reversalEntries).toHaveLength(2);
  });

  it("expiry debits only genuinely-unconsumed remainingDays on a lot past its expiry date", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    // compOffExpiryDays is seeded as 60 — earn it far enough in the past that it's already expired.
    const credit = await creditCompOff({ employeeId, earnedDate: utcDate("2026-01-01"), hoursWorked: 8, source: "MANUAL_GRANT" });

    const { expired } = await expireCompOffCredits(utcDate("2026-06-01"));
    expect(expired).toBeGreaterThanOrEqual(1);

    const row = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(row.status).toBe("EXPIRED");
    expect(row.remainingDays.toNumber()).toBe(0);
    const expiryEntries = await prisma.leaveLedger.findMany({ where: { compOffCreditId: credit.id, entryType: "EXPIRY" } });
    expect(expiryEntries).toHaveLength(1);
    expect(expiryEntries[0]!.days.toNumber()).toBe(-1);
  });

  it("a fully-consumed lot never resurfaces in the expiry job", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const credit = await creditCompOff({ employeeId, earnedDate: utcDate("2026-01-01"), hoursWorked: 8, source: "MANUAL_GRANT" });
    const leaveRequestId = randomUUID();
    await prisma.$transaction((tx) => consumeCompOffFifo(tx, employeeId, leaveRequestId, 1, 2026, utcDate("2026-01-15")));

    // The lot's expiresOn (60 days after 1 Jan) has already passed by June,
    // but it was fully consumed via ordinary leave weeks before that.
    await expireCompOffCredits(utcDate("2026-06-01"));

    const row = await prisma.compOffCredit.findUniqueOrThrow({ where: { id: credit.id } });
    expect(row.status).toBe("CONSUMED"); // never flipped to EXPIRED
    const expiryEntries = await prisma.leaveLedger.findMany({ where: { compOffCreditId: credit.id, entryType: "EXPIRY" } });
    expect(expiryEntries).toHaveLength(0);
  });

  it("expiry is idempotent — running it twice doesn't double-debit", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const credit = await creditCompOff({ employeeId, earnedDate: utcDate("2026-01-01"), hoursWorked: 8, source: "MANUAL_GRANT" });

    await expireCompOffCredits(utcDate("2026-06-01"));
    await expireCompOffCredits(utcDate("2026-06-01")); // retry

    const expiryEntries = await prisma.leaveLedger.findMany({ where: { compOffCreditId: credit.id, entryType: "EXPIRY" } });
    expect(expiryEntries).toHaveLength(1);
  });
});
