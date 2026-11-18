import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { computeAttendance } from "../../attendance/compute";
import { setRecomputeDatesHandler, setRecomputeHandler } from "../../attendance/recompute";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { buildSetupReport } from "../../payroll/setup/status";
import { cleanupPayrollRowsBy } from "../../payroll/__tests__/payrollTestHelpers";
import { makeComponent } from "../../payroll/__tests__/salaryTestHelpers";
import { loadAttendanceDayHook } from "../dayHook";
import { DEFAULT_RULE, type LateRule } from "../evaluate";

// The lateness rule end to end against the database (docs/plans/LATE_CHECKLIST.md §8): the real engine and the one hook, the two-director settings, waivers,
// who sees what, effective dating and penalties. October and November 2026 (past, open months).

type Person = { employeeId: string; userId: string; employeeCode: string };
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
const LATE_KEYS = ["late.rule", "late.missingPunch", "late.halfDay"];

describe("lateness rule against the database", () => {
  let org: TestOrgMasters;
  let otherOrg: TestOrgMasters;
  const p = {} as Record<"d1" | "d2" | "hr" | "hr2" | "hrx" | "mgr" | "emp" | "emp2" | "otherMgr" | "other" | "dev", Person>;
  const t = {} as Record<keyof typeof p, string>;
  let deviceId = "";
  let batchId = "";
  let penaltyHead = "";
  const lockIds: string[] = [];
  const api = (who: keyof typeof p) => ({
    get: (path: string) => request(app).get(`/api/lateness${path}`).set(...authHeader(t[who])),
    post: (path: string, body: object = {}) => request(app).post(`/api/lateness${path}`).set(...authHeader(t[who])).send(body),
  });
  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({ data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: new Date(`${date}T00:00:00Z`), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId } });
  const lop = async (who: Person, from: string, to: string) => {
    const rows = await prisma.dailyAttendance.findMany({ where: { employeeId: who.employeeId, date: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) } }, orderBy: { date: "asc" } });
    return Object.fromEntries(rows.map((r) => [r.date.toISOString().slice(0, 10), r.lopDays.toString()]));
  };
  const snapshot = async (ids: string[]) =>
    JSON.stringify(
      (await prisma.dailyAttendance.findMany({ where: { employeeId: { in: ids } }, orderBy: [{ employeeId: "asc" }, { date: "asc" }] })).map(({ id: _i, processedAt: _p, createdAt: _c, updatedAt: _u, ...rest }: Record<string, unknown>) => rest),
    );
  async function setLate(key: string, value: object) {
    const prop = await api("d1").post(`/settings/${key}/proposals`, { value, reason: "Test setting" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    const c = await api("d2").post(`/settings/proposals/${prop.body.id}/confirm`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
  }
  const purgeSettings = async () => deleteWithDependents("BehaviourProposal", (await prisma.behaviourProposal.findMany({ where: { key: { in: LATE_KEYS } }, select: { id: true } })).map((r) => r.id));
  const ON_OCT: LateRule = { ...DEFAULT_RULE, effectiveFrom: "2026-10-01", active: true };

  // A month of arrivals for `emp` (all out at 19:00 unless said), the boundaries of the proposed starting values in order.
  const OCT: Array<[string, string, string?]> = [
    ["2026-10-05", "10:09"], // on time
    ["2026-10-06", "10:10"], // band 1 (Not set)
    ["2026-10-07", "10:19"], // band 1
    ["2026-10-08", "10:20"], // band 2, allowance 1
    ["2026-10-09", "10:29"], // band 2, allowance 2
    ["2026-10-10", "10:30"], // band 3: cut 0.5 (Saturday is a working day; Sunday is the week-off)
    ["2026-10-12", "10:31"], // band 3: cut 0.5
    ["2026-10-13", "10:25"], // band 2, allowance 3 (the 3rd)
    ["2026-10-14", "10:25"], // band 2, the 4th: cut 0.5
    ["2026-10-15", "10:25", "16:00"], // band 2, the 5th: cut 0.5, on a half day (0.5 for hours): 0.5 in all (higher-of)
    ["2026-10-16", "10:31", "12:00"], // band 3: cut 0.5, half-day minimum not met (1): 1 in all
  ];

  beforeAll(async () => {
    setBusinessTodayForTests(new Date("2026-11-10T00:00:00Z"));
    setRecomputeHandler(null);
    setRecomputeDatesHandler(null);
    await purgeSettings();
    expect(await prisma.attendancePeriodLock.count({ where: { periodStart: { lte: new Date("2026-11-30T00:00:00Z") }, periodEnd: { gte: new Date("2026-09-01T00:00:00Z") } } }), "an earlier test left an attendance lock on Sep–Nov 2026").toBe(0);
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["hr2", "HR_ADMIN"], ["hrx", "HR_EXECUTIVE"], ["mgr", undefined], ["otherMgr", undefined], ["dev", DEVELOPER_ROLE_CODE]] as const) p[k] = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
    p.emp = await createFullTestEmployee(org, { managerId: p.mgr.employeeId });
    p.emp2 = await createFullTestEmployee(org, { managerId: p.mgr.employeeId });
    p.other = await createFullTestEmployee(otherOrg, { managerId: p.otherMgr.employeeId });
    for (const k of Object.keys(p) as Array<keyof typeof p>) t[k] = await loginAs(p[k].employeeCode);
    deviceId = (await prisma.device.create({ data: { serialNumber: `LATE-${tag}`, name: "Lateness test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    for (const [d, inT, outT] of OCT) {
      await punch(p.emp, d, inT);
      await punch(p.emp, d, outT ?? "19:00");
    }
    for (const [d, inT] of [["2026-11-02", "10:25"], ["2026-11-03", "10:35"], ["2026-11-04", "10:40"]] as const) {
      await punch(p.emp, d, inT);
      await punch(p.emp, d, "19:00");
    }
    await punch(p.emp2, "2026-10-12", "10:45");
    await punch(p.emp2, "2026-10-12", "19:00");
    await punch(p.emp2, "2026-10-13", "10:05"); // one punch only: missing punch
    await punch(p.emp2, "2026-10-14", "10:00");
    await punch(p.emp2, "2026-10-14", "16:30"); // 5 h 45 m worked
    await punch(p.other, "2026-10-12", "10:45");
    await punch(p.other, "2026-10-12", "19:00");
    penaltyHead = `LT${tag.toUpperCase()}_FINE`;
    await makeComponent({ maker: p.d1, checkerA: p.d2 } as never, penaltyHead, { type: "DEDUCTION", taxable: false, prorates: false, payslipLabel: "Lateness penalty" });
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    await purgeSettings();
    await deleteWithDependents("AttendancePeriodLock", lockIds);
    const everyone = Object.values(p);
    for (const x of everyone) await cleanupFullTestEmployee(x.employeeId); // their attendance, waivers and payroll adjustments go with them
    await cleanupPayrollRowsBy(everyone.map((x) => x.userId));
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  });

  const ids = () => [p.emp.employeeId, p.emp2.employeeId, p.other.employeeId];

  describe("GOLDEN: with the module OFF nothing changes anywhere", () => {
    let before = "";
    it("nothing confirmed: the hook is not even loaded, and the days are the engine's alone", async () => {
      expect(await loadAttendanceDayHook(ids(), "2026-10-01", "2026-11-09", { dryRun: true })).toBeNull();
      await computeAttendance(ids(), "2026-10-01", "2026-11-09");
      before = await snapshot(ids());
      expect(await lop(p.emp, "2026-10-05", "2026-10-16")).toEqual({ "2026-10-05": "0", "2026-10-06": "0", "2026-10-07": "0", "2026-10-08": "0", "2026-10-09": "0", "2026-10-10": "0", "2026-10-11": "0", "2026-10-12": "0", "2026-10-13": "0", "2026-10-14": "0", "2026-10-15": "0.5", "2026-10-16": "1" });
      expect((await api("emp").get("/mine?month=2026-10")).body).toMatchObject({ active: false, me: null });
    });
    it("a rule confirmed but switched off (every band a salary cut): byte-for-byte the same days, nothing rewritten", async () => {
      await setLate("late.rule", { ...ON_OCT, active: false, bands: ON_OCT.bands.map(() => ({ outcome: { kind: "CUT", days: "1" }, applies: { mode: "EVERY_TIME" } })) });
      expect(await loadAttendanceDayHook(ids(), "2026-10-01", "2026-11-09", { dryRun: true })).toBeNull();
      const again = await computeAttendance(ids(), "2026-10-01", "2026-11-09");
      expect(again.changed).toBe(0);
      expect(await snapshot(ids())).toBe(before);
    });
    it("ON with every band 'no consequence': still byte-for-byte the same days (a late mark is never loss of pay)", async () => {
      await setLate("late.rule", { ...ON_OCT, bands: ON_OCT.bands.map(() => ({ outcome: { kind: "NONE" }, applies: { mode: "EVERY_TIME" } })) });
      expect(await loadAttendanceDayHook(ids(), "2026-10-01", "2026-11-09", { dryRun: true })).not.toBeNull();
      expect((await computeAttendance(ids(), "2026-10-01", "2026-11-09")).changed).toBe(0);
      expect(await snapshot(ids())).toBe(before);
      await setLate("late.rule", { ...ON_OCT, bands: ON_OCT.bands.map(() => ({ outcome: { kind: "MARK" }, applies: { mode: "AFTER_FREE", free: 1 } })) });
      expect((await computeAttendance(ids(), "2026-10-01", "2026-11-09")).changed).toBe(0);
      expect(await snapshot(ids())).toBe(before);
    });
  });

  describe("settings: two directors, effective-dated", () => {
    it("only a director proposes; the proposer never confirms; HR and the Developer are refused", async () => {
      const value = { ...ON_OCT };
      expect((await api("hr").post("/settings/late.rule/proposals", { value, reason: "HR tries" })).body.error.code).toBe("DIRECTOR_ONLY");
      expect((await api("dev").post("/settings/late.rule/proposals", { value, reason: "Dev tries" })).status).toBe(403);
      expect((await api("hr").get("/settings")).status).toBe(403);
      const prop = await api("d1").post("/settings/late.rule/proposals", { value, reason: "Owners decided" });
      expect((await api("d1").post(`/settings/proposals/${prop.body.id}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
      await expect(prisma.behaviourConfirmation.create({ data: { proposalId: prop.body.id, confirmedByUserId: p.d1.userId } })).rejects.toThrow();
      expect((await api("d1").post("/settings/late.rule/proposals", { value: { ...value, effectiveFrom: "2026-10-05" }, reason: "Mid month" })).status).toBe(400);
      expect((await api("d1").post("/settings/late.rule/proposals", { value: { ...value, cutoffs: [value.cutoffs[1], value.cutoffs[0], value.cutoffs[2]] }, reason: "Bad order" })).status).toBe(400);
      expect((await api("d1").post("/settings/late.rule/proposals", { value: { ...value, bands: [{ outcome: { kind: "PENALTY", amount: "100" }, applies: { mode: "EVERY_TIME" } }, value.bands[1], value.bands[2]] }, reason: "No head" })).status).toBe(400);
      expect((await api("d1").post("/settings/late.rule/proposals", { value: { ...value, penaltyHead: "NO_SUCH_HEAD", bands: [{ outcome: { kind: "PENALTY", amount: "100" }, applies: { mode: "EVERY_TIME" } }, value.bands[1], value.bands[2]] }, reason: "Unknown head" })).body.error.code).toBe("UNKNOWN_SALARY_HEAD");
      expect((await api("d2").post(`/settings/proposals/${prop.body.id}/confirm`)).status).toBe(200);
      const list = (await api("d1").get("/settings")).body;
      expect(list.settings.map((s: { key: string; defaultInUse: boolean }) => [s.key, s.defaultInUse])).toEqual([["late.rule", false], ["late.missingPunch", true], ["late.halfDay", true]]);
      expect(list.settings[1].defaultText).toBe("Default in use: absent, a full day of loss of pay (as today)");
    });
    it("a setting cannot start in a finalised month", async () => {
      const lock = await prisma.attendancePeriodLock.create({ data: { periodStart: new Date("2026-09-01T00:00:00Z"), periodEnd: new Date("2026-09-30T00:00:00Z"), action: "FINALISE", actorUserId: p.d1.userId } });
      lockIds.push(lock.id);
      expect((await api("d1").post("/settings/late.rule/proposals", { value: { ...ON_OCT, effectiveFrom: "2026-09-01" }, reason: "Into a final month" })).body.error.code).toBe("MONTH_FINALISED");
    });
  });

  describe("GOLDEN: ON with the proposed starting values, through the real engine", () => {
    it("every boundary, the 3rd vs 4th arrival, and the higher-of on short-hours days", async () => {
      await computeAttendance(ids(), "2026-10-01", "2026-11-09");
      expect(await lop(p.emp, "2026-10-05", "2026-10-16")).toEqual({
        "2026-10-05": "0", // 10:09 on time
        "2026-10-06": "0", // 10:10 band 1, Not set
        "2026-10-07": "0", // 10:19 band 1
        "2026-10-08": "0", // 10:20 allowance 1
        "2026-10-09": "0", // 10:29 allowance 2
        "2026-10-10": "0.5", // 10:30 band 3
        "2026-10-11": "0", // Sunday
        "2026-10-12": "0.5", // 10:31 band 3
        "2026-10-13": "0", // allowance 3
        "2026-10-14": "0.5", // the 4th
        "2026-10-15": "0.5", // the 5th on a half day: the higher, not 1
        "2026-10-16": "1", // half-day minimum not met (1) and band 3 (0.5): 1
      });
      const mine = (await api("emp").get("/mine?month=2026-10")).body;
      expect(mine.active).toBe(true);
      expect(mine.me.allowances).toEqual([{ band: 2, bandLabel: "10:20 to 10:30", free: 3, used: 3, left: 0 }]);
      expect(mine.me.arrivals.map((a: { time: string; consequence: { kind: string } }) => `${a.time} ${a.consequence.kind}`)).toEqual(["10:10 NOT_SET", "10:19 NOT_SET", "10:20 FREE", "10:29 FREE", "10:30 CUT", "10:31 CUT", "10:25 FREE", "10:25 CUT", "10:25 CUT", "10:31 CUT"]);
    });
    it("a missing punch is never a late arrival; a later recompute changes nothing", async () => {
      expect((await api("mgr").get("/team?month=2026-10")).body.people.find((x: { employeeId: string }) => x.employeeId === p.emp2.employeeId).arrivals.map((a: { date: string }) => a.date)).toEqual(["2026-10-12"]);
      expect((await computeAttendance(ids(), "2026-10-01", "2026-11-09")).changed).toBe(0);
    });
    it("GOLDEN a new month resets the counter (November: the first arrival 10:20 to 10:30 is allowance 1)", async () => {
      expect(await lop(p.emp, "2026-11-02", "2026-11-02")).toEqual({ "2026-11-02": "0" });
      const nov = (await api("emp").get("/mine?month=2026-11")).body;
      expect(nov.me.allowances[0]).toMatchObject({ used: 1, left: 2 });
    });
  });

  describe("missing punch and half-day thresholds (two directors, today's behaviour by default)", () => {
    it("chosen for November only: October keeps today's behaviour", async () => {
      await setLate("late.missingPunch", { effectiveFrom: "2026-11-01", outcome: "HALF_DAY" });
      await computeAttendance([p.emp2.employeeId], "2026-10-01", "2026-11-09");
      expect(await lop(p.emp2, "2026-10-13", "2026-10-14")).toEqual({ "2026-10-13": "1", "2026-10-14": "0.5" });
      await purgeSettings();
      await setLate("late.rule", ON_OCT);
      await setLate("late.missingPunch", { effectiveFrom: "2026-10-01", outcome: "PRESENT_FLAGGED" });
      await setLate("late.halfDay", { effectiveFrom: "2026-10-01", fullDayMinMinutes: 330, halfDayMinMinutes: 180, halfDayMinNotMetLopDays: "1" });
      await computeAttendance([p.emp2.employeeId], "2026-10-01", "2026-11-09");
      const days = await prisma.dailyAttendance.findMany({ where: { employeeId: p.emp2.employeeId, date: { in: [new Date("2026-10-13T00:00:00Z"), new Date("2026-10-14T00:00:00Z")] } }, orderBy: { date: "asc" } });
      expect(days.map((d) => [d.status, d.lopDays.toString(), d.exceptionFlags])).toEqual([["P", "0", ["MISSING_PUNCH"]], ["P", "0", ["EARLY_OUT"]]]);
      await purgeSettings();
      await setLate("late.rule", ON_OCT);
      await computeAttendance([p.emp2.employeeId], "2026-10-01", "2026-11-09");
      expect(await lop(p.emp2, "2026-10-13", "2026-10-14")).toEqual({ "2026-10-13": "1", "2026-10-14": "0.5" });
    });
  });

  describe("who sees what", () => {
    it("an employee sees only their own; their team view is empty", async () => {
      const own = (await api("emp2").get("/mine?month=2026-10")).body;
      expect(own.me.employeeId).toBe(p.emp2.employeeId);
      expect(JSON.stringify(own)).not.toContain(p.emp.employeeId);
      expect((await api("emp").get("/team?month=2026-10")).body).toMatchObject({ isManager: false, people: [] });
    });
    it("a manager sees only their direct reports; another manager's team is invisible", async () => {
      const team = (await api("mgr").get("/team?month=2026-10")).body;
      expect(team.people.map((x: { employeeId: string }) => x.employeeId).sort()).toEqual([p.emp.employeeId, p.emp2.employeeId].sort());
      const other = (await api("otherMgr").get("/team?month=2026-10")).body;
      expect(other.people.map((x: { employeeId: string }) => x.employeeId)).toEqual([p.other.employeeId]);
    });
    it("HR and managers decide nothing they may not: the waiver queue is HR's, settings and penalties directors'", async () => {
      expect((await api("emp").get("/waivers")).status).toBe(403);
      expect((await api("mgr").get("/waivers")).status).toBe(403);
      expect((await api("hrx").get("/waivers")).status).toBe(403); // HR_EXECUTIVE does not hold Manual Override (attendance.override.manage)
      expect((await api("hr").get("/waivers")).status).toBe(200);
      for (const who of ["hr", "hrx", "mgr", "emp"] as const) {
        expect((await api(who).get("/penalties?month=2026-10")).status).toBe(403);
        expect((await api(who).get("/settings")).status).toBe(403);
      }
    });
    it("the Developer is refused on every route (403)", async () => {
      for (const path of ["/mine", "/team", "/waivers", "/settings", "/penalties?month=2026-10"]) expect((await api("dev").get(path)).status).toBe(403);
      for (const path of ["/waivers", "/waivers/x/approve", "/waivers/x/reject", "/waivers/x/withdraw", "/settings/late.rule/proposals", "/settings/proposals/x/confirm", "/penalties/post"]) expect((await api("dev").post(path, {})).status).toBe(403);
    });
  });

  describe("waivers: manager asks, HR decides (maker-checker, audited)", () => {
    let waiverId = "";
    it("only the reporting manager asks, never for themselves, only for a late arrival", async () => {
      expect((await api("emp").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-08", reason: "Traffic" })).body.error.code).toBe("OWN_ARRIVAL");
      expect((await api("otherMgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-08", reason: "Traffic" })).body.error.code).toBe("NOT_YOUR_TEAM");
      expect((await api("hr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-08", reason: "Traffic" })).body.error.code).toBe("NOT_YOUR_TEAM");
      expect((await api("mgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-05", reason: "On time day" })).body.error.code).toBe("NOT_LATE");
      const r = await api("mgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-08", reason: "Metro breakdown, informed in advance" });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      waiverId = r.body.id;
      expect((await api("mgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-08", reason: "Again" })).body.error.code).toBe("ALREADY_ASKED");
      expect(await prisma.notification.count({ where: { type: "lateness.waiver.requested", userId: p.hr.userId } })).toBeGreaterThan(0);
    });
    it("HR sees the request with no pay figure; a manager cannot decide it", async () => {
      const list = (await api("hr").get("/waivers")).body.waivers;
      const row = list.find((w: { id: string }) => w.id === waiverId);
      expect(row).toMatchObject({ date: "2026-10-08", time: "10:20", bandLabel: "10:20 to 10:30", status: "PENDING" });
      expect(JSON.stringify(list)).not.toMatch(/amount|₹|salary|lop/i);
      expect((await api("mgr").post(`/waivers/${waiverId}/approve`)).status).toBe(403);
    });
    it("GOLDEN approval returns the allowance: the 4th arrival becomes the 3rd (no cut), the 5th keeps the higher-of", async () => {
      expect((await api("hrx").post(`/waivers/${waiverId}/approve`)).status).toBe(403);
      expect((await api("hr2").post(`/waivers/${waiverId}/approve`)).status).toBe(200);
      expect(await lop(p.emp, "2026-10-13", "2026-10-15")).toEqual({ "2026-10-13": "0", "2026-10-14": "0", "2026-10-15": "0.5" });
      const mine = (await api("emp").get("/mine?month=2026-10")).body.me;
      expect(mine.arrivals.find((a: { date: string }) => a.date === "2026-10-08")).toMatchObject({ consequence: { kind: "WAIVED" }, waiver: { status: "APPROVED" } });
      expect(mine.allowances[0]).toMatchObject({ used: 3, left: 0 });
      expect(await prisma.auditLog.count({ where: { entityId: waiverId, action: { startsWith: "attendance.lateness.waiver." } } })).toBe(2);
      expect(await prisma.notification.count({ where: { type: "lateness.waiver.approved", userId: { in: [p.emp.userId, p.mgr.userId] } } })).toBe(2);
      expect((await api("hr").post(`/waivers/${waiverId}/reject`, { note: "changed mind" })).body.error.code).toBe("ALREADY_DECIDED");
    });
    it("self-approval is refused: by the service (requester, or one's own arrival) and by the database", async () => {
      const asked = await prisma.lateWaiver.create({ data: { employeeId: p.emp2.employeeId, date: new Date("2026-10-12T00:00:00Z"), reason: "HR asked itself", requestedByUserId: p.hr.userId } });
      expect((await api("hr").post(`/waivers/${asked.id}/approve`)).body.error.code).toBe("CHECKER_IS_MAKER");
      await expect(prisma.lateWaiver.update({ where: { id: asked.id }, data: { status: "APPROVED", decidedByUserId: p.hr.userId, decidedAt: new Date() } })).rejects.toThrow();
      const own = await prisma.lateWaiver.create({ data: { employeeId: p.hr2.employeeId, date: new Date("2026-10-12T00:00:00Z"), reason: "Own arrival", requestedByUserId: p.mgr.userId } });
      expect((await api("hr2").post(`/waivers/${own.id}/approve`)).body.error.code).toBe("OWN_ARRIVAL");
      expect((await api("hr").post(`/waivers/${asked.id}/reject`, { note: "x" })).status).toBe(400);
    });
    it("a day in a finalised period cannot be waived", async () => {
      const lock = await prisma.attendancePeriodLock.create({ data: { periodStart: new Date("2026-10-12T00:00:00Z"), periodEnd: new Date("2026-10-12T00:00:00Z"), action: "FINALISE", actorUserId: p.d1.userId } });
      lockIds.push(lock.id);
      expect((await api("mgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-10-12", reason: "Finalised" })).body.error.code).toBe("MONTH_FINALISED");
      await deleteWithDependents("AttendancePeriodLock", [lock.id]);
      lockIds.splice(lockIds.indexOf(lock.id), 1);
    });
  });

  describe("effective dating and the penalty (the existing deductions path)", () => {
    it("November takes a penalty version; October keeps its own; attendance on penalty days is untouched", async () => {
      await setLate("late.rule", { ...ON_OCT, effectiveFrom: "2026-11-01", bands: [ON_OCT.bands[0], ON_OCT.bands[1], { outcome: { kind: "PENALTY", amount: "250" }, applies: { mode: "EVERY_TIME" } }], penaltyHead });
      const octBefore = await lop(p.emp, "2026-10-01", "2026-10-31");
      await computeAttendance(ids(), "2026-10-01", "2026-11-09");
      expect(await lop(p.emp, "2026-10-01", "2026-10-31")).toEqual(octBefore);
      expect(await lop(p.emp, "2026-11-03", "2026-11-04")).toEqual({ "2026-11-03": "0", "2026-11-04": "0" });
      const nov = (await api("emp").get("/mine?month=2026-11")).body.me;
      expect(nov.arrivals.filter((a: { consequence: { kind: string; amount?: string } }) => a.consequence.kind === "PENALTY").map((a: { consequence: { amount: string } }) => a.consequence.amount)).toEqual(["250", "250"]);
      const team = (await api("mgr").get("/team?month=2026-11")).body;
      expect(JSON.stringify(team)).not.toContain("250");
    });
    it("a director posts one labelled deduction per penalised arrival; posting again changes nothing; a waiver cancels its line", async () => {
      const plan = (await api("d1").get("/penalties?month=2026-11")).body;
      const mineRows = plan.rows.filter((r: { employeeId: string }) => r.employeeId === p.emp.employeeId);
      expect(mineRows.map((r: { date: string; status: string; charge: string }) => [r.date, r.status, r.charge])).toEqual([["2026-11-03", "TO_POST", "250"], ["2026-11-04", "TO_POST", "250"]]);
      expect((await api("d1").post("/penalties/post", { month: "2026-11", fingerprint: "0".repeat(64) })).body.error.code).toBe("PREVIEW_STALE");
      expect((await api("d1").post("/penalties/post", { month: "2026-11", fingerprint: plan.fingerprint })).status).toBe(200);
      const adj = await prisma.payrollAdjustment.findMany({ where: { employeeId: p.emp.employeeId, status: "PENDING" }, orderBy: { sourceRef: "asc" } });
      expect(adj.map((a) => [a.componentCode, a.direction, a.amount.toString(), a.reason])).toEqual([
        [penaltyHead, "DEDUCTION", "250", "Lateness penalty: arrived 10:35 on 2026-11-03 (after 10:30)"],
        [penaltyHead, "DEDUCTION", "250", "Lateness penalty: arrived 10:40 on 2026-11-04 (after 10:30)"],
      ]);
      const again = (await api("d1").get("/penalties?month=2026-11")).body;
      expect(again.rows.filter((r: { employeeId: string }) => r.employeeId === p.emp.employeeId).map((r: { status: string }) => r.status)).toEqual(["POSTED", "POSTED"]);
      const w = await api("mgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-11-03", reason: "Client visit first" });
      await api("hr").post(`/waivers/${w.body.id}/approve`);
      const after = (await api("d1").get("/penalties?month=2026-11")).body;
      expect(after.toCancel.map((c: { sourceRef: string }) => c.sourceRef)).toEqual([adj[0]!.sourceRef]);
      await api("d1").post("/penalties/post", { month: "2026-11", fingerprint: after.fingerprint });
      expect((await prisma.payrollAdjustment.findMany({ where: { employeeId: p.emp.employeeId, status: "PENDING" } })).map((a) => a.amount.toString())).toEqual(["250"]);
    });
    it("a director's own penalty is posted by the other director", async () => {
      await punch(p.d1, "2026-11-05", "10:50");
      await punch(p.d1, "2026-11-05", "19:00");
      await computeAttendance([p.d1.employeeId], "2026-11-01", "2026-11-09");
      expect((await api("d1").get("/penalties?month=2026-11")).body.rows.find((r: { employeeId: string }) => r.employeeId === p.d1.employeeId).status).toBe("OWN_PAY");
      expect((await api("d2").get("/penalties?month=2026-11")).body.rows.find((r: { employeeId: string }) => r.employeeId === p.d1.employeeId).status).toBe("TO_POST");
    });
  });

  describe("Ready for First Run", () => {
    it("non-blocking rows: rule on/off, the undecided band, the penalty law review, and the two defaults", async () => {
      await purgeSettings();
      const report = await buildSetupReport();
      const rows = report.sections.flatMap((s) => s.items).filter((i) => i.id.startsWith("lateness:"));
      expect(rows.map((r) => [r.title, r.required, r.behaviour?.label])).toEqual([
        ["Lateness rule: off", false, "Off"],
        ["Lateness band 10:10 to 10:20: owner to decide", false, "Owner to decide"],
        ["Lateness penalty: owners to confirm it is allowed", false, "Owner review"],
        ["Missing punch (only one punch on a working day)", false, "Default in use"],
        ["Half-day thresholds", false, "Default in use"],
      ]);
      expect(rows[2]!.detail).toContain("Payment of Wages Act");
    });
  });
});
