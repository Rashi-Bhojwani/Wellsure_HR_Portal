import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { setBusinessTodayForTests } from "../businessDate";
import { cancelScheduledJobChange, closeHistoryOnLeaving, inForceOn, writeJobChange } from "../effectiveDating";
import { applyHistoryRepair, planHistoryRepair } from "../historyRepair";
import { updateJob } from "../../modules/employee/service";
import {
  cleanupEmployeeTestOrgMasters,
  cleanupFullTestEmployee,
  createEmployeeTestOrgMasters,
  createFullTestEmployee,
  type TestOrgMasters,
} from "../../modules/employee/__tests__/employeeTestHelpers";

// EF1 against the real database: the one timeline writer, the constraints
// that back it, leaving, cancelling a scheduled change, and the history
// repair's preview → approve → apply.

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null);

describe("effective dating — timeline writer, constraints, leaving, repair", () => {
  let org: TestOrgMasters;
  const ids: string[] = [];
  let actorUserId = "";
  const meta = () => ({ actorUserId, ipAddress: null, userAgent: null });
  const fresh = async () => {
    const e = await createFullTestEmployee(org); // job, name and device mapping from 2024-01-01
    ids.push(e.employeeId);
    return e;
  };
  const jobs = (employeeId: string) => prisma.employeeJobHistory.findMany({ where: { employeeId }, orderBy: { effectiveFrom: "asc" } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    const actor = await fresh();
    actorUserId = actor.userId;
  });
  afterEach(() => setBusinessTodayForTests(null));
  afterAll(async () => {
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("a change appends; the same day amends; anything before the latest period is refused — never inverted rows", async () => {
    const e = await fresh();
    await updateJob(e.employeeId, { effectiveFrom: "2025-06-01", changeReason: "Promotion" }, meta());
    expect((await jobs(e.employeeId)).map((j) => [iso(j.effectiveFrom), iso(j.effectiveTo)])).toEqual([
      ["2024-01-01", "2025-06-01"],
      ["2025-06-01", null],
    ]);
    // Same day as the latest row: amended in place, no zero-length row.
    await updateJob(e.employeeId, { effectiveFrom: "2025-06-01", changeReason: "Correction" }, meta());
    expect(await jobs(e.employeeId)).toHaveLength(2);
    // Before the latest period: refused (this used to write an inverted row).
    await expect(updateJob(e.employeeId, { effectiveFrom: "2025-01-01" }, meta())).rejects.toMatchObject({ code: "HISTORY_BEFORE_LATEST" });
    expect(await jobs(e.employeeId)).toHaveLength(2);
  });

  it("the database itself refuses overlapping or backwards rows", async () => {
    const e = await fresh();
    const [first] = await jobs(e.employeeId);
    const copy = { employeeId: e.employeeId, departmentId: first!.departmentId, designationId: first!.designationId, locationId: first!.locationId, createdByUserId: actorUserId };
    await expect(prisma.employeeJobHistory.create({ data: { ...copy, effectiveFrom: day("2025-01-01"), effectiveTo: day("2025-02-01") } })).rejects.toThrow(/employee_job_history_no_overlap/);
    await expect(prisma.employeeJobHistory.update({ where: { id: first!.id }, data: { effectiveTo: day("2023-12-01") } })).rejects.toThrow(/employee_job_history_dates_ordered/);
    const [mapping] = await prisma.deviceUserMapping.findMany({ where: { employeeId: e.employeeId } });
    const other = await fresh();
    // Close the other person's own mapping first, so only the device-ID rule is in play.
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: other.employeeId }, data: { validTo: day("2024-06-01") } });
    await expect(
      prisma.deviceUserMapping.create({ data: { employeeId: other.employeeId, deviceUserId: mapping!.deviceUserId, validFrom: day("2025-01-01"), validTo: day("2025-02-01"), createdByUserId: actorUserId } }),
    ).rejects.toThrow(/device_user_mappings_device_no_overlap/);
  });

  it("a scheduled change is not in force until its day, and can be cancelled (the previous row reopens)", async () => {
    setBusinessTodayForTests(day("2026-01-10"));
    const e = await fresh();
    const w = await prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-03-01"), {}, { createdByUserId: actorUserId, changeReason: "Transfer" }));
    const current = await prisma.employeeJobHistory.findFirst({ where: { employeeId: e.employeeId, ...inForceOn() } });
    expect(iso(current?.effectiveFrom)).toBe("2024-01-01"); // today: still the old row
    expect((await prisma.employeeJobHistory.findFirst({ where: { employeeId: e.employeeId, ...inForceOn(day("2026-03-01")) } }))?.id).toBe(w.after.id);
    // Dated before the scheduled change: cancel that first.
    await expect(prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-02-01"), {}, { createdByUserId: actorUserId, changeReason: null }))).rejects.toMatchObject({
      code: "HISTORY_SCHEDULED_EXISTS",
    });
    const { removed, reopened } = await prisma.$transaction((tx) => cancelScheduledJobChange(tx, e.employeeId, w.after.id));
    expect(removed.id).toBe(w.after.id);
    expect(reopened.effectiveTo).toBeNull();
    expect(await jobs(e.employeeId)).toHaveLength(1);
    // A change already in force can't be cancelled.
    await expect(prisma.$transaction((tx) => cancelScheduledJobChange(tx, e.employeeId, reopened.id))).rejects.toMatchObject({ code: "HISTORY_IN_FORCE" });
  });

  it("leaving: in force ON the last working day, gone the day after; a scheduled change after it is dropped; one in force after it is refused", async () => {
    setBusinessTodayForTests(day("2026-01-10"));
    const e = await fresh();
    await prisma.$transaction((tx) => writeJobChange(tx, e.employeeId, day("2026-04-01"), {}, { createdByUserId: actorUserId, changeReason: "Scheduled transfer" }));
    const { removedScheduled } = await prisma.$transaction((tx) => closeHistoryOnLeaving(tx, e.employeeId, day("2026-01-31")));
    expect(removedScheduled.map((r) => iso(r.effectiveFrom))).toEqual(["2026-04-01"]);
    const on = (d: string) => prisma.employeeJobHistory.count({ where: { employeeId: e.employeeId, ...inForceOn(day(d)) } });
    expect(await on("2026-01-31")).toBe(1);
    expect(await on("2026-02-01")).toBe(0);
    const mapping = await prisma.deviceUserMapping.findFirstOrThrow({ where: { employeeId: e.employeeId } });
    expect(iso(mapping.validTo)).toBe("2026-02-01");

    const later = await fresh();
    await prisma.$transaction((tx) => writeJobChange(tx, later.employeeId, day("2026-01-05"), {}, { createdByUserId: actorUserId, changeReason: "In force" }));
    await expect(prisma.$transaction((tx) => closeHistoryOnLeaving(tx, later.employeeId, day("2025-12-31")))).rejects.toMatchObject({ code: "HISTORY_AFTER_LEAVING" });
  });

  it("history repair: preview lists each fix and why, changes nothing; apply needs the exact fingerprint and an approver, and audits every row", async () => {
    // A leaver closed the old way: job still open, device mapping ending ON the last day.
    const e = await fresh();
    await prisma.employee.update({ where: { id: e.employeeId }, data: { status: "SEPARATED", lastWorkingDate: day("2025-03-31") } });
    await prisma.deviceUserMapping.updateMany({ where: { employeeId: e.employeeId }, data: { validTo: day("2025-03-31") } });
    // And one a person has to decide: their latest placement starts after they left.
    const odd = await fresh();
    await prisma.$transaction((tx) => writeJobChange(tx, odd.employeeId, day("2025-08-01"), {}, { createdByUserId: actorUserId, changeReason: null }));
    await prisma.employee.update({ where: { id: odd.employeeId }, data: { status: "SEPARATED", lastWorkingDate: day("2025-05-31") } });

    const plan = await planHistoryRepair();
    const mine = plan.fixes.filter((f) => f.employeeCode === e.employeeCode);
    expect(mine.map((f) => [f.table, f.current, f.proposed])).toEqual(
      expect.arrayContaining([
        ["employee_job_history", null, "2025-04-01"],
        ["device_user_mappings", "2025-03-31", "2025-04-01"],
      ]),
    );
    expect(mine.every((f) => f.reason.length > 20)).toBe(true);
    expect(plan.manual.find((m) => m.employeeCode === odd.employeeCode)?.reason).toMatch(/after their last working day/);
    // Preview changed nothing.
    expect((await jobs(e.employeeId))[0]!.effectiveTo).toBeNull();

    await expect(applyHistoryRepair({ fingerprint: "0000000000000000", approvedBy: "HR Head", operator: "Test" })).rejects.toThrow(/changed since that preview/);
    await expect(applyHistoryRepair({ fingerprint: plan.fingerprint, approvedBy: "", operator: "Test" })).rejects.toThrow(/approved-by/);
    expect((await jobs(e.employeeId))[0]!.effectiveTo).toBeNull();

    const { applied } = await applyHistoryRepair({ fingerprint: plan.fingerprint, approvedBy: "HR Head", operator: "Test" });
    expect(applied).toBe(plan.fixes.length);
    expect(iso((await jobs(e.employeeId))[0]!.effectiveTo)).toBe("2025-04-01");
    const audits = await prisma.auditLog.findMany({ where: { action: "history.repaired", entityId: { in: mine.map((f) => f.rowId) } } });
    expect(audits).toHaveLength(2);
    expect(audits[0]!.after).toMatchObject({ approvedBy: "HR Head", fingerprint: plan.fingerprint });
    // Fixed rows no longer appear; the one needing a person still does, untouched.
    const again = await planHistoryRepair();
    expect(again.fixes.filter((f) => f.employeeCode === e.employeeCode)).toEqual([]);
    expect(again.manual.some((m) => m.employeeCode === odd.employeeCode)).toBe(true);
  });

  it("the seed's leavers need no repair", async () => {
    const plan = await planHistoryRepair();
    expect(plan.fixes.filter((f) => ["1028", "1090"].includes(f.employeeCode))).toEqual([]);
    expect(plan.manual.filter((m) => ["1028", "1090"].includes(m.employeeCode))).toEqual([]);
  });
});
