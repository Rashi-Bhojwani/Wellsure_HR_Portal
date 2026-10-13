import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { localTimeToInstant } from "@shared/attendance/attlog";
import { deleteWithDependents, purgeAppendOnly } from "../../../lib/__tests__/cleanup";
import { setBusinessTodayForTests } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { DEFAULT_REGULARIZATION_SETTINGS, REGULARIZATION_SETTING_KEY } from "../../../lib/regularizationSettings";
import { setSetting } from "../../../lib/settings";
import { app, authHeader, cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, loginAs, type TestOrgMasters } from "../../employee/__tests__/employeeTestHelpers";
import { computeAttendance } from "../compute";
import { finalisationBlockers } from "../finalisation";

// Bulk correction by HR (Phase 3 commit 1): a whole branch after a device outage, previewed, then confirmed against the
// exact set that was previewed, one audit row per employee-day. "Today" is Wed 30 Sep 2026.
type Person = { employeeId: string; employeeCode: string; userId: string };
const TODAY = "2026-09-30";
const d = (s: string) => new Date(`${s}T00:00:00Z`);
const ist = (date: string, time: string) => localTimeToInstant(`${date} ${time}:00`, "Asia/Kolkata");
const tag = Date.now().toString(36).slice(-5);
const OUTAGE = ["2026-09-15", "2026-09-16"]; // the device was down these two days

describe("bulk regularization (Phase 3 commit 1)", () => {
  let org: TestOrgMasters; // the branch whose device was down
  let otherOrg: TestOrgMasters; // another branch
  const p = {} as Record<"a1" | "a2" | "a3" | "fresh" | "elsewhere" | "hr" | "exec" | "emp", Person>;
  const tok = {} as Record<"hr" | "exec" | "emp", string>;
  let deviceId = "";
  let batchId = "";
  let savedSettings: unknown = null;
  const batchIds: string[] = [];

  const hr = () => ({
    post: (path: string, b: object = {}) => request(app).post(`/api/attendance${path}`).set(...authHeader(tok.hr)).send(b),
    get: (path: string) => request(app).get(`/api/attendance${path}`).set(...authHeader(tok.hr)),
  });
  const body = (over: object = {}) => ({
    selection: { locationId: org.locationId },
    from: OUTAGE[0],
    to: OUTAGE[1],
    reasonCode: "DEVICE_DOWN",
    note: "The branch device was down on 15 and 16 September",
    action: "RAISE_AND_APPROVE",
    inTime: "10:00",
    outTime: "19:00",
    ...over,
  });
  const dayRow = (who: Person, date: string) => prisma.dailyAttendance.findUniqueOrThrow({ where: { employeeId_date: { employeeId: who.employeeId, date: d(date) } } });
  const punch = (who: Person, date: string, time: string) =>
    prisma.rawPunch.create({
      data: { deviceId, deviceUserId: who.employeeCode, punchedAt: ist(date, time), localTime: `${date} ${time}:00`, businessDate: d(date), status: "1", verifyMode: "255", workcode: "1", reserved: "0", rawLine: "test", route: "IMPORT", batchId, employeeId: who.employeeId },
    });

  beforeAll(async () => {
    setBusinessTodayForTests(d(TODAY));
    org = await createEmployeeTestOrgMasters();
    otherOrg = await createEmployeeTestOrgMasters();
    for (const k of ["a1", "a2", "a3"] as const) p[k] = await createFullTestEmployee(org);
    p.fresh = await createFullTestEmployee(org); // at the branch, but nothing has been computed for them yet
    p.elsewhere = await createFullTestEmployee(otherOrg);
    p.hr = await createFullTestEmployee(org, { roleCode: "HR_ADMIN" }); // HR works at the same branch: their own days must be left out
    p.exec = await createFullTestEmployee(org, { roleCode: "HR_EXECUTIVE" });
    p.emp = await createFullTestEmployee(org, { roleCode: "EMPLOYEE" });
    for (const k of ["hr", "exec", "emp"] as const) tok[k] = await loginAs(p[k].employeeCode);
    savedSettings = (await prisma.systemSetting.findUnique({ where: { key: REGULARIZATION_SETTING_KEY } }))?.value ?? null;
    await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, p.hr.userId);

    deviceId = (await prisma.device.create({ data: { serialNumber: `BULK-${tag}`, name: "Bulk test device", locationId: org.locationId } })).id;
    batchId = (await prisma.ingestionBatch.create({ data: { route: "IMPORT", deviceId } })).id;
    await punch(p.elsewhere, OUTAGE[0]!, "10:00"); // the other branch's device worked
    await punch(p.elsewhere, OUTAGE[0]!, "19:00");
    // a2 is on approved leave the second day; a3 already has a request waiting the first day; a1 already corrected the first day.
    const pl = await prisma.leaveType.findFirstOrThrow({ where: { code: "PL" } });
    await prisma.leaveRequest.create({ data: { employeeId: p.a2.employeeId, leaveTypeId: pl.id, fromDate: d(OUTAGE[1]!), toDate: d(OUTAGE[1]!), totalDays: 1, status: "APPROVED", appliedByUserId: p.a2.userId } });
    const everyone = [p.a1, p.a2, p.a3, p.elsewhere, p.hr].map((x) => x.employeeId);
    await computeAttendance(everyone, "2026-09-10", TODAY);
    await prisma.regularizationRequest.create({ data: { employeeId: p.a3.employeeId, date: d(OUTAGE[0]!), reasonCode: "FORGOT_TO_PUNCH", inTime: "10:00", outTime: "19:00", raisedByUserId: p.a3.userId } });
    const first = await hr().post("/regularizations/bulk", { ...body({ selection: { employeeIds: [p.a1.employeeId] }, to: OUTAGE[0] }), fingerprint: (await hr().post("/regularizations/bulk/preview", body({ selection: { employeeIds: [p.a1.employeeId] }, to: OUTAGE[0] }))).body.fingerprint, confirm: true });
    expect(first.status).toBe(200);
    batchIds.push(first.body.batchId);
  });

  afterAll(async () => {
    setBusinessTodayForTests(null);
    if (savedSettings === null) await prisma.systemSetting.deleteMany({ where: { key: REGULARIZATION_SETTING_KEY } });
    else await prisma.systemSetting.update({ where: { key: REGULARIZATION_SETTING_KEY }, data: { value: savedSettings as never } });
    const requestIds = (await prisma.regularizationRequest.findMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } }, select: { id: true } })).map((r) => r.id);
    await purgeAppendOnly("AuditLog", { entityId: { in: [...requestIds, "regularization"] } });
    await prisma.leaveRequest.deleteMany({ where: { employeeId: { in: Object.values(p).map((x) => x.employeeId) } } });
    for (const x of Object.values(p)) await cleanupFullTestEmployee(x.employeeId);
    await deleteWithDependents("RegularizationBatch", [...new Set([...batchIds, ...(await prisma.regularizationBatch.findMany({ where: { createdByUserId: p.hr.userId }, select: { id: true } })).map((b) => b.id)])]);
    await deleteWithDependents("RawPunch", (await prisma.rawPunch.findMany({ where: { deviceId }, select: { id: true } })).map((r) => r.id));
    await deleteWithDependents("IngestionBatch", [batchId]);
    await deleteWithDependents("Device", [deviceId]);
    await cleanupEmployeeTestOrgMasters(org);
    await cleanupEmployeeTestOrgMasters(otherOrg);
  });

  describe("the preview", () => {
    it("shows exactly which employee-days change and from what to what, what cannot be corrected and why, and leaves HR's own days out", async () => {
      const res = await hr().post("/regularizations/bulk/preview", body());
      expect(res.status).toBe(200);
      // a1: both days except the first (already corrected) -> 1; a2: first day (the second is leave) -> 1; a3: second day (the first has a request waiting) -> 1; the other branch is not selected.
      expect(res.body).toMatchObject({ count: 3, employees: 3, correction: "In 10:00 · Out 19:00", action: "RAISE_AND_APPROVE", caps: { maxRangeDays: 31, maxEmployeeDays: 1000 } });
      expect(res.body.rows.map((r: { employeeCode: string; date: string; before: string; after: string }) => `${r.employeeCode}|${r.date}|${r.before}>${r.after}`).sort()).toEqual(
        [`${p.a1.employeeCode}|${OUTAGE[1]}|A>P`, `${p.a2.employeeCode}|${OUTAGE[0]}|A>P`, `${p.a3.employeeCode}|${OUTAGE[1]}|A>P`].sort(),
      );
      const reasons = Object.fromEntries(res.body.cannotCorrect.map((g: { code: string; count: number }) => [g.code, g.count]));
      expect(reasons).toMatchObject({ ALREADY_CORRECTED: 1, ON_LEAVE: 1, PENDING_EXISTS: 1, NO_RECORD: 6 }); // the three people at the branch with nothing computed yet (2 days each) are reported, not skipped silently
      expect(res.body.ownLeftOut).toBe(2); // HR works at that branch: their own two days are not theirs to correct
      expect(res.body.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(await prisma.regularizationBatch.count({ where: { createdByUserId: p.hr.userId, dayCount: 3 } })).toBe(0); // a preview writes nothing
    });

    it("selects by a list of employees too (and refuses a list with someone who doesn't exist, or both a list and a branch)", async () => {
      const list = await hr().post("/regularizations/bulk/preview", body({ selection: { employeeIds: [p.a2.employeeId, p.hr.employeeId] } }));
      expect(list.body).toMatchObject({ count: 1, ownLeftOut: 2 });
      expect((await hr().post("/regularizations/bulk/preview", body({ selection: { employeeIds: [p.a1.employeeId, "nobody"] } }))).status).toBe(404);
      expect((await hr().post("/regularizations/bulk/preview", body({ selection: { employeeIds: [p.a1.employeeId], locationId: org.locationId } }))).status).toBe(400);
    });

    it("is for HR with the bulk permission only", async () => {
      expect((await request(app).post("/api/attendance/regularizations/bulk/preview").set(...authHeader(tok.exec)).send(body())).status).toBe(403);
      expect((await request(app).post("/api/attendance/regularizations/bulk/preview").set(...authHeader(tok.emp)).send(body())).status).toBe(403);
    });

    it("is capped so a mistake cannot rewrite a quarter: a wide range and too many employee-days are refused", async () => {
      const wide = await hr().post("/regularizations/bulk/preview", body({ from: "2026-08-01", to: "2026-09-29" }));
      expect(wide.status).toBe(400);
      expect(wide.body.error.code).toBe("TOO_WIDE");
      await setSetting(REGULARIZATION_SETTING_KEY, { ...DEFAULT_REGULARIZATION_SETTINGS, bulkMaxEmployeeDays: 2 }, p.hr.userId);
      try {
        const many = await hr().post("/regularizations/bulk/preview", body());
        expect(many.status).toBe(400);
        expect(many.body.error.code).toBe("TOO_MANY");
      } finally {
        await setSetting(REGULARIZATION_SETTING_KEY, DEFAULT_REGULARIZATION_SETTINGS, p.hr.userId);
      }
    });
  });

  describe("confirming", () => {
    it("needs the preview's fingerprint, a reason and the explicit confirmation", async () => {
      const preview = (await hr().post("/regularizations/bulk/preview", body())).body;
      expect((await hr().post("/regularizations/bulk", { ...body(), fingerprint: preview.fingerprint })).status).toBe(400); // not confirmed
      expect((await hr().post("/regularizations/bulk", { ...body({ note: "" }), fingerprint: preview.fingerprint, confirm: true })).status).toBe(400); // no reason
      expect((await hr().post("/regularizations/bulk", { ...body(), fingerprint: "0".repeat(64), confirm: true })).status).toBe(409); // not the set that was shown
      expect(await prisma.regularizationBatch.count({ where: { createdByUserId: p.hr.userId, dayCount: 3 } })).toBe(0);
    });

    it("applies only to the previewed set: if a request is raised meanwhile, nothing changes", async () => {
      const preview = (await hr().post("/regularizations/bulk/preview", body())).body;
      await prisma.regularizationRequest.create({ data: { employeeId: p.a2.employeeId, date: d(OUTAGE[0]!), reasonCode: "OTHER", reason: "raised meanwhile", targetStatus: "P", raisedByUserId: p.a2.userId } });
      const res = await hr().post("/regularizations/bulk", { ...body(), fingerprint: preview.fingerprint, confirm: true });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SELECTION_CHANGED");
      expect(await dayRow(p.a1, OUTAGE[1]!)).toMatchObject({ status: "A", source: "DEVICE" });
      await prisma.regularizationRequest.deleteMany({ where: { employeeId: p.a2.employeeId, reason: "raised meanwhile" } });
    });

    it("raise and approve: every day corrected, one audit row per employee-day, a batch, a notice per person, raw punches untouched, HR's own days not touched", async () => {
      const preview = (await hr().post("/regularizations/bulk/preview", body())).body;
      const res = await hr().post("/regularizations/bulk", { ...body(), fingerprint: preview.fingerprint, confirm: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ requests: 3, employees: 3, approved: true, ownLeftOut: 2 });
      batchIds.push(res.body.batchId);
      expect(await dayRow(p.a1, OUTAGE[1]!)).toMatchObject({ status: "P", source: "OVERRIDE", overrideKind: "REGULARIZATION", firstIn: ist(OUTAGE[1]!, "10:00"), lastOut: ist(OUTAGE[1]!, "19:00") });
      expect(await dayRow(p.a2, OUTAGE[0]!)).toMatchObject({ status: "P", source: "OVERRIDE" });
      expect(await dayRow(p.a2, OUTAGE[1]!)).toMatchObject({ source: "LEAVE" }); // on leave: left alone
      expect(await dayRow(p.hr, OUTAGE[0]!)).toMatchObject({ status: "A", source: "DEVICE", overrideKind: null }); // their own: untouched
      const requests = await prisma.regularizationRequest.findMany({ where: { batchId: res.body.batchId } });
      expect(requests).toHaveLength(3);
      expect(requests.every((r) => r.status === "APPROVED" && r.decidedByUserId === p.hr.userId && r.reasonCode === "DEVICE_DOWN")).toBe(true);
      expect(await prisma.attendanceOverride.count({ where: { requestId: { in: requests.map((r) => r.id) } } })).toBe(3);
      // One audit row per employee-day, never one for the batch.
      const audits = await prisma.auditLog.findMany({ where: { action: "attendance.regularization.bulk_raised_and_approved", entityId: { in: requests.map((r) => r.id) } } });
      expect(audits).toHaveLength(3);
      expect(new Set(audits.map((a) => (a.after as { batchId: string }).batchId))).toEqual(new Set([res.body.batchId]));
      expect(audits[0]!.after).toMatchObject({ batchSize: 3, reasonCode: "DEVICE_DOWN", correction: "In 10:00 · Out 19:00", dayBefore: "A", dayAfter: "P" });
      expect(await prisma.notification.count({ where: { type: "regularization.decided", userId: { in: [p.a1.userId, p.a2.userId, p.a3.userId] }, createdAt: { gte: new Date(Date.now() - 60_000) } } })).toBeGreaterThanOrEqual(3);
      expect(await prisma.rawPunch.count({ where: { employeeId: { in: [p.a1.employeeId, p.a2.employeeId, p.a3.employeeId] } } })).toBe(0);
      // Repeating it is refused: nothing is left to correct.
      expect((await hr().post("/regularizations/bulk", { ...body(), fingerprint: preview.fingerprint, confirm: true })).status).toBe(409);
    });
  });

  describe("raising without approving", () => {
    it("creates pending requests that wait for an approver, block finalisation, and are grouped by their batch", async () => {
      const sel = { selection: { employeeIds: [p.a1.employeeId, p.a2.employeeId] }, from: "2026-09-23", to: "2026-09-23", action: "RAISE", status: "P", inTime: undefined, outTime: undefined, reasonCode: "ON_DUTY_ELSEWHERE", note: "The whole team was at the client's office" };
      const preview = (await hr().post("/regularizations/bulk/preview", sel)).body;
      expect(preview).toMatchObject({ count: 2, correction: "Present", action: "RAISE" });
      const res = await hr().post("/regularizations/bulk", { ...sel, fingerprint: preview.fingerprint, confirm: true });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ requests: 2, approved: false });
      batchIds.push(res.body.batchId);
      expect(await dayRow(p.a1, "2026-09-23")).toMatchObject({ source: "DEVICE", overrideKind: null }); // nothing applied yet
      const queue = (await hr().get(`/regularizations?status=PENDING&batchId=${res.body.batchId}`)).body.requests;
      expect(queue).toHaveLength(2);
      expect(queue[0]).toMatchObject({ reasonCode: "ON_DUTY_ELSEWHERE", targetStatus: "P", correctionText: "Present", status: "PENDING", batchId: res.body.batchId });
      expect((await finalisationBlockers("2026-09-01", "2026-09-30")).find((b) => b.code === "PENDING_REGULARIZATIONS")).toBeTruthy();
      // The approver (HR, who is not these people) decides one: it applies.
      expect((await hr().post(`/regularizations/${queue[0].id}/approve`, {})).status).toBe(200);
      expect(await prisma.auditLog.count({ where: { action: "attendance.regularization.bulk_raised", entityId: { in: queue.map((q: { id: string }) => q.id) } } })).toBe(2);
    });
  });
});
