import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { BEHAVIOURS, behaviourOn } from "../../behaviours/service";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { gratuityYears } from "../payPolicies/arith";
import { exitEncashment, exitGratuity, exitNoticeRecovery, headRefusalText, missingHeads } from "../payPolicies/service";
import { serviceLength } from "../settlements/guide";
import { automaticLines } from "../settlements/service";
import { buildSetupReport, headCoverage, readinessOf } from "../setup/status";
import { closeWorld, closingWorld, staffWith, type Closing } from "./closeTestHelpers";
import { makeComponent } from "./salaryTestHelpers";
import { setBehaviourByRoute, testEncashment, testGratuity, testNotice } from "./settlementRulesTestHelpers";

// No silent zero (2026-11-17, docs/plans/OWNER_EMPTY_SETTINGS.md): gratuity, notice pay and leave encashment ship Not set (owner decision). Each use is refused while
// its setting is Not set, naming it; a configured head missing from the person's salary is refused, naming the head; neither ever returns 0. The settlement screen
// meets the same refusals.
// Only a head that exists in the company can be chosen; changing one is the usual entry by a director and confirmation by the other, audited. Ready for First Run has a
// non-blocking row saying whether every active employee's structure has the chosen heads. Synthetic people and TEST values only.

const REFUSAL = "Salary head 'BASIC' not found for this employee. Choose the right head in settings.";

describe("no silent zero: the pure pieces", () => {
  it("missingHeads lists only the heads absent from the salary; the message names them plainly", () => {
    const lines = [{ componentCode: "TEST_PAY" }, { componentCode: "TEST_HRA" }];
    expect(missingHeads(lines, ["BASIC"])).toEqual(["BASIC"]);
    expect(missingHeads(lines, ["TEST_PAY"])).toEqual([]);
    expect(missingHeads(lines, ["TEST_PAY", "BASIC", "DA"])).toEqual(["BASIC", "DA"]);
    expect(missingHeads([], [])).toEqual([]);
    expect(headRefusalText(["BASIC"])).toBe(REFUSAL);
    expect(headRefusalText(["BASIC", "DA"])).toBe("Salary heads 'BASIC', 'DA' not found for this employee. Choose the right head in settings.");
  });
  it("headCoverage counts each person once, whichever heads they lack, and keeps people without a salary apart", () => {
    const uses = [["gratuity", ["TEST_PAY"]], ["notice pay", ["TEST_PAY"]], ["leave encashment", ["TEST_PAY", "TEST_DA"]]] as const;
    const full = { lines: [{ componentCode: "TEST_PAY" }, { componentCode: "TEST_DA" }] };
    const noDa = { lines: [{ componentCode: "TEST_PAY" }] };
    const none = { lines: [{ componentCode: "TEST_OTHER" }] };
    expect(headCoverage(uses, [full, full, undefined])).toEqual({ without: 0, noSalary: 1, lacking: new Map() });
    const r = headCoverage(uses, [full, noDa, none, undefined]);
    expect([r.without, r.noSalary]).toEqual([2, 1]);
    expect([...r.lacking]).toEqual([["TEST_DA", 2], ["TEST_PAY", 1]]);
  });
});

describe("no silent zero: over a real salary (owner decision 2026-11-17: the settings ship Not set)", () => {
  let world: Closing;
  let separationId = "";
  let da = "";
  const proposalIds: string[] = [];
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const lwd = new Date("2026-09-30T00:00:00Z");
  const noticeGiven = new Date("2026-09-21T00:00:00Z"); // 10 days served
  const who = () => world.named.g!.employeeId;
  const call = (t: string, m: "get" | "post", path: string, body?: object) => request(app)[m](path).set(...authHeader(t)).send(body);
  const set = async (key: string, value: unknown) => proposalIds.push(await setBehaviourByRoute(world.tokens.maker, world.tokens.checkerA, key, value));
  const NOT_SET = { GRATUITY: "Gratuity salary head is not set. Choose it in settings.", NOTICE: "Notice pay salary head is not set. Choose it in settings.", ENCASHMENT: "Leave encashment salary head is not set. Choose it in settings." };
  const paiseOf = (a: string) => { const [w, f = ""] = a.replace("-", "").split("."); return (BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2))) * (a.startsWith("-") ? -1n : 1n); };
  const basicPaise = async () => paiseOf((await prisma.employeeSalary.findFirstOrThrow({ where: { employeeId: who() }, include: { lines: true } })).lines.find((l) => l.componentCode === world.basic)!.amount.toString());
  /** Half up to whole rupees of n/d rupees-in-paise, in paise. */
  const halfUpRupees = (n: bigint, d: bigint) => ((n * 2n + d * 100n) / (d * 200n)) * 100n;

  beforeAll(async () => {
    world = await closingWorld(["g"]);
    await staffWith(world, ["g"], { lock: false });
    // A head that exists in the company but is not in this person's salary (to prove a configured head that is missing is refused, by name).
    da = `${world.prefix}_DA`;
    await makeComponent(world, da);
    // Eleven years' service, and two days of PL at the last working day: every one of the three uses is reached.
    await prisma.employee.update({ where: { id: who() }, data: { dateOfJoining: new Date("2015-04-01T00:00:00Z") } });
    const pl = await prisma.leaveType.findUniqueOrThrow({ where: { code: "PL" } });
    await prisma.leaveLedger.create({ data: { employeeId: who(), leaveTypeId: pl.id, leaveYear: 2026, entryDate: new Date("2026-01-01T00:00:00Z"), entryType: "GRANT", days: "2", referenceType: "MANUAL_GRANT" } });
    separationId = (await prisma.separation.create({ data: { employeeId: who(), lastWorkingDate: lwd, reason: "test", initiatedByUserId: world.maker.userId, initiatedAt: noticeGiven } })).id;
    for (const [k, role] of [["hr", "HR_ADMIN"], ["hrx", "HR_EXECUTIVE"], ["dev", DEVELOPER_ROLE_CODE], ["mgr", "MANAGER"], ["emp", "EMPLOYEE"]] as const) {
      people[k] = await createFullTestEmployee(world.org, { roleCode: role });
      world.userIds.push(people[k]!.userId);
      tok[k] = await loginAs(people[k]!.employeeCode);
    }
  }, 600_000);

  afterAll(async () => {
    await deleteWithDependents("Separation", [separationId]);
    await deleteWithDependents("BehaviourProposal", proposalIds);
    for (const p of Object.values(people)) await cleanupFullTestEmployee(p.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("ships Not set, with no hidden default; each use is refused naming its setting, never 0; so are the settlement and its screen; Ready says so (never blocking)", async () => {
    for (const k of ["payroll.gratuity", "payroll.noticeRecovery", "payroll.leaveEncashment"] as const) {
      expect(BEHAVIOURS[k].defaultValue, k).toBeNull();
      expect(await behaviourOn(k as "payroll.gratuity", "2026-09-30"), k).toBeNull();
    }
    await expect(exitGratuity(who(), lwd)).rejects.toMatchObject({ status: 409, code: "SETTING_NOT_SET", message: NOT_SET.GRATUITY, details: { settings: ["payroll.gratuity"] } });
    await expect(exitNoticeRecovery(who(), noticeGiven, lwd)).rejects.toMatchObject({ status: 409, code: "SETTING_NOT_SET", message: NOT_SET.NOTICE });
    await expect(exitEncashment(who(), "PL", "2", lwd)).rejects.toMatchObject({ status: 409, code: "SETTING_NOT_SET", message: NOT_SET.ENCASHMENT });
    const all = `${NOT_SET.GRATUITY} ${NOT_SET.NOTICE} ${NOT_SET.ENCASHMENT}`;
    await expect(automaticLines(who(), lwd)).rejects.toMatchObject({ status: 409, code: "SETTING_NOT_SET", message: all });
    const screen = await call(world.tokens.maker, "get", `/api/settlements/guide?separationId=${separationId}`);
    expect(screen.status, JSON.stringify(screen.body)).toBe(409);
    expect(screen.body.error).toMatchObject({ code: "SETTING_NOT_SET", message: all });
    const prepare = await call(world.tokens.maker, "post", "/api/settlements", { separationId, directorLines: [] });
    expect([prepare.status, prepare.body.error.message]).toEqual([409, all]);
    expect(await prisma.fnfSettlement.count({ where: { separationId } })).toBe(0); // nothing was prepared with a zero in it
    const readiness = readinessOf(await buildSetupReport());
    const row = readiness.behaviours.find((b) => b.itemId === "settlement:rules")!;
    expect([row.title, row.state, row.where.path]).toEqual(["Final settlement rules: not set", "NOT_SET", "/admin/settings/behaviours#payroll.gratuity"]);
    expect(row.detail).toContain("Not set: gratuity, notice pay, leave encashment.");
    expect(readiness.blockers.some((b) => b.itemId.startsWith("settlement:"))).toBe(false);
    expect(readiness.warnings.some((b) => b.itemId.startsWith("settlement:"))).toBe(false);
  });

  it("only directors may set them: HR, HR executive, a manager, an employee and the Developer are refused (403); a head that does not exist is refused (400)", async () => {
    for (const t of [tok.hr!, tok.hrx!, tok.mgr!, tok.emp!, tok.dev!]) {
      for (const [key, value] of [["payroll.gratuity", testGratuity(world.basic)], ["payroll.noticeRecovery", testNotice(world.basic)], ["payroll.leaveEncashment", testEncashment(world.basic)], ["statutory.state", "GUJARAT"]] as const) {
        expect((await call(t, "post", `/api/behaviours/${key}/proposals`, { value, reason: "test" })).status, key).toBe(403);
      }
      expect((await call(t, "get", "/api/behaviours")).status).toBe(403);
      expect((await call(t, "post", "/api/behaviours/proposals/x/confirm")).status).toBe(403);
    }
    const unknown = await call(world.tokens.maker, "post", "/api/behaviours/payroll.gratuity/proposals", { value: testGratuity("TEST_NO_SUCH_HEAD"), reason: "test" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatchObject({ code: "UNKNOWN_SALARY_HEAD", message: "'TEST_NO_SUCH_HEAD' is not a salary head in this company. Choose from the heads that exist (Payroll, Salary Components)." });
    expect((await call(world.tokens.maker, "post", "/api/behaviours/payroll.noticeRecovery/proposals", { value: testNotice("TEST_NO_SUCH_HEAD"), reason: "test" })).body.error.code).toBe("UNKNOWN_SALARY_HEAD");
    expect((await call(world.tokens.maker, "post", "/api/behaviours/payroll.leaveEncashment/proposals", { value: testEncashment(world.basic, { payHead: "TEST_NO_SUCH_HEAD" }), reason: "test" })).body.error.code).toBe("UNKNOWN_SALARY_HEAD");
    expect((await call(world.tokens.maker, "post", "/api/behaviours/statutory.state/proposals", { value: "NOT_A_STATE", reason: "test" })).status).toBe(400);
    expect(await prisma.behaviourProposal.count({ where: { proposedByUserId: world.maker.userId } })).toBe(0);
  });

  it("gratuity set to this company's differently named head by one director, confirmed by the other: the exact amount, audited; the settlement still names the two not set", async () => {
    const p = await call(world.tokens.maker, "post", "/api/behaviours/payroll.gratuity/proposals", { value: testGratuity(world.basic), reason: "TEST: this company's basic head" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    proposalIds.push(p.body.id);
    expect((await call(world.tokens.maker, "post", `/api/behaviours/proposals/${p.body.id}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
    await expect(exitGratuity(who(), lwd)).rejects.toMatchObject({ code: "SETTING_NOT_SET" }); // not in force until confirmed
    expect((await call(world.tokens.checkerA, "post", `/api/behaviours/proposals/${p.body.id}/confirm`)).status).toBe(200);
    const audit = await prisma.auditLog.findMany({ where: { entityType: "BehaviourProposal", entityId: p.body.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.actorUserId])).toEqual([["settings.behaviour.proposed", world.maker.userId], ["settings.behaviour.confirmed", world.checkerA.userId]]);

    const got = (await exitGratuity(who(), lwd))!;
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: who() } });
    const svc = serviceLength(emp.dateOfJoining, lwd);
    const years = gratuityYears(svc.years, svc.months, "SIX_MONTHS_OR_MORE_COUNTS_AS_A_YEAR");
    expect(years).toBe(12); // 11 years 6 months: six months or more counts as a year
    const b = await basicPaise();
    expect(b > 0n).toBe(true);
    const exact = halfUpRupees(b * 15n * BigInt(years), 26n); // TEST values: 15 days, divisor 26, ceiling 20,00,000 (not reached), whole rupees half up
    expect(paiseOf(got.amount)).toBe(exact < 200000000n ? exact : 200000000n);
    expect(got.amount).not.toBe("0.00");
    await expect(automaticLines(who(), lwd, noticeGiven)).rejects.toMatchObject({ code: "SETTING_NOT_SET", message: `${NOT_SET.NOTICE} ${NOT_SET.ENCASHMENT}` });
    expect(readinessOf(await buildSetupReport()).behaviours.find((r) => r.itemId === "settlement:rules")!.detail).toContain("Not set: notice pay, leave encashment.");
  });

  it("a configured head missing from the person's salary is refused by name; Ready counts the people whose structure lacks it", async () => {
    await set("payroll.noticeRecovery", testNotice(da));
    await set("payroll.leaveEncashment", testEncashment(world.basic));
    await expect(automaticLines(who(), lwd, noticeGiven)).rejects.toMatchObject({ status: 409, code: "SALARY_HEAD_NOT_FOUND", message: `Salary head '${da}' not found for this employee. Choose the right head in settings.`, details: { use: "NOTICE", heads: [da] } });
    const readiness = readinessOf(await buildSetupReport());
    expect(readiness.behaviours.some((r) => r.itemId === "settlement:rules")).toBe(false);
    const row = readiness.behaviours.find((r) => r.itemId === "settlement:heads")!;
    expect(row.title).toBe("Gratuity, notice and encashment salary head matches your structures");
    expect(row.state).toBe("NOT_SET");
    expect(Number(/^(\d+) employees? without the chosen head$/.exec(row.label ?? "")?.[1])).toBeGreaterThanOrEqual(1);
    expect(row.detail).toContain(`'${da}' missing for`);
    expect(row.detail).toContain(`notice pay: ${da}`);
    expect(readiness.blockers.some((b) => b.itemId.startsWith("settlement:"))).toBe(false);
  });

  it("all three set on this company's head: every amount exact and none 0; the settlement can be prepared", async () => {
    await set("payroll.noticeRecovery", testNotice(world.basic));
    const lines = await automaticLines(who(), lwd, noticeGiven);
    const b = await basicPaise();
    const grat = lines.find((l) => l.kind === "GRATUITY")!;
    expect(paiseOf(grat.amount!)).toBe(halfUpRupees(b * 15n * 12n, 26n));
    const notice = lines.find((l) => l.kind === "NOTICE_RECOVERY")!; // 21 to 30 September: 10 of 30 days served, 20 short
    expect(notice.label).toBe("Notice not served (20 days)");
    expect(paiseOf(notice.amount!)).toBe(-halfUpRupees(b * 20n, 30n));
    const leave = lines.find((l) => l.kind === "LEAVE_BALANCE")!;
    expect(leave.label).toBe("Leave encashment (PL)");
    expect(paiseOf(leave.amount!)).toBe(halfUpRupees(b * 2n, 30n));
    for (const l of [grat, notice, leave]) expect(l.amount).not.toBe("0.00");
    const prepare = await call(world.tokens.maker, "post", "/api/settlements", { separationId, directorLines: [] });
    expect(prepare.status, JSON.stringify(prepare.body)).toBe(201);
  });
});
