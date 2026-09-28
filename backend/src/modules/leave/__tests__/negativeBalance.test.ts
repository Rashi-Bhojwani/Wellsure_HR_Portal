import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { assertSufficientBalance, InsufficientLeaveBalanceError, writeLedgerEntry } from "../ledger";
import { cleanupMinimalTestEmployee, createMinimalTestEmployee, utcDate } from "./leaveTestHelpers";

describe("negative-balance prevention (spec §5.2) and LOP's no-balance rule", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("rejects a request that would exceed balance when negativeBalanceAllowed is false", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: utcDate("2026-01-01"), entryType: "ACCRUAL", days: 1 });

    await expect(assertSufficientBalance(prisma, employeeId, plType.id, { skipBalanceCheck: false, negativeBalanceAllowed: false }, 2)).rejects.toThrow(InsufficientLeaveBalanceError);
  });

  it("allows exactly using up the full balance (not exceeding it)", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: utcDate("2026-01-01"), entryType: "ACCRUAL", days: 2 });

    await expect(assertSufficientBalance(prisma, employeeId, plType.id, { skipBalanceCheck: false, negativeBalanceAllowed: false }, 2)).resolves.toBeUndefined();
  });

  it("allows exceeding balance when the policy explicitly permits negative balance", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    // No accrual at all — balance is 0.

    await expect(assertSufficientBalance(prisma, employeeId, plType.id, { skipBalanceCheck: false, negativeBalanceAllowed: true }, 10)).resolves.toBeUndefined();
  });

  it("LOP's skipBalanceCheck always succeeds regardless of balance — it has no balance concept at all", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const lopType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "LOP" }, include: { policy: true } });

    expect(lopType.policy?.skipBalanceCheck).toBe(true);
    await expect(assertSufficientBalance(prisma, employeeId, lopType.id, lopType.policy!, 999)).resolves.toBeUndefined();
  });
});
