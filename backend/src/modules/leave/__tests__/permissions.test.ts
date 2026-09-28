import { describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";

const LEAVE_PERMISSION_KEYS = ["leave.apply.onBehalf", "leave.view", "leave.approve", "leave.grant", "leave.policy.manage", "leave.recalculate", "leave.yearend.manage"] as const;

async function leavePermissionsFor(roleCode: string): Promise<Set<string>> {
  const role = await prisma.role.findUniqueOrThrow({
    where: { code: roleCode },
    include: { permissions: { include: { permission: true } } },
  });
  return new Set(role.permissions.map((rp) => rp.permission.key).filter((key) => (LEAVE_PERMISSION_KEYS as readonly string[]).includes(key)));
}

// The 7 new Phase 4 permission keys against seed.ts's actual role grants —
// endpoints that consume leave.grant/leave.policy.manage/leave.recalculate/
// leave.yearend.manage don't exist until commits C/D, so this proves the
// grant matrix itself is correct at the data level now; idor.test.ts
// covers leave.view/leave.approve/leave.apply.onBehalf's actual endpoint
// gating, which does exist in this commit.
describe("Leave — seeded role -> permission grants", () => {
  it("SUPER_ADMIN has all 7", async () => {
    const perms = await leavePermissionsFor("SUPER_ADMIN");
    for (const key of LEAVE_PERMISSION_KEYS) expect(perms.has(key)).toBe(true);
  });

  it("HR_ADMIN has all 7", async () => {
    const perms = await leavePermissionsFor("HR_ADMIN");
    for (const key of LEAVE_PERMISSION_KEYS) expect(perms.has(key)).toBe(true);
  });

  it("HR_EXECUTIVE has view/approve/grant/onBehalf but not policy/recalculate/yearend (config & financial stays HR_ADMIN+)", async () => {
    const perms = await leavePermissionsFor("HR_EXECUTIVE");
    expect(perms.has("leave.view")).toBe(true);
    expect(perms.has("leave.approve")).toBe(true);
    expect(perms.has("leave.grant")).toBe(true);
    expect(perms.has("leave.apply.onBehalf")).toBe(true);
    expect(perms.has("leave.policy.manage")).toBe(false);
    expect(perms.has("leave.recalculate")).toBe(false);
    expect(perms.has("leave.yearend.manage")).toBe(false);
  });

  it("MANAGER has view/approve/onBehalf (scope-limited to their own team by resolveDataScope, not by these permission strings) but not grant/policy/recalculate/yearend", async () => {
    const perms = await leavePermissionsFor("MANAGER");
    expect(perms.has("leave.view")).toBe(true);
    expect(perms.has("leave.approve")).toBe(true);
    expect(perms.has("leave.apply.onBehalf")).toBe(true);
    expect(perms.has("leave.grant")).toBe(false);
    expect(perms.has("leave.policy.manage")).toBe(false);
    expect(perms.has("leave.recalculate")).toBe(false);
    expect(perms.has("leave.yearend.manage")).toBe(false);
  });

  it("APPROVER has approve+view only", async () => {
    const perms = await leavePermissionsFor("APPROVER");
    expect(perms.has("leave.approve")).toBe(true);
    expect(perms.has("leave.view")).toBe(true);
    expect(perms.has("leave.apply.onBehalf")).toBe(false);
    expect(perms.has("leave.grant")).toBe(false);
  });

  it("PAYROLL_ADMIN has view only (read access for Phase 6 payroll input)", async () => {
    const perms = await leavePermissionsFor("PAYROLL_ADMIN");
    expect(perms.has("leave.view")).toBe(true);
    expect(perms.has("leave.approve")).toBe(false);
    expect(perms.has("leave.apply.onBehalf")).toBe(false);
    expect(perms.has("leave.grant")).toBe(false);
  });

  it("EMPLOYEE has none of the 7 — self-service needs no permission at all", async () => {
    const perms = await leavePermissionsFor("EMPLOYEE");
    expect(perms.size).toBe(0);
  });
});
