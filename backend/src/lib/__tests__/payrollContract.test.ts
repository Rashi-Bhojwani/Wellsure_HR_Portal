import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { setBusinessTodayForTests } from "../businessDate";
import { deleteWithDependents } from "./cleanup";
import {
  bankAccountOn,
  closeHistoryOnLeaving,
  employedOn,
  employeeForDeviceUserOn,
  nameOn,
  placementOn,
  placementSegments,
  setPayrollLockCheck,
  writeBankChange,
  writeJobChange,
  writeNameChange,
} from "../effectiveDating";
import {
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  type TestOrgMasters,
} from "../../modules/employee/__tests__/employeeTestHelpers";

// EF4 — the effective-dating contract payroll builds on (docs/plans/PHASE_6.md).
// Pins the mid-month cases payroll gets wrong when it reads "current" rows:
// a transfer on the 16th, a leaver's last day, a bank change before payday,
// a name change, a reused device ID — and the payroll-lock hook.
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date) => d.toISOString().slice(0, 10);

describe("the effective-dating contract for payroll (EF4)", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  let hrUserId = "";
  let deptB = "";
  const fresh = async () => {
    const e = await createFullTestEmployee(org); // name, placement, device mapping from 2024-01-01
    ids.push(e.employeeId);
    return e;
  };
  const by = () => ({ createdByUserId: hrUserId, changeReason: null });
  const bank = (last4: string) => ({
    accountHolderName: "Test",
    accountNumberEncrypted: Buffer.from(`enc-${last4}`),
    accountNumberLast4: last4,
    accountNumberHash: `hash-${last4}-${Date.now()}`,
    ifsc: "HDFC0000001",
    bankName: "HDFC",
    branchName: "Main",
  });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    hrUserId = (await fresh()).userId;
    deptB = (await prisma.department.create({ data: { code: `PC-${Date.now()}`, name: `Payroll Contract ${Date.now()}` } })).id;
  });
  afterEach(() => {
    setBusinessTodayForTests(null);
    setPayrollLockCheck(null);
  });
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await deleteWithDependents("Department", [deptB]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("a transfer on the 16th gives two placements in the month, split on the day", async () => {
    setBusinessTodayForTests(day("2026-03-02"));
    const e = await fresh();
    await prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-03-16"), { departmentId: deptB }, by()));
    const segs = await placementSegments(e.employeeId, day("2026-03-01"), day("2026-03-31"));
    expect(segs.map((s) => [iso(s.from), iso(s.to), s.row.departmentId])).toEqual([
      ["2026-03-01", "2026-03-15", org.departmentId],
      ["2026-03-16", "2026-03-31", deptB],
    ]);
    expect((await placementOn(e.employeeId, day("2026-03-15")))?.departmentId).toBe(org.departmentId);
    expect((await placementOn(e.employeeId, day("2026-03-16")))?.departmentId).toBe(deptB);
  });

  it("a leaver is placed and employed ON their last working day, and not the day after", async () => {
    setBusinessTodayForTests(day("2026-04-25"));
    const e = await fresh();
    await prisma.employee.update({ where: { id: e.employeeId }, data: { lastWorkingDate: day("2026-04-20") } });
    await prisma.$transaction((tx) => closeHistoryOnLeaving(tx, e.employeeId, day("2026-04-20")));
    expect(await placementOn(e.employeeId, day("2026-04-20"))).not.toBeNull();
    expect(await placementOn(e.employeeId, day("2026-04-21"))).toBeNull();
    const segs = await placementSegments(e.employeeId, day("2026-04-01"), day("2026-04-30"));
    expect(segs.map((s) => [iso(s.from), iso(s.to)])).toEqual([["2026-04-01", "2026-04-20"]]);
    expect(await prisma.employee.count({ where: { id: e.employeeId, ...employedOn(day("2026-04-20")) } })).toBe(1);
    expect(await prisma.employee.count({ where: { id: e.employeeId, ...employedOn(day("2026-04-21")) } })).toBe(0);
  });

  it("a bank change dated the 10th: a payment dated the 25th goes to the new account; the 9th to the old", async () => {
    setBusinessTodayForTests(day("2026-05-02"));
    const e = await fresh();
    await prisma.$transaction((tx) => writeBankChange(tx, e.employeeId, day("2026-01-01"), bank("1111"), { createdByUserId: hrUserId }));
    await prisma.$transaction((tx) => writeBankChange(tx, e.employeeId, day("2026-05-10"), bank("2222"), { createdByUserId: hrUserId }));
    expect((await bankAccountOn(e.employeeId, day("2026-05-25")))?.accountNumberLast4).toBe("2222");
    expect((await bankAccountOn(e.employeeId, day("2026-05-09")))?.accountNumberLast4).toBe("1111");
  });

  it("a payslip or letter keeps the name of its own date", async () => {
    setBusinessTodayForTests(day("2026-06-02"));
    const e = await fresh();
    const before = await nameOn(e.employeeId, day("2026-06-01"));
    await prisma.$transaction((tx) => writeNameChange(tx, e.employeeId, day("2026-06-15"), "Married Name", by()));
    expect(await nameOn(e.employeeId, day("2026-06-14"))).toBe(before);
    expect(await nameOn(e.employeeId, day("2026-06-15"))).toBe("Married Name");
  });

  it("a reused device ID: a punch on the leaver's last day is theirs; after it, the new holder's", async () => {
    setBusinessTodayForTests(day("2026-07-10"));
    const leaver = await fresh();
    const [m] = await prisma.deviceUserMapping.findMany({ where: { employeeId: leaver.employeeId } });
    await prisma.$transaction((tx) => closeHistoryOnLeaving(tx, leaver.employeeId, day("2026-06-30")));
    const joiner = await fresh();
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: joiner.employeeId } });
    await prisma.deviceUserMapping.create({ data: { employeeId: joiner.employeeId, deviceUserId: m!.deviceUserId, validFrom: day("2026-07-01"), createdByUserId: hrUserId } });
    expect(await employeeForDeviceUserOn(m!.deviceUserId, day("2026-06-30"))).toBe(leaver.employeeId);
    expect(await employeeForDeviceUserOn(m!.deviceUserId, day("2026-07-01"))).toBe(joiner.employeeId);
  });

  it("the payroll-lock hook: nothing dated inside a finalised period, whether a change or a leaving", async () => {
    setBusinessTodayForTests(day("2026-05-05"));
    setPayrollLockCheck(async (d) => ({ locked: d <= day("2026-04-30"), period: "April 2026" }));
    const e = await fresh();
    await expect(prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-04-20"), { departmentId: deptB }, by()))).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    await expect(prisma.$transaction((tx) => closeHistoryOnLeaving(tx, e.employeeId, day("2026-04-15")))).rejects.toMatchObject({ code: "PAYROLL_LOCKED" });
    await expect(prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-05-01"), { departmentId: deptB }, by()))).resolves.toBeTruthy();
  });
});
