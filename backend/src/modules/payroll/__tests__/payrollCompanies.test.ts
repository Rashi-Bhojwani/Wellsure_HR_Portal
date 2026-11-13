import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { REAL_RULES, closeWorld, closingWorld, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, api, calculateAgain, calculateRun, setRules } from "./runTestHelpers";

// Part 3 B2 (docs/plans/A_PART3.md; owner decision 2026-11-13): payroll per company, first steps. A run is for one company; one live run per cycle per company; each
// company's registrations and bank details are Not set until entered and confirmed by two directors. With one company everything is as before (goldenRun.test.ts).
describe("B2 — payroll per company", () => {
  let world: Closing;
  let entityId = "";
  let mainRun = "";
  let otherRun = "";
  const settingIds: string[] = [];
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const who = (n: string) => world.named[n]!.employeeId;
  const cs = (t: string, m: "get" | "post", path: string, body?: object) => request(app)[m](`/api/payroll-company-settings${path}`).set(...authHeader(t)).send(body);

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    entityId = (await prisma.legalEntity.create({ data: { code: `ZZ${world.prefix}`, name: "ZZ Test Company Two", createdByUserId: world.maker.userId } })).id;
    await prisma.employeeLegalEntity.create({ data: { employeeId: who("c"), legalEntityId: entityId, setByUserId: world.maker.userId } });
    for (const [k, role] of [["hr", "HR_ADMIN"], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"]] as const) {
      people[k] = await createFullTestEmployee(world.org, { roleCode: role });
      world.userIds.push(people[k]!.userId);
      tok[k] = await loginAs(people[k]!.employeeCode);
    }
    tok.a = await loginAs(world.named.a!.employeeCode);
  }, 900_000);

  afterAll(async () => {
    await deleteWithDependents("PayrollCompanySetting", settingIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await closeWorld(world);
    // The run's company tag (keyed by run id): removed through the test-only purge exception once the run is gone.
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.payrollRunCompany.deleteMany({ where: { legalEntityId: entityId } });
    });
    await deleteWithDependents("LegalEntity", [entityId]);
  }, 300_000);

  it("a run is for one company: the main run pays the main company's people, the other company's run pays only its own; both live in the same cycle", async () => {
    mainRun = await calculateRun(world);
    const created = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start, legalEntityId: entityId });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    otherRun = created.body.id;
    await calculateAgain(world, otherRun);
    const named = new Set([who("a"), who("b"), who("c")]);
    const ids = async (runId: string) => (await prisma.payrollRunItem.findMany({ where: { runId }, select: { employeeId: true } })).map((i) => i.employeeId).filter((id) => named.has(id)).sort();
    expect(await ids(mainRun)).toEqual([who("a"), who("b")].sort());
    expect(await ids(otherRun)).toEqual([who("c")]);
    expect(await prisma.payrollRunCompany.findUnique({ where: { runId: otherRun } })).toMatchObject({ legalEntityId: entityId });
  });

  it("one live run per cycle per company: a second run for the same company and cycle is refused, for the main company and the other alike", async () => {
    const again = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start });
    expect([again.status, again.body.error?.code]).toEqual([409, "RUN_EXISTS"]);
    const againOther = await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start, legalEntityId: entityId });
    expect([againOther.status, againOther.body.error?.code]).toEqual([409, "RUN_EXISTS"]);
    expect((await api(world.tokens.maker, "post", "/runs", { cycleStart: CYCLE.start, legalEntityId: "no-such-company" })).status).toBe(404);
    await expect(prisma.payrollRunCompany.update({ where: { runId: otherRun }, data: { legalEntityId: "x" } })).rejects.toThrow(/PAYROLL_RUN_COMPANY_IMMUTABLE/);
  });

  it("another company's bank and statutory files are refused until they are built; its settings are Not set until entered and confirmed by a different director", async () => {
    expect((await api(world.tokens.maker, "post", `/runs/${otherRun}/bank-file/generate`)).body.error.code).toBe("COMPANY_FILES_NOT_BUILT");
    expect((await api(world.tokens.maker, "post", `/runs/${otherRun}/outputs`, { kind: "PF_ECR" })).body.error.code).toBe("COMPANY_FILES_NOT_BUILT");
    for (const t of [tok.hr!, tok.mgr!, tok.a!, tok.dev!]) {
      expect((await cs(t, "get", "")).status).toBe(403);
      expect((await cs(t, "post", "", { companyKey: entityId, registrations: {}, reason: "test" })).status).toBe(403);
    }
    const before = (await cs(world.tokens.maker, "get", "")).body.companies.find((c: { key: string }) => c.key === entityId);
    expect(before).toMatchObject({ inForce: null, waiting: null });
    const e = await cs(world.tokens.maker, "post", "", { companyKey: entityId, registrations: { pfEstablishmentCode: "ZZTEST/0001" }, debitAccount: "000099990000123", reason: "made-up test values" });
    expect(e.status, JSON.stringify(e.body)).toBe(201);
    settingIds.push(e.body.id);
    const row = await prisma.payrollCompanySetting.findUniqueOrThrow({ where: { id: e.body.id } });
    expect(JSON.stringify(row.debitAccount)).not.toContain("000099990000123");
    expect((await cs(world.tokens.maker, "post", `/${e.body.id}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
    await expect(prisma.payrollCompanySettingConfirmation.create({ data: { settingId: e.body.id, confirmedByUserId: world.maker.userId } })).rejects.toThrow(/PAYROLL_COMPANY_SETTING_SAME_PERSON/);
    expect((await cs(world.tokens.checkerA, "post", `/${e.body.id}/confirm`)).status).toBe(200);
    const after = (await cs(world.tokens.maker, "get", "")).body.companies.find((c: { key: string }) => c.key === entityId);
    expect(after.inForce).toMatchObject({ debitAccount: "…0123", registrations: { pfEstablishmentCode: "ZZTEST/0001" } });
    expect(JSON.stringify(await cs(world.tokens.maker, "get", ""))).not.toContain("000099990000123");
    const audits = await prisma.auditLog.findMany({ where: { entityId: e.body.id, action: { startsWith: "payroll.company_settings." } } });
    expect(audits.map((x) => x.action).sort()).toEqual(["payroll.company_settings.confirmed", "payroll.company_settings.entered"]);
    expect(JSON.stringify(audits.map((x) => x.after))).not.toMatch(/0001|0123/);
  });
});
