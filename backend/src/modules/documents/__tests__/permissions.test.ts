import { describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";

const KEYS = ["documents.manage", "employee.documents.view", "employee.documents.manage"] as const;

async function grantsFor(roleCode: string): Promise<string[]> {
  const role = await prisma.role.findUniqueOrThrow({ where: { code: roleCode }, include: { permissions: { include: { permission: true } } } });
  return role.permissions.map((rp) => rp.permission.key).filter((k) => (KEYS as readonly string[]).includes(k)).sort();
}

// Phase 5 commit C's three new keys against seed.ts's actual role grants —
// same data-level check as leave/__tests__/permissions.test.ts.
describe("Documents — seeded role -> permission grants", () => {
  it.each(["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE"])("%s holds all three (documents aren't salary/bank data)", async (role) => {
    expect(await grantsFor(role)).toEqual([...KEYS].sort());
  });

  it.each(["MANAGER", "EMPLOYEE", "APPROVER", "PAYROLL_ADMIN"])("%s holds none — a manager can't open their team's documents", async (role) => {
    expect(await grantsFor(role)).toEqual([]);
  });
});
