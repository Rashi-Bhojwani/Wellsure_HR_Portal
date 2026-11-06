import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { formatIndianAmount, payFigureValues } from "../service";
import { payFreeProof, validatePlaceholders } from "../template";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";

// P7-3 revision letters and offer-letter figures (docs/plans/PHASE_7.md §6), the A-3 letter hook. Made-up figures only.
type Person = Awaited<ReturnType<typeof createFullTestEmployee>>;
const d = (s: string) => new Date(`${s}T00:00:00Z`);

describe("letter pay figures — the template rules", () => {
  it("a pay placeholder is a known placeholder, and a template that uses one is never pay-free (so only a director issues it)", () => {
    expect(() => validatePlaceholders("<p>From {{revision.effectiveDate}} your CTC is {{revision.newCtc}}.</p>", [])).not.toThrow();
    const proof = payFreeProof("<p>Dear {{employee.fullName}}, see {{offer.breakup}}</p>", []);
    expect(proof.ok).toBe(false);
    expect(proof.reasons.join(" ")).toMatch(/offer\.breakup/);
    expect(payFreeProof("<p>Dear {{employee.fullName}}, welcome.</p>", []).ok).toBe(true);
  });
  it("groups amounts the Indian way on the text, without turning them into numbers", () => {
    expect(formatIndianAmount("1234567.50")).toBe("12,34,567.50");
    expect(formatIndianAmount("999.00")).toBe("999.00");
    expect(formatIndianAmount("100000.00")).toBe("1,00,000.00");
    expect(formatIndianAmount("12345678901.05")).toBe("12,34,56,78,901.05");
  });
});

describe("letter pay figures — read from the applied salary rows", () => {
  let org: TestOrgMasters;
  let p: Person;
  let none: Person;
  const salaryIds: string[] = [];

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p = await createFullTestEmployee(org);
    none = await createFullTestEmployee(org);
    const pin = { key: "LINE_ROUNDING", version: 1, valueHash: "test" };
    const row = async (from: string, to: string | null, annual: string, reason: "JOINING" | "REVISION") =>
      (await prisma.employeeSalary.create({
        data: { employeeId: p.employeeId, effectiveFrom: d(from), effectiveTo: to ? d(to) : null, reason, annualCtc: annual, monthlyCtc: "50000", structureKey: "TEST", structureVersion: 1, structureHash: "test", roundingPin: pin, createdByUserId: p.userId, lines: { create: [{ componentCode: "TEST_BASIC_LETTER", componentVersion: 1, componentType: "EARNING", amount: "41666.666667", sortOrder: 1 }] } },
      })).id;
    salaryIds.push(await row("2024-01-01", "2025-03-31", "600000", "JOINING"));
    salaryIds.push(await row("2025-04-01", null, "720000.50", "REVISION"));
  }, 120_000);

  afterAll(async () => {
    await cleanupFullTestEmployee(p.employeeId);
    await cleanupFullTestEmployee(none.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("the revision is the row in force on the letter date and the one before; the offer is the row at joining; nothing is read when not used", async () => {
    const v = await payFigureValues(p.employeeId, d("2026-06-01"), new Set(["revision.newCtc", "revision.previousCtc", "revision.effectiveDate", "offer.ctc", "offer.breakup"]));
    expect(v["revision.newCtc"]).toBe("₹ 7,20,000.50");
    expect(v["revision.previousCtc"]).toBe("₹ 6,00,000.00");
    expect(v["revision.effectiveDate"]).toBe("1 April 2025");
    expect(v["offer.ctc"]).toBe("₹ 6,00,000.00");
    expect(v["offer.breakup"]).toBe("TEST_BASIC_LETTER: ₹ 41,666.67 a month");
    expect(await payFigureValues(p.employeeId, d("2026-06-01"), new Set(["employee.fullName"]))).toEqual({});
  });

  it("a letter that prints pay for someone with no salary is refused, naming why", async () => {
    await expect(payFigureValues(none.employeeId, d("2026-06-01"), new Set(["revision.newCtc"]))).rejects.toMatchObject({ code: "NO_SALARY" });
  });
});
