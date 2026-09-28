import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { getLeaveBalance, writeLedgerEntry } from "../ledger";
import { cleanupMinimalTestEmployee, createMinimalTestEmployee, utcDate } from "./leaveTestHelpers";

describe("leave ledger balance — always the sum of entries (spec §5.3), never a stored number", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("equals the sum of entries after an arbitrary sequence including reversals and backdated inserts", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });

    const write = (entryDate: string, entryType: "ACCRUAL" | "CONSUMED" | "REVERSAL" | "GRANT" | "DEBIT", days: number) =>
      writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: utcDate(entryDate), entryType, days });

    await write("2026-01-01", "ACCRUAL", 1); // running: 1
    await write("2026-02-01", "ACCRUAL", 1); // running: 2
    await write("2026-02-15", "CONSUMED", -1.5); // running: 0.5
    await write("2026-03-01", "ACCRUAL", 1); // running: 1.5
    await write("2026-02-20", "REVERSAL", 1.5); // a cancellation, backdated between the Feb entries: running 3.0

    const balance = await getLeaveBalance(prisma, employeeId, plType.id, utcDate("2026-12-31"));
    expect(balance.toNumber()).toBe(3);

    // Same result computed the manual way, as a cross-check that the
    // aggregate query and a plain sum genuinely agree.
    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plType.id } });
    const manualSum = rows.reduce((sum, r) => sum + r.days.toNumber(), 0);
    expect(manualSum).toBe(3);
  });

  it("as-of a date excludes later entries, including a later accrual month", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });

    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: utcDate("2026-11-01"), entryType: "ACCRUAL", days: 1 });
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: utcDate("2026-12-01"), entryType: "ACCRUAL", days: 1 });

    expect((await getLeaveBalance(prisma, employeeId, plType.id, utcDate("2026-11-15"))).toNumber()).toBe(1);
    expect((await getLeaveBalance(prisma, employeeId, plType.id, utcDate("2026-12-15"))).toNumber()).toBe(2);
  });

  it("is not scoped by leave_year — it's a reporting tag, not a balance partition", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });

    // Two entries both tagged leaveYear 2026 by convention, but the
    // balance function must never filter on that column — only entryDate.
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: utcDate("2026-12-31"), entryType: "ACCRUAL", days: 1 });
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plType.id, leaveYear: 2027, entryDate: utcDate("2027-01-01"), entryType: "ACCRUAL", days: 1 });

    expect((await getLeaveBalance(prisma, employeeId, plType.id, utcDate("2026-12-31"))).toNumber()).toBe(1);
    expect((await getLeaveBalance(prisma, employeeId, plType.id, utcDate("2027-01-01"))).toNumber()).toBe(2);
  });

  it("returns 0, not null/undefined, for an employee with no entries at all", async () => {
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });

    expect((await getLeaveBalance(prisma, employeeId, plType.id)).toNumber()).toBe(0);
  });
});
