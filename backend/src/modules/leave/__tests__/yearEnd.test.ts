import { Prisma } from "@prisma/client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../../../lib/prisma";
import { EncashmentRateNotConfiguredError, SettingsBasedEncashmentRateProvider, setEncashmentRateProvider, type EncashmentRateProvider } from "../encashmentRate";
import { writeLedgerEntry } from "../ledger";
import * as yearEndService from "../yearEnd";
import {
  app,
  authHeader,
  cleanupEmployeeTestOrgMasters,
  cleanupLoginableTestEmployee,
  cleanupMinimalTestEmployee,
  createEmployeeTestOrgMasters,
  createLoginableTestEmployee,
  createMinimalTestEmployee,
  loginAs,
  utcDate,
  type TestOrgMasters,
} from "./leaveTestHelpers";

const FLAT_RATE_PROVIDER: EncashmentRateProvider = {
  async getDailyRate() {
    return { amount: new Prisma.Decimal(500), source: "MANUAL_SETTING", isFinal: false };
  },
};
const NOT_CONFIGURED_PROVIDER: EncashmentRateProvider = {
  async getDailyRate() {
    throw new EncashmentRateNotConfiguredError();
  },
};

// Year End Process (spec §5.4/§5.5) — preview -> discard/re-preview ->
// commit. Direct service-level calls for the cutoff/drift business logic
// (same convention as ledgerBalance.test.ts for date-boundary-sensitive
// behaviour), plus a couple of HTTP calls for route/permission wiring.
describe("Year End Process", () => {
  let plTypeId: string;
  let actorOrg: TestOrgMasters;
  let actorEmployeeId: string;
  let META: { actorUserId: string; ipAddress: null; userAgent: null };
  const employeeIds: string[] = [];
  const runIds: string[] = [];

  beforeAll(async () => {
    const plType = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    plTypeId = plType.id;
    // writeAuditLog's actorUserId is a real FK to users — direct
    // service calls below need a genuine user row, not a fake string.
    actorOrg = await createEmployeeTestOrgMasters();
    const actor = await createLoginableTestEmployee(actorOrg, { roleCode: "HR_ADMIN" });
    actorEmployeeId = actor.employeeId;
    META = { actorUserId: actor.userId, ipAddress: null, userAgent: null };
  });

  afterAll(async () => {
    setEncashmentRateProvider(new SettingsBasedEncashmentRateProvider()); // don't leak the fake into later test files — fileParallelism:false shares this process
    await cleanupLoginableTestEmployee(actorEmployeeId);
    await cleanupEmployeeTestOrgMasters(actorOrg);
  });

  afterEach(async () => {
    setEncashmentRateProvider(NOT_CONFIGURED_PROVIDER);
    while (runIds.length) {
      const id = runIds.pop()!;
      await prisma.yearEndRun.deleteMany({ where: { id } }); // cascades to items
    }
    while (employeeIds.length) await cleanupMinimalTestEmployee(employeeIds.pop()!);
  });

  it("computes the closing PL balance as an explicit entryDate <= Y-12-31 cutoff — a Y+1 Jan-1 accrual posted while still PREVIEW is excluded from Y's encashment and correctly starts Y+1's balance", async () => {
    setEncashmentRateProvider(FLAT_RATE_PROVIDER);
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);

    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2026, entryDate: utcDate("2026-11-01"), entryType: "ACCRUAL", days: 5 });
    // Posted for the NEXT year while this year's run is still PREVIEW —
    // must not be swept into 2026's encashment.
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2027, entryDate: utcDate("2027-01-01"), entryType: "ACCRUAL", days: 1 });

    const run = await yearEndService.previewYearEnd(2026, META);
    runIds.push(run.id);
    const item = run.items.find((i) => i.employeeId === employeeId);
    expect(item).toBeDefined();
    expect(item!.closingPlBalance).toBe(5);
    expect(item!.encashedAmount).toBe(2500);

    const committed = await yearEndService.commitYearEndRun(run.id, META, { confirmText: "COMMIT YEAR END" });
    expect(committed.status).toBe("COMMITTED");

    // Totals on the run are org-wide (every employee with a positive PL
    // balance), so assert on this employee's own item, not the aggregate.
    const committedRun = await yearEndService.getYearEndRun(run.id);
    const committedItem = committedRun.items.find((i) => i.employeeId === employeeId);
    expect(committedItem!.encashedAmount).toBe(2500);
    expect(committedItem!.ledgerEncashmentEntryId).not.toBeNull();

    const balances = await prisma.leaveLedger.aggregate({
      _sum: { days: true },
      where: { employeeId, leaveTypeId: plTypeId, entryDate: { lte: utcDate("2026-12-31") } },
    });
    expect(balances._sum.days!.toNumber()).toBe(0); // 5 accrued - 5 encashed

    const balanceIntoNextYear = await prisma.leaveLedger.aggregate({
      _sum: { days: true },
      where: { employeeId, leaveTypeId: plTypeId, entryDate: { lte: utcDate("2027-01-01") } },
    });
    expect(balanceIntoNextYear._sum.days!.toNumber()).toBe(1); // only the Jan-1 accrual survives into 2027
  });

  it("preview fails loudly with no rows written when the encashment rate is not configured", async () => {
    setEncashmentRateProvider(NOT_CONFIGURED_PROVIDER);
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2077, entryDate: utcDate("2077-06-01"), entryType: "ACCRUAL", days: 3 });

    await expect(yearEndService.previewYearEnd(2077, META)).rejects.toThrow(EncashmentRateNotConfiguredError);
    const runs = await prisma.yearEndRun.findMany({ where: { leaveYear: 2077 } });
    expect(runs).toHaveLength(0);
  });

  it("rejects the whole commit — never a partial one — when a balance has drifted since preview", async () => {
    setEncashmentRateProvider(FLAT_RATE_PROVIDER);
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2078, entryDate: utcDate("2078-06-01"), entryType: "ACCRUAL", days: 5 });

    const run = await yearEndService.previewYearEnd(2078, META);
    runIds.push(run.id);
    const previewItem = run.items.find((i) => i.employeeId === employeeId);
    expect(previewItem!.closingPlBalance).toBe(5);

    // Lands after preview but still inside the cutoff window — drifts the
    // fresh balance away from what HR already reviewed.
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2078, entryDate: utcDate("2078-07-01"), entryType: "GRANT", days: 2 });

    await expect(yearEndService.commitYearEndRun(run.id, META, { confirmText: "COMMIT YEAR END" })).rejects.toMatchObject({ status: 409, code: "BALANCE_DRIFTED" });

    const fresh = await yearEndService.getYearEndRun(run.id);
    expect(fresh.status).toBe("PREVIEW");
    const freshItem = fresh.items.find((i) => i.employeeId === employeeId);
    expect(freshItem!.ledgerEncashmentEntryId).toBeNull();
  });

  it("commit requires the typed confirmation text", async () => {
    setEncashmentRateProvider(FLAT_RATE_PROVIDER);
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2079, entryDate: utcDate("2079-06-01"), entryType: "ACCRUAL", days: 1 });

    const run = await yearEndService.previewYearEnd(2079, META);
    runIds.push(run.id);
    await expect(yearEndService.commitYearEndRun(run.id, META, {})).rejects.toMatchObject({ status: 400, code: "CONFIRMATION_REQUIRED" });
  });

  it("a new preview for the same year supersedes the existing one", async () => {
    setEncashmentRateProvider(FLAT_RATE_PROVIDER);
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2080, entryDate: utcDate("2080-06-01"), entryType: "ACCRUAL", days: 1 });

    const first = await yearEndService.previewYearEnd(2080, META);
    runIds.push(first.id);
    const second = await yearEndService.previewYearEnd(2080, META);
    runIds.push(second.id);

    const firstFresh = await yearEndService.getYearEndRun(first.id);
    expect(firstFresh.status).toBe("SUPERSEDED");
    expect(second.status).toBe("PREVIEW");

    const runs = await yearEndService.listYearEndRuns(2080);
    expect(runs.map((r) => r.status).sort()).toEqual(["PREVIEW", "SUPERSEDED"]);
  });

  it("discards a preview; discarding anything but a PREVIEW is rejected", async () => {
    setEncashmentRateProvider(FLAT_RATE_PROVIDER);
    const employeeId = await createMinimalTestEmployee(utcDate("2020-01-01"));
    employeeIds.push(employeeId);
    await writeLedgerEntry(prisma, { employeeId, leaveTypeId: plTypeId, leaveYear: 2081, entryDate: utcDate("2081-06-01"), entryType: "ACCRUAL", days: 1 });

    const run = await yearEndService.previewYearEnd(2081, META);
    runIds.push(run.id);
    await yearEndService.discardYearEndRun(run.id, META);
    const fresh = await yearEndService.getYearEndRun(run.id);
    expect(fresh.status).toBe("SUPERSEDED");

    await expect(yearEndService.discardYearEndRun(run.id, META)).rejects.toMatchObject({ status: 409, code: "NOT_A_PREVIEW" });
  });

  it("only one COMMITTED run per leave year (DB-level partial unique index)", async () => {
    const base = { previewedByUserId: "test-actor", totalEmployees: 0, totalEncashedDays: new Prisma.Decimal(0), totalEncashedAmount: new Prisma.Decimal(0), status: "COMMITTED" as const };
    const first = await prisma.yearEndRun.create({ data: { ...base, leaveYear: 2082 } });
    runIds.push(first.id);
    await expect(prisma.yearEndRun.create({ data: { ...base, leaveYear: 2082 } })).rejects.toThrow();
  });

  describe("route wiring (leave.yearend.manage)", () => {
    let org: TestOrgMasters;
    let managerToken: string;
    let plainToken: string;
    let directorToken: string;
    const routeTestEmployeeIds: string[] = [];

    beforeAll(async () => {
      org = await createEmployeeTestOrgMasters();
      const manager = await createLoginableTestEmployee(org, { roleCode: "HR_ADMIN" });
      routeTestEmployeeIds.push(manager.employeeId);
      const director = await createLoginableTestEmployee(org, { roleCode: "SUPER_ADMIN" });
      routeTestEmployeeIds.push(director.employeeId);
      directorToken = await loginAs(director.employeeCode);
      managerToken = await loginAs(manager.employeeCode);
      const plain = await createLoginableTestEmployee(org, { roleCode: "EMPLOYEE" });
      routeTestEmployeeIds.push(plain.employeeId);
      plainToken = await loginAs(plain.employeeCode);
    });

    afterAll(async () => {
      for (const id of [...routeTestEmployeeIds].reverse()) await cleanupLoginableTestEmployee(id);
      await cleanupEmployeeTestOrgMasters(org);
    });

    it("blocks a caller without leave.yearend.manage", async () => {
      const res = await request(app).get("/api/leave/year-end").set(...authHeader(plainToken));
      expect(res.status).toBe(403);
    });

    it("refuses an HR_ADMIN (the key is hard-locked to directors) and lets a Super Admin list runs", async () => {
      expect((await request(app).get("/api/leave/year-end").set(...authHeader(managerToken))).status).toBe(403);
      const res = await request(app).get("/api/leave/year-end").set(...authHeader(directorToken));
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.runs)).toBe(true);
    });
  });
});
