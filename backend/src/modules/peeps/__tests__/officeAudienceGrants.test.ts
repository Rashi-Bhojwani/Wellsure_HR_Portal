import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { setExitSetting, settingVersion as exitSettingVersion } from "../../exits/settings";
import { set as setRecruitmentSetting, version as recruitmentSettingVersion } from "../../recruitment/settings";
import { EXIT_KEYS, RECRUITMENT_KEYS, grantKeysFor } from "../office";
import { appoint, removeMember } from "./peepsTestKit";

// Peeps Stage 4, independent review finding 7: a Wellsure Office member's recruitment and exits grants exist only while the directors' Office
// audience for that module is open (as the asset grants already did), so a member's menus never show a screen that would refuse them.

describe("Office members' recruitment and exits grants follow the audience settings", () => {
  let org: TestOrgMasters;
  let d1: Awaited<ReturnType<typeof createFullTestEmployee>>;
  let d2: Awaited<ReturnType<typeof createFullTestEmployee>>;
  let member: Awaited<ReturnType<typeof createFullTestEmployee>>;
  const meta = () => ({ actorUserId: d1.userId, ipAddress: null, userAgent: null });

  const grantedKeys = async () =>
    (await prisma.userPermissionOverride.findMany({ where: { userId: member.userId, effect: "GRANT" }, include: { permission: true } })).map((o) => o.permission.key);
  const setRecruitment = async (value: { officeManages: boolean } | null) =>
    setRecruitmentSetting("officeAudience", { value, version: (await recruitmentSettingVersion("officeAudience"))?.version ?? 0, reason: "DEMO audience test" }, meta());
  const setExits = async (value: { officeManages: boolean } | null) =>
    setExitSetting("officeAudience", { value, version: (await exitSettingVersion("officeAudience"))?.version ?? 0, reason: "DEMO audience test" }, meta());

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    d1 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    d2 = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    member = await createFullTestEmployee(org);
    await setRecruitment(null);
    await setExits(null);
  });

  afterAll(async () => {
    await setRecruitment(null);
    await setExits(null);
    await removeMember(member.employeeId, d1, d2).catch((e: unknown) => {
      if (!String(e).includes("not a member")) throw e;
    });
    const changes = (await prisma.officeMembershipChange.findMany({ where: { employeeId: member.employeeId }, select: { id: true } })).map((c) => c.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: changes } });
    for (const p of [member, d2, d1]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("grantKeysFor leaves out each module's keys while its audience is closed", () => {
    const caps = ["MANAGE_RECRUITMENT", "MANAGE_EXITS"];
    const closed = grantKeysFor(caps, { assets: false, recruitment: false, exits: false });
    for (const k of [...RECRUITMENT_KEYS, ...EXIT_KEYS]) expect(closed.has(k), k).toBe(false);
    const open = grantKeysFor(caps, { assets: false, recruitment: true, exits: true });
    for (const k of [...RECRUITMENT_KEYS, ...EXIT_KEYS]) expect(open.has(k), k).toBe(true);
    expect(RECRUITMENT_KEYS.size).toBeGreaterThan(0);
    expect(EXIT_KEYS.size).toBeGreaterThan(0);
  });

  it("appointed while the audiences are Not set: no recruitment or exits grant; opening grants them at once; closing takes them away", async () => {
    await appoint(member.employeeId, ["MANAGE_RECRUITMENT", "MANAGE_EXITS"], d1, d2);
    const none = await grantedKeys();
    for (const k of [...RECRUITMENT_KEYS, ...EXIT_KEYS]) expect(none, k).not.toContain(k);

    await setRecruitment({ officeManages: true });
    const recruitmentOpen = await grantedKeys();
    for (const k of RECRUITMENT_KEYS) expect(recruitmentOpen, k).toContain(k);
    for (const k of EXIT_KEYS) expect(recruitmentOpen, k).not.toContain(k);

    await setExits({ officeManages: true });
    const bothOpen = await grantedKeys();
    for (const k of [...RECRUITMENT_KEYS, ...EXIT_KEYS]) expect(bothOpen, k).toContain(k);

    await setRecruitment({ officeManages: false });
    await setExits(null);
    const closedAgain = await grantedKeys();
    for (const k of [...RECRUITMENT_KEYS, ...EXIT_KEYS]) expect(closedAgain, k).not.toContain(k);
  });
});
