import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { computeEligibilityDate, creditMonthlyAccrualForEmployee, firstAccrualMonth, isEligibleForAccrualMonth, runMonthlyPlAccrual } from "../accrual";
import { cleanupMinimalTestEmployee, createMinimalTestEmployee, utcDate } from "./leaveTestHelpers";

const DAYS_90 = { eligibilityMode: "DAYS" as const, eligibilityValue: 90 };

describe("PL accrual eligibility — HR's confirmed 90-day rule (spec §5.2)", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  // The three worked examples HR gave verbatim.
  it("joined 1 July -> eligible 29 September -> first credit 1 October", () => {
    const doj = utcDate("2026-07-01");
    expect(computeEligibilityDate(doj, DAYS_90).toISOString().slice(0, 10)).toBe("2026-09-29");
    expect(firstAccrualMonth(doj, DAYS_90).toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("joined 6 July -> eligible 4 October -> first credit 1 November", () => {
    const doj = utcDate("2026-07-06");
    expect(computeEligibilityDate(doj, DAYS_90).toISOString().slice(0, 10)).toBe("2026-10-04");
    expect(firstAccrualMonth(doj, DAYS_90).toISOString().slice(0, 10)).toBe("2026-11-01");
  });

  it("joined 3 October -> eligible exactly 1 January -> first credit that same 1 January (inclusive boundary)", () => {
    const doj = utcDate("2026-10-03");
    expect(computeEligibilityDate(doj, DAYS_90).toISOString().slice(0, 10)).toBe("2027-01-01");
    // The inclusive-boundary rule this pins down: an eligibility date landing
    // exactly on a month's 1st counts as already passed for that same
    // month's credit, not pushed to the month after.
    expect(firstAccrualMonth(doj, DAYS_90).toISOString().slice(0, 10)).toBe("2027-01-01");
  });

  it("is never pro-rated: eligible employees always get exactly the policy's full accrualDaysPerMonth", async () => {
    const doj = utcDate("2026-07-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" }, include: { policy: true } });

    const entry = await creditMonthlyAccrualForEmployee(employeeId, doj, plType.id, plType.policy!, utcDate("2026-10-01"));

    expect(entry).not.toBeNull();
    expect(entry!.days.toNumber()).toBe(1);
  });

  it("isEligibleForAccrualMonth is true starting exactly at firstAccrualMonth and false the month before", () => {
    const doj = utcDate("2026-07-06"); // eligible 4 Oct -> first credit 1 Nov
    const first = firstAccrualMonth(doj, DAYS_90);
    const monthBefore = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() - 1, 1));

    expect(isEligibleForAccrualMonth(doj, DAYS_90, first)).toBe(true);
    expect(isEligibleForAccrualMonth(doj, DAYS_90, monthBefore)).toBe(false);
  });

  it("a DOJ that already falls exactly on a month's 1st (0-day eligibility) is eligible starting that same month", () => {
    const doj = utcDate("2026-03-01");
    const zeroDayPolicy = { eligibilityMode: "DAYS" as const, eligibilityValue: 0 };
    expect(computeEligibilityDate(doj, zeroDayPolicy).toISOString().slice(0, 10)).toBe("2026-03-01");
    expect(firstAccrualMonth(doj, zeroDayPolicy).toISOString().slice(0, 10)).toBe("2026-03-01");
  });

  it("CALENDAR_MONTHS mode adds whole calendar months rather than calendar days", () => {
    const doj = utcDate("2026-01-15");
    const policy = { eligibilityMode: "CALENDAR_MONTHS" as const, eligibilityValue: 3 };
    expect(computeEligibilityDate(doj, policy).toISOString().slice(0, 10)).toBe("2026-04-15");
    expect(firstAccrualMonth(doj, policy).toISOString().slice(0, 10)).toBe("2026-05-01");
  });
});

describe("monthly accrual idempotency (spec §5.5)", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("crediting the same employee-month twice is a no-op the second time", async () => {
    const doj = utcDate("2026-01-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" }, include: { policy: true } });
    const accrualMonth = utcDate("2026-04-01");

    const first = await creditMonthlyAccrualForEmployee(employeeId, doj, plType.id, plType.policy!, accrualMonth);
    const second = await creditMonthlyAccrualForEmployee(employeeId, doj, plType.id, plType.policy!, accrualMonth);

    expect(first).not.toBeNull();
    expect(second).toBeNull(); // already credited — idempotent no-op, not a duplicate row

    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plType.id, entryType: "ACCRUAL" } });
    expect(rows).toHaveLength(1);
  });

  it("a retried run for the same credited month (regardless of which real-world day it executes on) still doesn't double-credit", async () => {
    // A job retry or a manual re-trigger always computes the same
    // accrualMonth for "this month's" credit — the idempotency key is the
    // credited month, never the day the job happened to actually run.
    const doj = utcDate("2026-01-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" }, include: { policy: true } });
    const accrualMonth = utcDate("2026-06-01");

    await creditMonthlyAccrualForEmployee(employeeId, doj, plType.id, plType.policy!, accrualMonth);
    // Simulate the retry landing on the 3rd instead of the 1st — the
    // caller still passes the SAME accrualMonth (June's 1st), since that's
    // what "June's accrual" means regardless of today's actual date.
    const retryResult = await creditMonthlyAccrualForEmployee(employeeId, doj, plType.id, plType.policy!, accrualMonth);

    expect(retryResult).toBeNull();
    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plType.id, entryType: "ACCRUAL" } });
    expect(rows).toHaveLength(1);
  });

  it("the DB partial unique index rejects a duplicate ACCRUAL row directly, even bypassing the app-level check", async () => {
    const doj = utcDate("2026-01-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    const accrualMonth = utcDate("2026-07-01");

    await prisma.leaveLedger.create({
      data: { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: accrualMonth, accrualMonth, entryType: "ACCRUAL", days: 1 },
    });

    await expect(
      prisma.leaveLedger.create({
        data: { employeeId, leaveTypeId: plType.id, leaveYear: 2026, entryDate: accrualMonth, accrualMonth, entryType: "ACCRUAL", days: 1 },
      }),
    ).rejects.toThrow();
  });

  it("an employee not yet eligible is skipped, not credited", async () => {
    const doj = utcDate("2026-06-15"); // eligible ~13 Sep, well after April
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" }, include: { policy: true } });

    const result = await creditMonthlyAccrualForEmployee(employeeId, doj, plType.id, plType.policy!, utcDate("2026-04-01"));
    expect(result).toBeNull();
    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, entryType: "ACCRUAL" } });
    expect(rows).toHaveLength(0);
  });
});

describe("runMonthlyPlAccrual (bulk driver)", () => {
  const employeeIds: string[] = [];
  afterEach(async () => {
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("credits a specific eligible fixture employee when run for their eligible month", async () => {
    // Asserts the effect on OUR fixture employee specifically, not the
    // {credited, skipped} totals returned — those totals reflect every
    // ACTIVE employee in the shared test database (seed data + other
    // tests' fixtures), not just this test's own data.
    const doj = utcDate("2026-01-01");
    const employeeId = await createMinimalTestEmployee(doj);
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    const accrualMonth = utcDate("2026-05-01"); // well past the 90-day boundary from 1 Jan

    await runMonthlyPlAccrual(accrualMonth);

    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plType.id, entryType: "ACCRUAL", accrualMonth } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.days.toNumber()).toBe(1);
  });

  it("does not credit an INACTIVE/SEPARATED employee even if otherwise eligible", async () => {
    const doj = utcDate("2026-01-01");
    const employeeId = await createMinimalTestEmployee(doj, { status: "SEPARATED" });
    employeeIds.push(employeeId);
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });

    await runMonthlyPlAccrual(utcDate("2026-05-01"));

    const rows = await prisma.leaveLedger.findMany({ where: { employeeId, leaveTypeId: plType.id, entryType: "ACCRUAL" } });
    expect(rows).toHaveLength(0);
  });
});
