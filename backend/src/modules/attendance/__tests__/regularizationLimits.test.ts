import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { DEFAULT_REGULARIZATION_SETTINGS, REGULARIZATION_SETTING_KEY } from "../../../lib/regularizationSettings";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { resetPolicy, setPolicy } from "../../policySettings/__tests__/policyTestHelpers";
import { computeAttendance } from "../compute";

// AT-22 (M session block 2): at most N correction requests a month, once two directors turn it on. Off: exactly as before (the golden case).
describe("attendance correction limits", () => {
  const TODAY = "2026-09-30";
  const d = (s: string) => new Date(`${s}T00:00:00Z`);
  let org: TestOrgMasters;
  const ids: string[] = [];
  const t: Record<string, string> = {};
  let savedSettings: unknown = null;
  const raise = (who: string, date: string) => request(app).post("/api/attendance/me/regularizations").set(...authHeader(t[who]!)).send({ reasonCode: "FORGOT_TO_PUNCH", date, status: "P" });
  const workingDays = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-07", "2026-09-08", "2026-09-09", "2026-09-10", "2026-09-11"];

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["off", undefined], ["on", undefined], ["hr", "HR_ADMIN"]] as const) {
      const x = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      ids.push(x.employeeId);
      t[k] = await loginAs(x.employeeCode);
      if (k === "hr") {
        savedSettings = (await prisma.systemSetting.findUnique({ where: { key: REGULARIZATION_SETTING_KEY } }))?.value ?? null;
        await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, x.userId);
      }
    }
    await computeAttendance(ids, "2026-08-25", TODAY);
  });
  afterAll(async () => {
    await resetPolicy("policy.regularizationLimits", t.d1!, t.d2!);
    setBusinessTodayForTests(null);
    if (savedSettings === null) await prisma.systemSetting.deleteMany({ where: { key: REGULARIZATION_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: REGULARIZATION_SETTING_KEY }, data: { value: savedSettings as never } });
    for (const id of ids) await cleanupFullTestEmployee(id);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("while off (the default), any number may be raised, exactly as before", async () => {
    for (const day of workingDays.slice(0, 5)) expect((await raise("off", day)).status, day).toBe(201);
  });

  it("once turned on (3 a month), the fourth is refused with the reason; a rejected one frees a place; another month is separate", async () => {
    await setPolicy("policy.regularizationLimits", { active: true, perMonth: 3 }, t.d1!, t.d2!);
    for (const day of workingDays.slice(0, 3)) expect((await raise("on", day)).status, day).toBe(201);
    const fourth = await raise("on", workingDays[3]!);
    expect(fourth.status).toBe(409);
    expect(fourth.body.error.code).toBe("MONTHLY_LIMIT");
    const first = await prisma.regularizationRequest.findFirstOrThrow({ where: { employeeId: ids[3]!, date: d(workingDays[0]!) } });
    expect((await request(app).post(`/api/attendance/regularizations/${first.id}/reject`).set(...authHeader(t.hr!)).send({ note: "Not needed" })).status).toBe(200);
    expect((await raise("on", workingDays[3]!)).status).toBe(201);
    expect((await raise("on", "2026-08-31")).status).toBe(201);
  });
});
