import { Prisma } from "@prisma/client";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { dailyPattern, scheduleLimitValid, scheduleLimitValue, SCHEDULE_LIMIT_SETTINGS } from "../../../lib/schedulesAndLimits";
import { attendanceNightlyQueue } from "../../../jobs/attendanceQueues";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { accrualPolicyMissing, assertAccrualPolicy, computeEligibilityDate } from "../../leave/accrual";
import { parseOptions } from "../../payroll/compare/diff";
import { nextTaxYearDue } from "../../payroll/statutoryPack/service";
import { scheduleTimedJob } from "../schedulesLimits";

// Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md items 5 and 6, from HARDCODED_VALUES_AUDIT.md §3 and the class A table). Made-up values only.

describe("leave: no made-up number when a box is blank (audit #6, #7 and the eligibility period)", () => {
  const full = { accrualDaysPerMonth: new Prisma.Decimal(1), eligibilityMode: "DAYS" as const, eligibilityValue: 90 };
  it("a blank days-per-month or eligibility period is named and refused; 0 is a real entry", () => {
    expect(accrualPolicyMissing("Annual", full)).toEqual([]);
    expect(accrualPolicyMissing("Annual", { ...full, eligibilityValue: 0 })).toEqual([]);
    expect(accrualPolicyMissing("Annual", { ...full, accrualDaysPerMonth: null })).toEqual(["Annual: days earned per month is not set"]);
    expect(accrualPolicyMissing("Annual", { ...full, eligibilityValue: null })).toEqual(["Annual: the eligibility period is not set (enter 0 for eligible from joining)"]);
    expect(() => assertAccrualPolicy("Annual", { ...full, accrualDaysPerMonth: null })).toThrow(/days earned per month is not set/);
    expect(() => computeEligibilityDate(new Date("2026-01-01T00:00:00Z"), { eligibilityMode: null, eligibilityValue: null })).toThrow(/eligibility period is not set/);
    expect(computeEligibilityDate(new Date("2026-01-01T00:00:00Z"), { eligibilityMode: "DAYS", eligibilityValue: 0 }).toISOString().slice(0, 10)).toBe("2026-01-01");
  });
});

describe("pure pieces of the schedules, the compare tolerance and the tax-year reminder", () => {
  it("validates hours, HH:MM times and whole numbers within range; builds the daily pattern", () => {
    const hour = SCHEDULE_LIMIT_SETTINGS.find((d) => d.key === "attendance.nightlyHour")!;
    const time = SCHEDULE_LIMIT_SETTINGS.find((d) => d.key === "reports.subscriptionsTime")!;
    expect([scheduleLimitValid(hour, 0), scheduleLimitValid(hour, 23), scheduleLimitValid(hour, 24), scheduleLimitValid(hour, 1.5), scheduleLimitValid(hour, "2")]).toEqual([true, true, false, false, false]);
    expect([scheduleLimitValid(time, "07:41"), scheduleLimitValid(time, "24:00"), scheduleLimitValid(time, "7:41")]).toEqual([true, false, false]);
    expect([dailyPattern(2), dailyPattern("07:41"), dailyPattern("23:05")]).toEqual(["0 2 * * *", "41 7 * * *", "5 23 * * *"]);
  });
  it("A-20: a blank compare tolerance is the parallel run's setting passed in (never a hidden ₹1)", () => {
    expect(parseOptions({}).toleranceAmount).toBe("0");
    expect(parseOptions({}, "2.5").toleranceAmount).toBe("2.5");
    expect(parseOptions({ toleranceAmount: "4" }, "2.5").toleranceAmount).toBe("4");
  });
  it("A-16: the next tax year is asked for in February and March only, unless entered or in the standard values", () => {
    expect(nextTaxYearDue("2027-01-31", new Set())).toBeNull();
    expect(nextTaxYearDue("2027-02-01", new Set())).toBe("2027-28");
    expect(nextTaxYearDue("2027-03-15", new Set(["2027-28"]))).toBeNull();
    expect(nextTaxYearDue("2026-02-10", new Set())).toBeNull(); // 2026-27 is in the standard values
    expect(nextTaxYearDue("2027-04-01", new Set())).toBeNull();
  });
});

describe("System Settings: schedules and limits, and the defaults in use", () => {
  let org: TestOrgMasters;
  const p: Record<string, { employeeId: string; employeeCode: string; userId: string }> = {};
  const t: Record<string, string> = {};
  const touched = ["attendance.nightlyHour", "helpdesk.maxAttachmentsPerMessage", "payroll.salaryAssignmentImportMaxRows"];
  let before: Array<{ key: string; value: Prisma.JsonValue }> = [];
  const call = (who: string, m: "get" | "put", path: string, body?: object) => request(app)[m](path).set(...authHeader(t[who]!)).send(body);

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["dir", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["mgr", "MANAGER"], ["emp", undefined], ["dev", DEVELOPER_ROLE_CODE]] as const) {
      p[k] = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
      t[k] = await loginAs(p[k]!.employeeCode);
    }
    before = await prisma.systemSetting.findMany({ where: { key: { in: touched } }, select: { key: true, value: true } });
    await prisma.systemSetting.deleteMany({ where: { key: { in: touched } } }); // one table, nothing depends on it
  }, 120_000);

  afterAll(async () => {
    await prisma.systemSetting.deleteMany({ where: { key: { in: touched } } }); // one table, nothing depends on it
    for (const b of before) await prisma.systemSetting.create({ data: { key: b.key, value: b.value as Prisma.InputJsonValue } });
    await scheduleTimedJob("attendance.nightlyHour"); // put the job back on whatever is in force now
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("only a director: HR, a manager, an employee and the Developer get 403 on every route", async () => {
    for (const who of ["hr", "mgr", "emp", "dev"]) {
      expect((await call(who, "get", "/api/settings/schedules-limits")).status, who).toBe(403);
      expect((await call(who, "put", "/api/settings/schedules-limits/attendance.nightlyHour", { value: 3 })).status, who).toBe(403);
      expect((await call(who, "get", "/api/settings/defaults-in-use")).status, who).toBe(403);
    }
  });

  it("lists every setting with \"Default in use\" while nobody has saved it; a saved value is used, audited, and moves its job at once", async () => {
    const list = await call("dir", "get", "/api/settings/schedules-limits");
    expect(list.status).toBe(200);
    const nightly = list.body.settings.find((s: { key: string }) => s.key === "attendance.nightlyHour");
    expect(nightly).toMatchObject({ value: 2, defaultValue: 2, defaultInUse: true });
    expect(list.body.settings.map((s: { key: string }) => s.key)).toEqual(SCHEDULE_LIMIT_SETTINGS.map((d) => d.key));
    expect((await call("dir", "put", "/api/settings/schedules-limits/attendance.nightlyHour", { value: 24 })).status).toBe(400);
    expect((await call("dir", "put", "/api/settings/schedules-limits/no.such.key", { value: 1 })).status).toBe(404);
    const saved = await call("dir", "put", "/api/settings/schedules-limits/attendance.nightlyHour", { value: 3 });
    expect(saved.status).toBe(200);
    expect(saved.body.settings.find((s: { key: string }) => s.key === "attendance.nightlyHour")).toMatchObject({ value: 3, defaultInUse: false });
    expect(await scheduleLimitValue<number>("attendance.nightlyHour")).toBe(3);
    expect((await attendanceNightlyQueue().getJobScheduler("attendance-nightly"))?.pattern).toBe("0 3 * * *");
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.updated", entityId: "attendance.nightlyHour" }, orderBy: { createdAt: "desc" } });
    expect([audit.actorUserId, audit.after]).toEqual([p.dir!.userId, { value: 3, schedule: "0 3 * * *" }]);
  });

  it("the helpdesk limit and an import cap follow the setting", async () => {
    expect((await call("emp", "get", "/api/helpdesk/limits")).body).toEqual({ maxAttachmentsPerMessage: 3 });
    await call("dir", "put", "/api/settings/schedules-limits/helpdesk.maxAttachmentsPerMessage", { value: 1 });
    expect((await call("emp", "get", "/api/helpdesk/limits")).body).toEqual({ maxAttachmentsPerMessage: 1 });
    expect(await scheduleLimitValue<number>("payroll.salaryAssignmentImportMaxRows")).toBe(500);
    await call("dir", "put", "/api/settings/schedules-limits/payroll.salaryAssignmentImportMaxRows", { value: 20 });
    expect(await scheduleLimitValue<number>("payroll.salaryAssignmentImportMaxRows")).toBe(20);
  });

  it("defaults in use: every listed setting nobody has saved", async () => {
    const res = await call("dir", "get", "/api/settings/defaults-in-use");
    expect(res.status).toBe(200);
    const stored = new Set((await prisma.systemSetting.findMany({ select: { key: true } })).map((r) => r.key));
    for (const k of res.body.keys as string[]) expect(stored.has(k), k).toBe(false);
  });
});
