import request from "supertest";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { DEFAULT_DEVICE_ALERT_SETTINGS, DEVICE_ALERT_SETTING_KEY } from "../../../lib/deviceAlertSettings";
import { mailService } from "../../../integrations/mail";
import { prisma } from "../../../lib/prisma";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { ingestionVolume } from "../health/queries";
import { runDeviceHealthChecks } from "../health/runner";

// Gate G3 of Phase 2 (docs/plans/PHASE_2.md §12, "P2-H build design"): a silenced
// device raises an HR alert during working hours and not on a Sunday or a
// holiday; a silenced agent does too; each recovers with one notice that says
// what was missed; and the same fault never opens a second incident. The check
// takes `now`, so every case puts the clock exactly where it wants it.
const ist = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+05:30`);
const TUE = "2026-10-06";
const WED = "2026-10-07"; // a working day (GEN 10:00–19:00, Sunday off)
const SAT = "2026-10-10";
const SUN = "2026-10-11";
const MON = "2026-10-12";
const HOLIDAY = "2026-10-21"; // Dussehra, in the seeded company calendar (a Wednesday)
const suffix = Date.now().toString(36).slice(-5);

type Person = { employeeId: string; employeeCode: string; userId: string };

describe("device and agent health (P2-H)", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"hr" | "emp" | "boss" | "a" | "b" | "c", Person>;
  let agentId = "";
  let agentDeviceId = "";
  let pushDeviceId = "";
  let hrToken = "";
  let empToken = "";
  let savedAlerts: unknown = null;
  const mail = vi.spyOn(mailService, "send").mockResolvedValue(undefined);

  const mine = <T extends { deviceId: string | null; agentId: string | null }>(xs: T[]) => xs.filter((x) => x.deviceId === agentDeviceId || x.deviceId === pushDeviceId || x.agentId === agentId);
  const incidents = (where: object = {}) => prisma.deviceIncident.findMany({ where: { OR: [{ deviceId: { in: [agentDeviceId, pushDeviceId] } }, { agentId }], ...where }, orderBy: { openedAt: "asc" } });
  const notificationsFor = (employeeId: string, type?: string) => prisma.notification.findMany({ where: { user: { employeeId }, ...(type ? { type } : {}) }, orderBy: { createdAt: "asc" } });

  /** The agent's last successful read of the device, and its own heartbeat, as they would stand at `at`. */
  async function setState(opts: { read?: Date | null; heartbeat?: Date | null; pushContact?: Date | null; clockOffset?: number; logPercent?: number }) {
    if (opts.read !== undefined || opts.clockOffset !== undefined || opts.logPercent !== undefined) {
      const read = opts.read ?? new Date();
      await prisma.device.update({
        where: { id: agentDeviceId },
        data: { agentReportAt: new Date(), agentReport: { state: "OK", reachable: true, serverLastReadAt: read.toISOString(), clockOffsetSeconds: opts.clockOffset ?? 0, logCount: opts.logPercent ?? 100, logCapacity: 10_000 } },
      });
    }
    if (opts.heartbeat !== undefined) await prisma.biometricAgent.update({ where: { id: agentId }, data: { lastHeartbeatAt: opts.heartbeat } });
    if (opts.pushContact !== undefined) await prisma.device.update({ where: { id: pushDeviceId }, data: { lastHeartbeatAt: opts.pushContact, lastReceivedAt: opts.pushContact } });
  }

  /** Raw punches are immutable; the schema-driven cleanup knows the one test-only way to remove them. */
  async function removeTestPunches() {
    const where = { deviceId: { in: [agentDeviceId, pushDeviceId] } };
    await deleteWithDependents("RawPunch", (await prisma.rawPunch.findMany({ where, select: { id: true } })).map((r) => r.id));
    await deleteWithDependents("IngestionBatch", (await prisma.ingestionBatch.findMany({ where, select: { id: true } })).map((r) => r.id));
  }

  /**
   * One health check with the clock at `now`. The back-door device (push) is kept healthy unless a case is about it, so each case sees only
   * its own fault: a device nobody has heard from since registration is, rightly, an incident of its own.
   */
  async function check(now: Date, opts: { pushSilent?: boolean } = {}) {
    if (!opts.pushSilent) await setState({ pushContact: now });
    return runDeviceHealthChecks(now);
  }

  async function punch(deviceId: string, employee: Person, at: Date, receivedAt = at) {
    const batch = await prisma.ingestionBatch.create({ data: { route: "AGENT", deviceId, receivedAt, committedAt: receivedAt } });
    const local = new Date(at.getTime() + 330 * 60_000).toISOString();
    await prisma.rawPunch.create({
      data: { deviceId, deviceUserId: employee.employeeCode, punchedAt: at, localTime: local.slice(0, 19).replace("T", " "), businessDate: new Date(`${local.slice(0, 10)}T00:00:00Z`), status: "1", verifyMode: "255", workcode: "0", reserved: "0", rawLine: "x", route: "AGENT", batchId: batch.id, receivedAt, employeeId: employee.employeeId },
    });
  }

  beforeAll(async () => {
    org = await createEmployeeTestOrgMasters();
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" });
    p.boss = await createFullTestEmployee(org, { roleCode: "SUPER_ADMIN" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    p.a = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    p.b = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    p.c = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    hrToken = await loginAs(p.hr.employeeCode);
    empToken = await loginAs(p.emp.employeeCode);
    savedAlerts = (await prisma.systemSetting.findUnique({ where: { key: DEVICE_ALERT_SETTING_KEY } }))?.value ?? null;
    await setSetting(DEVICE_ALERT_SETTING_KEY, { ...DEFAULT_DEVICE_ALERT_SETTINGS, alertEmails: ["ops@example.com"] }, p.hr.userId);

    const agent = await prisma.biometricAgent.create({ data: { name: `H agent ${suffix}`, keyHash: `h-${suffix}-${Math.random()}`, keyPrefix: "hhhh", createdByUserId: p.hr.userId } });
    agentId = agent.id;
    // Registered long before the dates these cases use, so a "last heard from" never falls back to a registration that is later than the test's clock.
    const base = { locationId: org.locationId, isSimulated: true, syncFrom: new Date("2026-01-01"), createdAt: new Date("2026-01-01T00:00:00Z") };
    agentDeviceId = (await prisma.device.create({ data: { ...base, serialNumber: `HA-${suffix}`, name: `Entrance ${suffix}`, route: "AGENT", agentId } })).id;
    pushDeviceId = (await prisma.device.create({ data: { ...base, serialNumber: `HP-${suffix}`, name: `Back door ${suffix}`, route: "PUSH" } })).id;
    expect(await prisma.holiday.findUnique({ where: { date: new Date(`${HOLIDAY}T00:00:00Z`) } }), "the seed's company calendar should hold Dussehra").toBeTruthy();
  });

  afterEach(async () => {
    mail.mockClear();
    await prisma.deviceIncident.deleteMany({ where: { OR: [{ deviceId: { in: [agentDeviceId, pushDeviceId] } }, { agentId }] } });
    await prisma.notification.deleteMany({ where: { type: { startsWith: "attendance.device.incident" }, user: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } } } });
    await removeTestPunches();
  });

  afterAll(async () => {
    mail.mockRestore();
    if (savedAlerts === null) await prisma.systemSetting.deleteMany({ where: { key: DEVICE_ALERT_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: DEVICE_ALERT_SETTING_KEY }, data: { value: savedAlerts as never } });
    await purgeAppendOnly("AuditLog", { entityId: { in: ["deviceAlerts"] } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await removeTestPunches();
    await deleteWithDependents("Device", [agentDeviceId, pushDeviceId]);
    await deleteWithDependents("BiometricAgent", [agentId]);
    await cleanupEmployeeTestOrgMasters(org);
  });

  describe("a device that goes quiet", () => {
    it("opens one incident after 30 minutes without contact during working hours, tells HR, and never opens a second", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "10:59") });
      // 10:20: only 15 minutes; 10:34: 29; nothing yet.
      for (const t of ["10:20", "10:34"]) {
        await setState({ heartbeat: ist(WED, t) });
        expect(mine((await check(ist(WED, t))).opened)).toEqual([]);
      }
      await setState({ heartbeat: ist(WED, "10:36") });
      const r = await check(ist(WED, "10:36")); // 31 minutes since 10:05
      expect(mine(r.opened).map((o) => o.kind)).toEqual(["DEVICE_SILENT"]);
      // The same fault on later checks is still one incident, and one notice.
      for (const t of ["10:37", "10:50", "11:30"]) {
        await setState({ heartbeat: ist(WED, t) });
        await check(ist(WED, t));
      }
      const open = await incidents();
      expect(open).toHaveLength(1);
      expect(open[0]).toMatchObject({ kind: "DEVICE_SILENT", deviceId: agentDeviceId, resolvedAt: null });
      expect(await notificationsFor(p.hr.employeeId, "attendance.device.incident")).toHaveLength(1);
      const n = (await notificationsFor(p.hr.employeeId, "attendance.device.incident"))[0]!;
      expect(n.title).toMatch(/has gone quiet/);
      expect(n.body).toMatch(/Punches made now are not reaching the system/);
    });

    it("tells exactly the permission holders, the Super Admins and the free list: in-app and by email", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await check(ist(WED, "11:00"));
      expect(await notificationsFor(p.hr.employeeId, "attendance.device.incident")).toHaveLength(1);
      expect(await notificationsFor(p.boss.employeeId, "attendance.device.incident")).toHaveLength(1);
      expect(await notificationsFor(p.emp.employeeId, "attendance.device.incident")).toHaveLength(0); // an ordinary employee is told nothing
      const personal = async (e: Person) => (await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: e.employeeId } })).personalEmail.toLowerCase();
      const to = mail.mock.calls.map(([m]) => m.to);
      expect(to).toEqual(expect.arrayContaining(["ops@example.com", await personal(p.hr), await personal(p.boss)]));
      expect(to).not.toContain(await personal(p.emp));
      expect(new Set(to).size).toBe(to.length); // nobody emailed twice
    });

    it("leaves the Super Admins out of the emails when the setting says so", async () => {
      await setSetting(DEVICE_ALERT_SETTING_KEY, { ...DEFAULT_DEVICE_ALERT_SETTINGS, alertEmails: ["ops@example.com"], alertSuperAdmins: false }, p.hr.userId);
      try {
        await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
        await check(ist(WED, "11:00"));
        const bossEmail = (await prisma.employeePersonal.findUniqueOrThrow({ where: { employeeId: p.boss.employeeId } })).personalEmail.toLowerCase();
        // A Super Admin holds every permission, so they are still a holder and still told; the setting only adds the rest of them.
        expect(mail.mock.calls.map(([m]) => m.to)).toContain(bossEmail);
      } finally {
        await setSetting(DEVICE_ALERT_SETTING_KEY, { ...DEFAULT_DEVICE_ALERT_SETTINGS, alertEmails: ["ops@example.com"] }, p.hr.userId);
      }
    });

    it("raises nothing on a Sunday or a company holiday, however long it is quiet", async () => {
      await setState({ read: ist(SUN, "08:00"), heartbeat: ist(SUN, "13:00") });
      expect(mine((await check(ist(SUN, "13:00"))).opened)).toEqual([]);
      await setState({ read: ist(HOLIDAY, "08:00"), heartbeat: ist(HOLIDAY, "13:00") });
      expect(mine((await check(ist(HOLIDAY, "13:00"))).opened)).toEqual([]);
      expect(await incidents()).toHaveLength(0);
    });

    it("raises nothing outside working hours: after the shift ends, or in the night", async () => {
      await setState({ read: ist(WED, "15:00"), heartbeat: ist(WED, "21:00") });
      expect(mine((await check(ist(WED, "21:00"))).opened)).toEqual([]);
      await setState({ read: ist(WED, "15:00"), heartbeat: ist(WED, "03:00") });
      expect(mine((await check(ist(WED, "03:00"))).opened)).toEqual([]);
    });

    it("recovers once, and the notice says how long, how many punches arrived and who is still missing", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await check(ist(WED, "11:00"));
      // The gap 10:05–14:52: two people punched during it; the catch-up reaches the server when contact returns.
      await punch(agentDeviceId, p.a, ist(WED, "10:40"), ist(WED, "14:51"));
      await punch(agentDeviceId, p.b, ist(WED, "12:10"), ist(WED, "14:51"));
      await setState({ read: ist(WED, "14:52"), heartbeat: ist(WED, "14:52") });
      const back = await check(ist(WED, "14:52"));
      expect(mine(back.resolved).map((o) => o.kind)).toEqual(["DEVICE_SILENT"]);
      expect((await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered"))).toHaveLength(0); // settling: the backlog may still be arriving
      await check(ist(WED, "14:53"));
      expect((await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered"))).toHaveLength(0);
      await check(ist(WED, "14:55")); // 3 minutes later
      const notices = await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered");
      expect(notices).toHaveLength(1);
      expect(notices[0]!.body).toMatch(/back online after 4 h 47 min \(10:05–14:52\)/);
      expect(notices[0]!.body).toMatch(/2 punches made during that time have now arrived/);
      expect(notices[0]!.body).toMatch(/check whether anyone's attendance needs correcting/);
      // Four people are expected at this branch; two have punched.
      expect(notices[0]!.body).toMatch(/\b4 people are expected|\b2 people are expected/);
      for (const t of ["14:56", "15:30"]) await check(ist(WED, t));
      expect(await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered")).toHaveLength(1); // once
      expect((await incidents())[0]!.recoverySummary).toMatchObject({ arrivedPunches: 2 });
    });

    it("says plainly when nothing made during the gap has arrived", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await check(ist(WED, "11:00"));
      await setState({ read: ist(WED, "12:00"), heartbeat: ist(WED, "12:00") });
      await check(ist(WED, "12:00"));
      await check(ist(WED, "12:03"));
      const n = (await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered"))[0]!;
      expect(n.body).toMatch(/No punches made during that time have arrived/);
      expect(n.body).toMatch(/may still be on the device, or lost if its log wrapped/);
    });

    it("a device that is switched off in the system closes its incident quietly: no recovery notice for something that is gone", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await check(ist(WED, "11:00"));
      await prisma.device.update({ where: { id: agentDeviceId }, data: { isActive: false } });
      try {
        await check(ist(WED, "11:05"));
        await check(ist(WED, "11:30"));
        expect((await incidents())[0]!.resolvedAt).not.toBeNull();
        expect(await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered")).toHaveLength(0);
      } finally {
        await prisma.device.update({ where: { id: agentDeviceId }, data: { isActive: true } });
      }
    });

    it("a device nobody has ever heard from has not 'gone quiet': alerts are for things that stop, and the Devices screen says it is not connected yet", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await prisma.device.update({ where: { id: pushDeviceId }, data: { lastHeartbeatAt: null, lastReceivedAt: null } });
      const r = await runDeviceHealthChecks(ist(WED, "12:00"));
      expect(mine(r.opened).filter((o) => o.deviceId === pushDeviceId)).toEqual([]);
      const devices = (await request(app).get("/api/biometric/devices").set(...authHeader(hrToken))).body.devices as Array<{ id: string; status: string }>;
      expect(devices.find((d) => d.id === pushDeviceId)?.status).toBe("NOT_CONNECTED");
    });

    it("watches a push device by its own polling", async () => {
      await setState({ read: ist(WED, "10:55"), heartbeat: ist(WED, "11:00"), pushContact: ist(WED, "10:10") });
      const r = await check(ist(WED, "11:00"), { pushSilent: true });
      expect(mine(r.opened).filter((o) => o.deviceId === pushDeviceId).map((o) => o.kind)).toEqual(["DEVICE_SILENT"]);
      await setState({ read: ist(WED, "11:01"), heartbeat: ist(WED, "11:01"), pushContact: ist(WED, "11:01") });
      expect(mine((await check(ist(WED, "11:01"))).resolved).filter((o) => o.deviceId === pushDeviceId)).toHaveLength(1);
    });
  });

  describe("an agent that goes quiet", () => {
    it("opens when its heartbeat is 5 minutes late, at any hour, on its own: its devices do not each raise another", async () => {
      await setState({ read: ist(SUN, "02:00"), heartbeat: ist(SUN, "02:00") });
      const r = await check(ist(SUN, "02:06")); // a Sunday, 2 a.m.: an agent that is down at 2 a.m. is down at 9
      expect(mine(r.opened).map((o) => o.kind)).toEqual(["AGENT_SILENT"]);
      // The next working morning the agent is still silent: its device does not get a second incident of its own.
      await check(ist(MON, "11:00"));
      const open = await incidents({ resolvedAt: null });
      expect(open.map((i) => i.kind)).toEqual(["AGENT_SILENT"]);
      expect((await notificationsFor(p.hr.employeeId, "attendance.device.incident"))[0]!.title).toMatch(/has stopped reporting/);
    });

    it("recovers with a notice that counts the catch-up across its devices", async () => {
      await setState({ read: ist(WED, "10:00"), heartbeat: ist(WED, "10:00") });
      await check(ist(WED, "10:06"));
      await punch(agentDeviceId, p.c, ist(WED, "10:30"), ist(WED, "11:20"));
      await setState({ read: ist(WED, "11:20"), heartbeat: ist(WED, "11:20") });
      await check(ist(WED, "11:20"));
      await check(ist(WED, "11:23"));
      const n = (await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered"))[0]!;
      expect(n.title).toMatch(/is back after 1 h 20 min/);
      expect(n.body).toMatch(/The sync agent is back online after 1 h 20 min \(10:00–11:20\)/);
      expect(n.body).toMatch(/1 punch made during that time has now arrived/);
    });
  });

  describe("a PC that is off overnight", () => {
    it("recovering before the shift starts does not claim people are missing a punch", async () => {
      await setState({ read: ist(TUE, "19:00"), heartbeat: ist(TUE, "19:00") });
      await check(ist(TUE, "19:06")); // the agent PC was switched off at 19:00
      await setState({ read: ist(WED, "08:00"), heartbeat: ist(WED, "08:00") });
      await check(ist(WED, "08:00")); // switched on again at 08:00, two hours before the 10:00 shift
      await check(ist(WED, "08:03"));
      const n = (await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered"))[0]!;
      expect(n.body).toMatch(/hasn't started yet/);
      expect(n.body).not.toMatch(/with no punch yet today|Everyone expected today has a punch/);
    });
  });

  describe("the morning check", () => {
    it("fires when the device is reachable but nobody has punched by the check time, and clears on the first punch", async () => {
      await punch(agentDeviceId, p.a, ist("2026-10-05", "10:02")); // it normally has punches
      await setState({ read: ist(WED, "10:20"), heartbeat: ist(WED, "10:20") });
      expect(mine((await check(ist(WED, "10:20"))).opened)).toEqual([]); // before 10:30
      await setState({ read: ist(WED, "10:40"), heartbeat: ist(WED, "10:40") });
      const r = await check(ist(WED, "10:40"));
      expect(mine(r.opened).map((o) => o.kind)).toEqual(["NO_PUNCHES_TODAY"]);
      const n = (await notificationsFor(p.hr.employeeId, "attendance.device.incident"))[0]!;
      expect(n.body).toMatch(/reachable and \d+ (people are|person is) expected, but nobody has punched today/);
      await punch(agentDeviceId, p.b, ist(WED, "10:55"));
      await setState({ read: ist(WED, "10:56"), heartbeat: ist(WED, "10:56") });
      expect(mine((await check(ist(WED, "10:56"))).resolved).map((o) => o.kind)).toEqual(["NO_PUNCHES_TODAY"]);
      await check(ist(WED, "11:00"));
      expect((await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered"))[0]!.body).toMatch(/first punch of the day arrived at 10:55/);
    });

    it("stays quiet for a device that has not punched in two weeks (a new device, a closed branch), and on a Sunday", async () => {
      await setState({ read: ist(WED, "10:40"), heartbeat: ist(WED, "10:40") });
      expect(mine((await check(ist(WED, "10:40"))).opened)).toEqual([]);
      await punch(agentDeviceId, p.a, ist("2026-10-05", "10:02"));
      await setState({ read: ist(SUN, "11:00"), heartbeat: ist(SUN, "11:00") });
      expect(mine((await check(ist(SUN, "11:00"))).opened)).toEqual([]);
    });

    it("does not add a second alert when the device is already known to be unreachable", async () => {
      await punch(agentDeviceId, p.a, ist("2026-10-05", "10:02"));
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await check(ist(WED, "11:00"));
      expect((await incidents({ resolvedAt: null })).map((i) => i.kind)).toEqual(["DEVICE_SILENT"]);
    });
  });

  describe("escalation: one repeat at the start of the next working day", () => {
    it("sends a fresh notification when still open at the next working day's start, once, and not before", async () => {
      // Opens Saturday 17:00 (Saturday is a working day for GEN). Sunday is the week-off. The next working day starts Monday 10:00.
      await setState({ read: ist(SAT, "16:00"), heartbeat: ist(SAT, "17:00") });
      await check(ist(SAT, "17:00"));
      const i = (await incidents())[0]!;
      expect(i.escalateAfter?.toISOString()).toBe(ist(MON, "10:00").toISOString());
      const escalations = () => notificationsFor(p.hr.employeeId, "attendance.device.incident.escalated");
      for (const t of [[SAT, "18:00"], [SUN, "12:00"], [MON, "09:59"]] as const) {
        await setState({ heartbeat: ist(t[0], t[1]) });
        await check(ist(t[0], t[1]));
      }
      expect(await escalations()).toHaveLength(0);
      await setState({ heartbeat: ist(MON, "10:00") });
      await check(ist(MON, "10:00"));
      const sent = await escalations();
      expect(sent).toHaveLength(1);
      expect(sent[0]!.title).toMatch(/^Still open: /);
      expect(sent[0]!.body).toMatch(/a new working day has started/);
      for (const t of ["10:30", "13:00", "16:00"]) {
        await setState({ heartbeat: ist(MON, t) });
        await check(ist(MON, t));
      }
      expect(await escalations()).toHaveLength(1); // one repeat, not a drip
    });

    it("an incident that closes before the next working day never escalates", async () => {
      await setState({ read: ist(SAT, "16:00"), heartbeat: ist(SAT, "17:00") });
      await check(ist(SAT, "17:00"));
      await setState({ read: ist(SAT, "17:30"), heartbeat: ist(SAT, "17:30") });
      await check(ist(SAT, "17:30"));
      await setState({ read: ist(MON, "10:00"), heartbeat: ist(MON, "10:00") });
      await check(ist(MON, "10:05"));
      expect(await notificationsFor(p.hr.employeeId, "attendance.device.incident.escalated")).toHaveLength(0);
    });
  });

  describe("clock drift and the retention guard become incidents with an end", () => {
    it("opens when the clock is beyond the limit and closes, with a notice, when it is set right", async () => {
      await setState({ read: ist(WED, "12:00"), heartbeat: ist(WED, "12:00"), clockOffset: 600 });
      expect(mine((await check(ist(WED, "12:00"))).opened).map((o) => o.kind)).toContain("CLOCK_DRIFT");
      await setState({ read: ist(WED, "12:10"), heartbeat: ist(WED, "12:10"), clockOffset: 3 });
      expect(mine((await check(ist(WED, "12:10"))).resolved).map((o) => o.kind)).toContain("CLOCK_DRIFT");
      await check(ist(WED, "12:14"));
      expect((await notificationsFor(p.hr.employeeId, "attendance.device.incident.recovered")).some((n) => /clock is right again/.test(n.title))).toBe(true);
    });

    it("opens for a nearly full log", async () => {
      await setState({ read: ist(WED, "12:00"), heartbeat: ist(WED, "12:00"), logPercent: 9_500 });
      expect(mine((await check(ist(WED, "12:00"))).opened).map((o) => o.kind)).toContain("RETENTION_RISK");
    });
  });

  describe("the table itself", () => {
    it("refuses a second open incident of the same kind for the same device, even if the code tried", async () => {
      const data = { kind: "DEVICE_SILENT" as const, deviceId: agentDeviceId, openedAt: new Date() };
      await prisma.deviceIncident.create({ data });
      await expect(prisma.deviceIncident.create({ data })).rejects.toMatchObject({ code: "P2002" });
      await prisma.deviceIncident.updateMany({ where: { deviceId: agentDeviceId }, data: { resolvedAt: new Date() } });
      await expect(prisma.deviceIncident.create({ data })).resolves.toBeTruthy(); // once closed, a new one may open
    });

    it("must name exactly one subject: the agent for an agent incident, the device for the rest", async () => {
      await expect(prisma.deviceIncident.create({ data: { kind: "AGENT_SILENT", deviceId: agentDeviceId, openedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.deviceIncident.create({ data: { kind: "DEVICE_SILENT", agentId, openedAt: new Date() } })).rejects.toThrow();
      await expect(prisma.deviceIncident.create({ data: { kind: "DEVICE_SILENT", deviceId: agentDeviceId, agentId, openedAt: new Date() } })).rejects.toThrow();
    });
  });

  describe("what the Devices screen reads, and who may read it", () => {
    it("lists incidents (open first), shows status per device and agent, and reaches only attendance.devices.manage", async () => {
      await setState({ read: ist(WED, "10:05"), heartbeat: ist(WED, "11:00") });
      await check(ist(WED, "11:00"));
      const get = (path: string, token: string) => request(app).get(path).set(...authHeader(token));
      expect((await get("/api/biometric/incidents", empToken)).status).toBe(403);
      const r = await get(`/api/biometric/incidents?state=open&deviceId=${agentDeviceId}`, hrToken);
      expect(r.status).toBe(200);
      expect(r.body.incidents).toHaveLength(1);
      expect(r.body.incidents[0]).toMatchObject({ kind: "DEVICE_SILENT", isOpen: true, subject: `Entrance ${suffix}` });
      const devices = (await get("/api/biometric/devices", hrToken)).body.devices as Array<{ id: string; status: string | null; openIncidents: string[] }>;
      expect(devices.find((d) => d.id === agentDeviceId)).toMatchObject({ status: "SILENT", openIncidents: ["DEVICE_SILENT"] });
      expect(devices.find((d) => d.id === pushDeviceId)?.status).toBe("ONLINE");
      const warnings = (await get("/api/biometric/device-warnings", hrToken)).body.warnings as Array<{ deviceId: string | null; kind: string }>;
      expect(warnings.some((w) => w.deviceId === agentDeviceId && w.kind === "DEVICE_SILENT")).toBe(true);
    });

    it("an agent that is down makes its devices read 'agent offline', not each separately broken", async () => {
      await setState({ read: ist(WED, "10:00"), heartbeat: ist(WED, "10:00") });
      await check(ist(WED, "10:06"));
      const devices = (await request(app).get("/api/biometric/devices").set(...authHeader(hrToken))).body.devices as Array<{ id: string; status: string }>;
      expect(devices.find((d) => d.id === agentDeviceId)?.status).toBe("AGENT_OFFLINE");
    });

    it("reports ingestion volume by hour for today and by day for 30 days, per route", async () => {
      await punch(agentDeviceId, p.a, new Date(), new Date());
      await prisma.ingestionBatch.updateMany({ where: { deviceId: agentDeviceId }, data: { newCount: 7 } });
      const get = (q: string) => request(app).get(`/api/biometric/volume?${q}`).set(...authHeader(hrToken));
      const today = (await get(`scope=today&deviceId=${agentDeviceId}`)).body;
      expect(today.buckets[0]).toMatchObject({ route: "AGENT", punches: 7, batches: 1 });
      expect(today.buckets[0].bucket).toMatch(/^\d{4}-\d\d-\d\d \d\d:00$/);
      const month = (await get(`scope=30d&deviceId=${agentDeviceId}`)).body;
      expect(month.buckets[0].bucket).toMatch(/^\d{4}-\d\d-\d\d$/);
      expect((await request(app).get("/api/biometric/volume").set(...authHeader(empToken))).status).toBe(403);
    });

    it("buckets ingestion volume by the hour it arrived in IST, not the server's clock zone", async () => {
      await punch(agentDeviceId, p.a, new Date(), new Date());
      await prisma.ingestionBatch.updateMany({ where: { deviceId: agentDeviceId }, data: { newCount: 3, receivedAt: ist(MON, "11:57") } });
      const { buckets } = await ingestionVolume({ scope: "today", deviceId: agentDeviceId }, ist(MON, "12:00"));
      expect(buckets).toEqual([{ bucket: `${MON} 11:00`, route: "AGENT", punches: 3, batches: 1 }]);
      const late = await ingestionVolume({ scope: "30d", deviceId: agentDeviceId }, ist(MON, "23:50"));
      expect(late.buckets[0]?.bucket).toBe(MON);
    });

    it("lists people at device branches with no device ID mapped", async () => {
      const lone = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
      await prisma.deviceUserMapping.deleteMany({ where: { employeeId: lone.employeeId } });
      try {
        const r = await request(app).get("/api/biometric/people-without-mapping").set(...authHeader(hrToken));
        expect(r.status).toBe(200);
        expect(r.body.people.map((x: { employeeCode: string }) => x.employeeCode)).toContain(lone.employeeCode);
        expect(r.body.people.map((x: { employeeCode: string }) => x.employeeCode)).not.toContain(p.a.employeeCode);
      } finally {
        await cleanupFullTestEmployee(lone.employeeId);
      }
    });
  });

  describe("the alert settings are admin-editable, validated and audited", () => {
    it("reads, updates and rejects nonsense", async () => {
      const put = (body: object, token = hrToken) => request(app).put("/api/settings/device-alerts").set(...authHeader(token)).send(body);
      expect((await request(app).get("/api/settings/device-alerts").set(...authHeader(empToken))).status).toBe(403);
      const before = (await request(app).get("/api/settings/device-alerts").set(...authHeader(hrToken))).body;
      expect(before).toMatchObject({ deviceSilentMinutes: 30, agentSilentMinutes: 5, morningCheckTime: "10:30", alertSuperAdmins: true });
      expect((await put({ morningCheckTime: "25:00" })).status).toBe(400);
      expect((await put({ alertEmails: ["not an email"] })).status).toBe(400);
      expect((await put({ deviceSilentMinutes: 1 })).status).toBe(400);
      const ok = await put({ deviceSilentMinutes: 45, alertEmails: ["Ops@Example.com", "ops@example.com", "late@example.com"] });
      expect(ok.status).toBe(200);
      expect(ok.body.deviceSilentMinutes).toBe(45);
      expect(ok.body.alertEmails).toEqual(["ops@example.com", "late@example.com"]); // lower-cased, no repeats
      await put({ deviceSilentMinutes: 30, alertEmails: ["ops@example.com"] });
    });
  });
});
