import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { encryptField } from "../../../lib/encryption";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { copyInForce, statutoryOn } from "../statutoryOn";

// A1 (docs/plans/A_PART3.md; owner decision 2026-11-13): statutory identifiers effective-dated for payroll. Made-up identifiers only.
describe("A1 — which copy is in force", () => {
  it("the latest copy on or before the day (a later recording wins a tie); before the first copy, the first copy", () => {
    fc.assert(
      fc.property(fc.array(fc.record({ effectiveFrom: fc.constantFrom("2026-01-01", "2026-04-01", "2026-08-15"), recordedAt: fc.constantFrom("2026-01-01T00:00:00Z", "2026-05-01T00:00:00Z", "2026-09-01T00:00:00Z"), v: fc.integer() }), { maxLength: 8 }), fc.constantFrom("2025-12-31", "2026-04-01", "2026-08-14", "2027-01-01"), (copies, day) => {
        const got = copyInForce(copies, day);
        const key = (c: { effectiveFrom: string; recordedAt: string }) => `${c.effectiveFrom}|${c.recordedAt}`;
        const ordered = [...copies].sort((a, b) => key(a).localeCompare(key(b)));
        const started = ordered.filter((c) => c.effectiveFrom <= day);
        const want = copies.length === 0 ? null : started.length ? started[started.length - 1]! : ordered[0]!;
        if (want === null) expect(got).toBeNull();
        else expect(key(got!)).toBe(key(want));
      }),
      { numRuns: 400 },
    );
  });
});

describe("A1 — the dated copies over the database", () => {
  let org: TestOrgMasters;
  let person: Awaited<ReturnType<typeof createFullTestEmployee>>;
  const ids = () => prisma.employeeStatutoryDated.findMany({ where: { employeeId: person.employeeId }, orderBy: { recordedAt: "asc" } });

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    person = await createFullTestEmployee(org);
  }, 120_000);
  afterAll(async () => {
    await deleteWithDependents("EmployeeStatutoryDated", (await ids()).map((r) => r.id));
    await cleanupFullTestEmployee(person.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("every write that changes what payroll reads records a copy; a change payroll does not read records none; an older day reads the identifier it had", async () => {
    const st = await prisma.employeeStatutory.findUniqueOrThrow({ where: { employeeId: person.employeeId } });
    const before = (await ids()).length;
    expect(before).toBeGreaterThanOrEqual(1); // written when the person's statutory row was created
    await prisma.employeeStatutory.update({ where: { employeeId: person.employeeId }, data: { aadhaarLast4: "9911" } });
    expect((await ids()).length).toBe(before); // Aadhaar is not read by payroll
    await prisma.employeeStatutory.update({ where: { employeeId: person.employeeId }, data: { uanEncrypted: encryptField("ZZUAN000000777"), uanLast4: "0777" } });
    const after = await ids();
    expect(after.length).toBe(before + 1);
    expect(after[after.length - 1]).toMatchObject({ uanLast4: "0777", panLast4: st.panLast4 });
    // The copy before the change took effect earlier: put the earlier copy's date in the past, as a real change months later would leave it.
    const earlier = await prisma.employeeStatutoryDated.create({ data: { id: `esd_test_${person.employeeId}`, employeeId: person.employeeId, effectiveFrom: new Date("2026-01-01T00:00:00Z"), panLast4: st.panLast4, uanLast4: "0001", uanEncrypted: encryptField("ZZUAN000000001") } });
    const changedOn = after[after.length - 1]!.effectiveFrom;
    const dayBefore = new Date(changedOn.getTime() - 86_400_000);
    // On a day between the January copy and today's change, the January copy is in force (unless today's first copy is also dated before it, which it is not).
    const onEarlier = (await statutoryOn([person.employeeId], new Date("2026-06-30T00:00:00Z"))).get(person.employeeId)!;
    const firstToday = after[0]!.effectiveFrom.toISOString().slice(0, 10);
    if (firstToday > "2026-06-30") expect(onEarlier.uanLast4).toBe("0001");
    expect((await statutoryOn([person.employeeId], changedOn)).get(person.employeeId)!.uanLast4).toBe("0777");
    expect(dayBefore < changedOn).toBe(true);
    await deleteWithDependents("EmployeeStatutoryDated", [earlier.id]);
  });

  it("a copy is never changed or deleted, except re-encrypting its sealed columns (key rotation)", async () => {
    const row = (await ids())[0]!;
    await expect(prisma.employeeStatutoryDated.update({ where: { id: row.id }, data: { uanLast4: "0000" } })).rejects.toThrow(/STATUTORY_DATED_IMMUTABLE/);
    await expect(prisma.employeeStatutoryDated.update({ where: { id: row.id }, data: { effectiveFrom: new Date("2020-01-01T00:00:00Z") } })).rejects.toThrow(/STATUTORY_DATED_IMMUTABLE/);
    if (row.uanEncrypted) await expect(prisma.employeeStatutoryDated.update({ where: { id: row.id }, data: { uanEncrypted: encryptField("ZZUAN-RE-ENCRYPTED") } })).resolves.toBeTruthy();
    await expect(prisma.$executeRawUnsafe(`DELETE FROM employee_statutory_dated WHERE id = '${row.id}'`)).rejects.toThrow(/STATUTORY_DATED_IMMUTABLE/);
  });
});
