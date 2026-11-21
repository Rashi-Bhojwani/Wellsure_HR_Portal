import request from "supertest";
import { Worker } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { createBullConnection } from "../../../lib/redis";
import { ATTENDANCE_RECOMPUTE_QUEUE, attendanceRecomputeQueue } from "../../../jobs/attendanceQueues";
import { enqueueRecompute, processRecomputeJob } from "../../attendance/jobs";
import { setRecomputeDatesHandler, setRecomputeHandler } from "../../attendance/recompute";
import { registerAttendanceEngine } from "../../attendance/wiring";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { DEFAULT_RULE, type LateRule } from "../evaluate";

// Final merge 2026-11-19 (docs/plans/FINAL_MERGE_REPORT.md, item 3d). The lateness branch could not test its job-queue path (LATE_REPORT.md: "the tests call compute
// directly and do not run the worker"). Here the real wiring (registerAttendanceEngine: requestRecompute → a debounced BullMQ attendance-recompute job) and a real
// BullMQ worker running the worker's own processor (processRecomputeJob, as jobs/worker.ts does) carry the follow-up: when an earlier day's arrival changes, the
// later days of the month are numbered again through the queue, and a waiver approved afterwards is not undone by anything still in the queue.
// December 2026 (open), business today 10 December. Made-up people.

type Person = { employeeId: string; userId: string; employeeCode: string };
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
const RULE: LateRule = { ...DEFAULT_RULE, effectiveFrom: "2026-12-01", active: true }; // band 2 (10:20 to 10:29): 3 free, then 0.5 a time

describe("lateness: the follow-up recompute goes through the job queue and a real worker", () => {
  let org: TestOrgMasters;
  const p = {} as Record<"d1" | "d2" | "hr" | "mgr" | "emp", Person>;
  const t = {} as Record<keyof typeof p, string>;
  let deviceId = "";
  let batchId = "";
  let worker: Worker | null = null;
  const proposals: string[] = [];
  let processed = 0;

  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({ data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: new Date(`${date}T00:00:00Z`), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId } });
  const lopOn = async (date: string) => (await prisma.dailyAttendance.findUnique({ where: { employeeId_date: { employeeId: p.emp.employeeId, date: new Date(`${date}T00:00:00Z`) } } }))?.lopDays.toString() ?? null;
  const queueIdle = async () => {
    const c = await attendanceRecomputeQueue().getJobCounts("waiting", "delayed", "active", "prioritized");
    return Object.values(c).every((n) => n === 0);
  };
  /** Waits until the queue is empty and stays empty past the 1 s debounce, then returns. */
  const drain = async (timeoutMs = 45_000) => {
    const until = Date.now() + timeoutMs;
    let quietSince = 0;
    while (Date.now() < until) {
      if (await queueIdle()) {
        quietSince ||= Date.now();
        if (Date.now() - quietSince > 2500) return;
      } else quietSince = 0;
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("the attendance-recompute queue did not drain");
  };
  const lateApi = (who: keyof typeof p) => ({ post: (path: string, body: object = {}) => request(app).post(`/api/lateness${path}`).set(...authHeader(t[who])).send(body) });

  beforeAll(async () => {
    setBusinessTodayForTests(new Date("2026-12-10T00:00:00Z"));
    expect(await prisma.attendancePeriodLock.count({ where: { periodStart: { lte: new Date("2026-12-31T00:00:00Z") }, periodEnd: { gte: new Date("2026-12-01T00:00:00Z") } } }), "an earlier test left an attendance lock on December 2026").toBe(0);
    expect(await prisma.behaviourProposal.count({ where: { key: { in: ["late.rule", "late.missingPunch", "late.halfDay"] } } }), "an earlier test left a lateness setting").toBe(0);
    org = await createEmployeeTestOrgMasters();
    for (const [k, roleCode] of [["d1", "SUPER_ADMIN"], ["d2", "SUPER_ADMIN"], ["hr", "HR_ADMIN"], ["mgr", undefined]] as const) p[k] = await createFullTestEmployee(org, roleCode ? { roleCode } : {});
    p.emp = await createFullTestEmployee(org, { managerId: p.mgr.employeeId });
    for (const k of Object.keys(p) as Array<keyof typeof p>) t[k] = await loginAs(p[k].employeeCode);
    deviceId = (await prisma.device.create({ data: { serialNumber: `LATEQ-${tag}`, name: "Lateness queue test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;

    const prop = await lateApi("d1").post("/settings/late.rule/proposals", { value: RULE, reason: "Test setting" });
    expect(prop.status, JSON.stringify(prop.body)).toBe(201);
    proposals.push(prop.body.id as string);
    expect((await lateApi("d2").post(`/settings/proposals/${prop.body.id}/confirm`)).status).toBe(200);

    // The real wiring and a real worker, with the processor jobs/worker.ts uses.
    registerAttendanceEngine();
    await drain(); // anything the setting itself queued (it asks for everyone's days from its start) is done before the test starts
    worker = new Worker(ATTENDANCE_RECOMPUTE_QUEUE, async (job) => { processed += 1; return processRecomputeJob(job.data as { employeeId?: string; from: string; to: string }); }, { connection: createBullConnection(), concurrency: 4 });
    await drain();
  }, 180_000);

  afterAll(async () => {
    await worker?.close();
    setRecomputeHandler(null);
    setRecomputeDatesHandler(null);
    setBusinessTodayForTests(null);
    await deleteWithDependents("BehaviourProposal", proposals);
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
  }, 120_000);

  it("an earlier day's new late arrival renumbers the later days of the month through the queue (the 4th band-2 arrival becomes a cut)", async () => {
    // 2 to 4 December: three band-2 arrivals (all free); 1 December: no punches yet.
    for (const d of ["2026-12-02", "2026-12-03", "2026-12-04"]) { await punch(p.emp, d, "10:25"); await punch(p.emp, d, "19:00"); }
    await enqueueRecompute(["2026-12-02", "2026-12-03", "2026-12-04"].map((d) => ({ employeeId: p.emp.employeeId, date: new Date(`${d}T00:00:00Z`) })));
    await drain();
    expect([await lopOn("2026-12-02"), await lopOn("2026-12-03"), await lopOn("2026-12-04")]).toEqual(["0", "0", "0"]);

    // 1 December's punches arrive late (a device catching up). Ingestion asks for that day only; the hook sees its arrival change and asks the queue for the rest.
    const before = processed;
    await punch(p.emp, "2026-12-01", "10:25");
    await punch(p.emp, "2026-12-01", "19:00");
    await enqueueRecompute([{ employeeId: p.emp.employeeId, date: new Date("2026-12-01T00:00:00Z") }]);
    await drain();
    expect(processed - before, "the follow-up came through the queue as its own job").toBeGreaterThanOrEqual(2);
    expect(await lopOn("2026-12-01")).toBe("0"); // the 1st band-2 arrival, free
    expect(await lopOn("2026-12-04")).toBe("0.5"); // now the 4th: a cut, worked out by the worker, nothing called compute directly
  });

  it("a waiver approved afterwards returns the allowance at once, and nothing still in the queue undoes it", async () => {
    const asked = await lateApi("mgr").post("/waivers", { employeeId: p.emp.employeeId, date: "2026-12-01", reason: "Device was down" });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    expect((await lateApi("hr").post(`/waivers/${asked.body.id}/approve`)).status).toBe(200);
    // FIX-M8 (independent audit 2026-11-20): changed test. HR's approval waits for a director (the default); the director's confirmation is the approval.
    expect((await lateApi("d1").post(`/waivers/${asked.body.id}/confirm`)).status).toBe(200);
    expect(await lopOn("2026-12-04")).toBe("0"); // approval recomputes the rest of the month inline
    await drain(); // and any job the recompute itself queued
    expect(await lopOn("2026-12-04")).toBe("0");
    // One more later change goes through the queue again and still respects the waiver: 7 December's band-2 arrival is the 4th counted (1 Dec is waived), a cut.
    await punch(p.emp, "2026-12-07", "10:25");
    await punch(p.emp, "2026-12-07", "19:00");
    await enqueueRecompute([{ employeeId: p.emp.employeeId, date: new Date("2026-12-07T00:00:00Z") }]);
    await drain();
    expect([await lopOn("2026-12-04"), await lopOn("2026-12-07")]).toEqual(["0", "0.5"]);
  });
});
