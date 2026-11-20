import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { REQUIRED_APPEND_ONLY_TABLES } from "../../../lib/dbRoles";
import { getLeaveBalance, writeLedgerEntry } from "../ledger";
import { cleanupMinimalTestEmployee, createMinimalTestEmployee, utcDate } from "./leaveTestHelpers";

// FIX-H3 (independent audit 2026-11-20, finding H3): leave_ledger had no append-only trigger and the app's database role kept UPDATE and DELETE.
// Now the database refuses UPDATE, DELETE and TRUNCATE (a trigger, as on audit_logs and payroll_events), the table is in REQUIRED_APPEND_ONLY_TABLES
// (so the migrate task also revokes the app role's write rights: covered by lib/__tests__/dbRoles.test.ts), and a correction is a reversing entry.
describe("FIX-H3: the leave ledger is append-only in the database", () => {
  let employeeId: string;
  let leaveTypeId: string;
  let rowId: string;

  beforeAll(async () => {
    employeeId = await createMinimalTestEmployee(utcDate("2024-01-01"));
    leaveTypeId = (await prisma.leaveType.findFirstOrThrow({ where: { isActive: true } })).id;
    rowId = (await writeLedgerEntry(prisma, { employeeId, leaveTypeId, leaveYear: 2026, entryDate: utcDate("2026-02-01"), entryType: "GRANT", days: "15", remarks: "fix-h3" })).id;
  });
  afterAll(async () => {
    await cleanupMinimalTestEmployee(employeeId);
  });

  it("is one of the tables the app role may never change", () => {
    expect(REQUIRED_APPEND_ONLY_TABLES).toContain("leave_ledger");
  });

  it("refuses an UPDATE, through Prisma and in raw SQL", async () => {
    await expect(prisma.leaveLedger.update({ where: { id: rowId }, data: { days: "30" } })).rejects.toThrow(/LEAVE_LEDGER_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe(`UPDATE leave_ledger SET days = 30 WHERE id = $1`, rowId)).rejects.toThrow(/LEAVE_LEDGER_APPEND_ONLY/);
    expect(String((await prisma.leaveLedger.findUniqueOrThrow({ where: { id: rowId } })).days)).toBe("15");
  });

  it("refuses a DELETE and a TRUNCATE", async () => {
    await expect(prisma.leaveLedger.delete({ where: { id: rowId } })).rejects.toThrow(/LEAVE_LEDGER_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe(`DELETE FROM leave_ledger WHERE id = $1`, rowId)).rejects.toThrow(/LEAVE_LEDGER_APPEND_ONLY/);
    await expect(prisma.$executeRawUnsafe(`TRUNCATE leave_ledger`)).rejects.toThrow(/LEAVE_LEDGER_APPEND_ONLY/);
    expect(await prisma.leaveLedger.findUnique({ where: { id: rowId } })).not.toBeNull();
  });

  it("a correction is a reversing entry, and the balance is the sum of the rows", async () => {
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId, leaveYear: 2026, entryDate: utcDate("2026-02-02"), entryType: "DEBIT", days: "-5", referenceType: "CORRECTION", referenceId: rowId, remarks: "fix-h3 reversal" });
    expect(String(await getLeaveBalance(prisma, employeeId, leaveTypeId, utcDate("2026-03-01")))).toBe("10");
    expect(await prisma.leaveLedger.count({ where: { employeeId } })).toBe(2);
  });
});
