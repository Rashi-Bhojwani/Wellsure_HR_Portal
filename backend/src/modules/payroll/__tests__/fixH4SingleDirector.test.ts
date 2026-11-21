import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DIRECTOR_AUTHORITY_SETTING_KEY, DIRECTOR_CHOICE_REQUIRED_STEPS } from "@shared/constants/directorAuthority";
import { authorityFor, confirmChoice, proposeChoice, singleDirectorSteps } from "../../../lib/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { assertNotOwnPay } from "../salary/guards";

// FIX-H4/T1 (independent audit 2026-11-20, finding H4): "The two-director rule is a setting, and own-pay changes are allowed." Now every pay step is two-director by
// default; "one director decides alone" needs BOTH directors, is audited, never applies to a director's own pay, and shows as a red row on Ready for First Run and
// on the audit screen for as long as it is on. (The own-revision path end to end is in revisionAuthority.test.ts; own holds and adjustments in salaryHolds/salary.)
type P = { employeeId: string; employeeCode: string; userId: string };

describe("FIX-H4: two directors by default; deciding alone needs both and never covers your own pay", () => {
  let org: TestOrgMasters;
  let a: P, b: P;
  let saved: unknown;

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    a = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    b = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    saved = (await prisma.systemSetting.findUnique({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } }))?.value ?? null;
    await prisma.systemSetting.deleteMany({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
  });
  afterAll(async () => {
    if (saved === null) await prisma.systemSetting.deleteMany({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY } });
    else await prisma.systemSetting.upsert({ where: { key: DIRECTOR_AUTHORITY_SETTING_KEY }, create: { key: DIRECTOR_AUTHORITY_SETTING_KEY, value: saved as object }, update: { value: saved as object } });
    for (const p of [a, b]) await cleanupFullTestEmployee(p.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("with nothing chosen, every pay step is decided by two directors (not refused, not alone)", async () => {
    for (const step of DIRECTOR_CHOICE_REQUIRED_STEPS) expect(await authorityFor(step), step).toBe("SECOND_DIRECTOR");
    expect(await singleDirectorSteps()).toEqual([]);
    const { buildSetupReport, readinessOf } = await import("../setup/status");
    const ready = readinessOf(await buildSetupReport());
    expect(ready.blockers.map((x) => x.itemId).filter((id) => id.startsWith("safety:director-choice"))).toEqual([]);
    expect(ready.dangers).toEqual([]);
  });

  it("one director alone cannot switch a step to 'decides alone': it waits for the other, and then it is a red row on Ready and on the audit screen", async () => {
    await proposeChoice("BANK_FILE", "DIRECTOR_AUTHORITY", { userId: a.userId });
    expect(await authorityFor("BANK_FILE")).toBe("SECOND_DIRECTOR"); // proposed is not in force
    await expect(confirmChoice("BANK_FILE", "DIRECTOR_AUTHORITY", { userId: a.userId })).rejects.toMatchObject({ code: "CHOICE_CONFIRMER_IS_PROPOSER" });
    await confirmChoice("BANK_FILE", "DIRECTOR_AUTHORITY", { userId: b.userId });
    expect(await authorityFor("BANK_FILE")).toBe("DIRECTOR_AUTHORITY");
    expect(await prisma.auditLog.count({ where: { action: { in: ["director.choice.proposed", "director.choice.confirmed"] }, actorUserId: { in: [a.userId, b.userId] } } })).toBe(2);
    const { buildSetupReport, readinessOf } = await import("../setup/status");
    const ready = readinessOf(await buildSetupReport());
    expect(ready.dangers.map((d) => d.itemId)).toContain("safety:director-choice:BANK_FILE");
    const { listAuditLogs } = await import("../../auditLog/service");
    const audit = await listAuditLogs({ page: 1, pageSize: 1 } as never, { canSeePayroll: true });
    expect(audit.singleDirectorSteps).toContain("The bank file");
    // switched back by both: the red row goes
    await proposeChoice("BANK_FILE", "SECOND_DIRECTOR", { userId: b.userId });
    await confirmChoice("BANK_FILE", "SECOND_DIRECTOR", { userId: a.userId });
    expect(readinessOf(await buildSetupReport()).dangers).toEqual([]);
  });

  it("a director may propose their own pay but never decide it alone: a one-person act on their own pay is refused", async () => {
    await expect(assertNotOwnPay(a.userId, [a.employeeId], "This hold")).rejects.toMatchObject({ code: "SELF_PAY_OTHER_DIRECTOR" });
    await expect(assertNotOwnPay(a.userId, [a.employeeId], "This revision", { proposal: true })).resolves.toBeUndefined();
    await expect(assertNotOwnPay(a.userId, [b.employeeId], "This hold")).resolves.toBeUndefined(); // the other director does it
  });
});
