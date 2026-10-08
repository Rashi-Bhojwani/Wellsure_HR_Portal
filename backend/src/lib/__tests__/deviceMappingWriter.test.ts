import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../prisma";
import { writeDeviceMapping } from "../effectiveDating";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../modules/employee/__tests__/employeeTestHelpers";

// writeDeviceMapping (P2-B "map to employee"): the mapping timeline follows
// the same rules as every effective-dated history (docs/plans/EFFECTIVE_DATES.md).
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const iso = (x: Date | null) => (x ? x.toISOString().slice(0, 10) : null);
const tag = Date.now().toString(36).slice(-5);

describe("writeDeviceMapping", () => {
  let org: TestOrgMasters;
  let emp: { employeeId: string; userId: string; employeeCode: string };
  let manual: { employeeId: string; userId: string; employeeCode: string };
  const write = (employeeId: string, id: string, day: string) => prisma.$transaction((tx) => writeDeviceMapping(tx, employeeId, id, d(day), { createdByUserId: emp.userId }));
  const rows = async (employeeId: string) =>
    (await prisma.deviceUserMapping.findMany({ where: { employeeId }, orderBy: { validFrom: "asc" } })).map((r) => [r.deviceUserId, iso(r.validFrom), iso(r.validTo)]);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    emp = await createFullTestEmployee(org); // mapped to its own code from 2024-01-01
    manual = await createFullTestEmployee(org);
    await prisma.deviceUserMapping.deleteMany({ where: { employeeId: manual.employeeId } });
  });
  afterAll(async () => {
    for (const x of [emp, manual]) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("first mapping for a manual-capture person; extending it back to cover earlier punches; nothing to do when covered", async () => {
    expect((await write(manual.employeeId, `M${tag}`, "2025-03-10")).plan).toBe("first");
    expect((await write(manual.employeeId, `M${tag}`, "2025-03-01")).plan).toBe("extend");
    expect((await write(manual.employeeId, `M${tag}`, "2025-04-01")).plan).toBe("unchanged");
    expect(await rows(manual.employeeId)).toEqual([[`M${tag}`, "2025-03-01", null]]);
  });

  it("never before joining", async () => {
    await expect(write(manual.employeeId, `M${tag}`, "2023-12-31")).rejects.toMatchObject({ code: "MAPPING_BEFORE_JOINING" });
  });

  it("a new device ID appends (the old one ends that day); dated the latest row's own start, it replaces it", async () => {
    expect((await write(emp.employeeId, `N${tag}`, "2025-06-01")).plan).toBe("append");
    expect((await write(emp.employeeId, `P${tag}`, "2025-06-01")).plan).toBe("amend");
    expect(await rows(emp.employeeId)).toEqual([
      [emp.employeeCode, "2024-01-01", "2025-06-01"],
      [`P${tag}`, "2025-06-01", null],
    ]);
  });

  it("earlier history is never rewritten", async () => {
    await expect(write(emp.employeeId, `Q${tag}`, "2025-01-01")).rejects.toMatchObject({ code: "HISTORY_BEFORE_LATEST" });
    await expect(write(emp.employeeId, `P${tag}`, "2025-05-01")).rejects.toMatchObject({ code: "HISTORY_BEFORE_LATEST" });
  });

  it("the same limits as every writer: at most 366 days ahead; never before an already-scheduled change", async () => {
    const far = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    await expect(write(emp.employeeId, `F${tag}`, far)).rejects.toMatchObject({ code: "HISTORY_TOO_FAR_AHEAD" });
    const soon = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const sooner = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
    expect((await write(emp.employeeId, `S${tag}`, soon)).plan).toBe("append"); // scheduled
    await expect(write(emp.employeeId, `T${tag}`, sooner)).rejects.toMatchObject({ code: "HISTORY_SCHEDULED_EXISTS" });
  });
});
