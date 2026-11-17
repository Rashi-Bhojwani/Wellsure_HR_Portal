import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { deleteWithDependents } from "../../../lib/__tests__/cleanup";
import { prisma } from "../../../lib/prisma";
import { behaviourOn } from "../../behaviours/service";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { gratuityYears } from "../payPolicies/arith";
import { exitGratuity, headRefusalText, missingHeads } from "../payPolicies/service";
import { serviceLength } from "../settlements/guide";
import { automaticLines } from "../settlements/service";
import { buildSetupReport, headCoverage, readinessOf } from "../setup/status";
import { closeWorld, closingWorld, staffWith, type Closing } from "./closeTestHelpers";
import { Frac } from "./rational";

// No silent zero (2026-11-17, docs/plans/OWNER_REVIEW_SHEET.md): gratuity, notice pay and leave encashment use the salary heads chosen in Default behaviours (standard
// default BASIC). A head missing from the person's salary refuses the calculation with a plain message; it never returns 0. The settlement screen meets the same refusal.
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

describe("no silent zero: over a real salary", () => {
  let world: Closing;
  let separationId = "";
  const proposalIds: string[] = [];
  const people: Record<string, { employeeId: string; userId: string; employeeCode: string }> = {};
  const tok: Record<string, string> = {};
  const lwd = new Date("2026-09-30T00:00:00Z");
  const who = () => world.named.g!.employeeId;
  const call = (t: string, m: "get" | "post", path: string, body?: object) => request(app)[m](path).set(...authHeader(t)).send(body);

  beforeAll(async () => {
    world = await closingWorld(["g"]);
    await staffWith(world, ["g"], { lock: false });
    // Eleven years' service, so the standard gratuity (five years) applies to this synthetic person.
    await prisma.employee.update({ where: { id: who() }, data: { dateOfJoining: new Date("2015-04-01T00:00:00Z") } });
    separationId = (await prisma.separation.create({ data: { employeeId: who(), lastWorkingDate: lwd, reason: "test", initiatedByUserId: world.maker.userId } })).id;
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

  it("the standard head BASIC is not in this salary: gratuity is refused with the plain message, never 0, and so is the settlement and its screen", async () => {
    await expect(exitGratuity(who(), lwd)).rejects.toMatchObject({ status: 409, code: "SALARY_HEAD_NOT_FOUND", message: REFUSAL, details: { use: "GRATUITY", heads: ["BASIC"] } });
    await expect(automaticLines(who(), lwd)).rejects.toMatchObject({ status: 409, code: "SALARY_HEAD_NOT_FOUND", message: REFUSAL });
    const screen = await call(world.tokens.maker, "get", `/api/settlements/guide?separationId=${separationId}`);
    expect(screen.status, JSON.stringify(screen.body)).toBe(409);
    expect(screen.body.error).toMatchObject({ code: "SALARY_HEAD_NOT_FOUND", message: REFUSAL });
    const prepare = await call(world.tokens.maker, "post", "/api/settlements", { separationId, directorLines: [] });
    expect(prepare.status, JSON.stringify(prepare.body)).toBe(409);
    expect(prepare.body.error.message).toBe(REFUSAL);
    expect(await prisma.fnfSettlement.count({ where: { separationId } })).toBe(0); // nothing was prepared with a zero in it
  });

  it("only directors may choose the heads: HR, HR executive, a manager, an employee and the Developer are refused (403); an unknown head is refused (400)", async () => {
    const std = (await behaviourOn("payroll.gratuity", "2026-09-30"))!;
    for (const t of [tok.hr!, tok.hrx!, tok.mgr!, tok.emp!, tok.dev!]) {
      for (const key of ["payroll.gratuity", "payroll.noticeRecovery", "payroll.leaveEncashment"]) {
        expect((await call(t, "post", `/api/behaviours/${key}/proposals`, { value: { ...std, wageHeads: [world.basic] }, reason: "test" })).status, key).toBe(403);
      }
      expect((await call(t, "get", "/api/behaviours")).status).toBe(403);
    }
    const unknown = await call(world.tokens.maker, "post", "/api/behaviours/payroll.gratuity/proposals", { value: { ...std, wageHeads: ["TEST_NO_SUCH_HEAD"] }, reason: "test" });
    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toMatchObject({ code: "UNKNOWN_SALARY_HEAD", message: "'TEST_NO_SUCH_HEAD' is not a salary head in this company. Choose from the heads that exist (Payroll, Salary Components)." });
    const notice = (await behaviourOn("payroll.noticeRecovery", "2026-09-30"))!;
    expect((await call(world.tokens.maker, "post", "/api/behaviours/payroll.noticeRecovery/proposals", { value: { ...notice, basisHeads: ["TEST_NO_SUCH_HEAD"] }, reason: "test" })).body.error.code).toBe("UNKNOWN_SALARY_HEAD");
    expect(await prisma.behaviourProposal.count({ where: { proposedByUserId: world.maker.userId } })).toBe(0);
  });

  it("set to this company's differently named head by one director and confirmed by the other: the exact amount; the change is audited", async () => {
    const std = (await behaviourOn("payroll.gratuity", "2026-09-30"))!;
    const p = await call(world.tokens.maker, "post", "/api/behaviours/payroll.gratuity/proposals", { value: { ...std, effectiveFrom: "2026-01-01", wageHeads: [world.basic] }, reason: "TEST: this company's basic head" });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    proposalIds.push(p.body.id);
    expect((await call(world.tokens.maker, "post", `/api/behaviours/proposals/${p.body.id}/confirm`)).body.error.code).toBe("CHECKER_IS_MAKER");
    await expect(exitGratuity(who(), lwd)).rejects.toMatchObject({ code: "SALARY_HEAD_NOT_FOUND" }); // not in force until confirmed
    const c = await call(world.tokens.checkerA, "post", `/api/behaviours/proposals/${p.body.id}/confirm`);
    expect(c.status, JSON.stringify(c.body)).toBe(200);
    const audit = await prisma.auditLog.findMany({ where: { entityType: "BehaviourProposal", entityId: p.body.id }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => [a.action, a.actorUserId])).toEqual([["settings.behaviour.proposed", world.maker.userId], ["settings.behaviour.confirmed", world.checkerA.userId]]);

    const got = (await exitGratuity(who(), lwd))!;
    const sal = await prisma.employeeSalary.findFirstOrThrow({ where: { employeeId: who() }, include: { lines: true } });
    const basic = sal.lines.find((l) => l.componentCode === world.basic)!.amount.toString();
    const [w, f = ""] = basic.split(".");
    const basicPaise = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
    expect(basicPaise > 0n).toBe(true);
    const emp = await prisma.employee.findUniqueOrThrow({ where: { id: who() } });
    const svc = serviceLength(emp.dateOfJoining, lwd);
    const years = gratuityYears(svc.years, svc.months, std.partYear);
    const exact = new Frac(basicPaise * BigInt(std.daysPerYear) * BigInt(years), 100n * BigInt(std.divisor));
    const ceiling = std.ceiling === "NONE" ? null : BigInt(std.ceiling) * 100n;
    // Half up to the setting's own scale (the standard gratuity rounds to whole rupees), in paise.
    const unit = 10n ** BigInt(2 - std.rounding.scale); // paise per rounding step
    const halfUp = ((exact.n * 10n ** BigInt(std.rounding.scale) * 2n + exact.d) / (exact.d * 2n)) * unit; // exact is in rupees
    const expected = ceiling !== null && halfUp > ceiling ? ceiling : halfUp;
    const [gw, gf = ""] = got.amount.split(".");
    expect(BigInt(gw!) * 100n + BigInt((gf + "00").slice(0, 2))).toBe(expected);
    expect(got.amount).not.toBe("0.00");
    // The settlement now gets its gratuity line (no leave balance and no notice date here, so the other two uses are not reached).
    const lines = await automaticLines(who(), lwd);
    expect(lines.find((l) => l.kind === "GRATUITY")?.amount).toBe(got.amount);
  });

  it("Ready for First Run: a non-blocking row says how many active employees' structures lack a chosen head (here notice and encashment still use BASIC)", async () => {
    const readiness = readinessOf(await buildSetupReport());
    expect(readiness.blockers.some((b) => b.itemId === "settlement:heads")).toBe(false);
    expect(readiness.warnings.some((b) => b.itemId === "settlement:heads")).toBe(false);
    const row = readiness.behaviours.find((b) => b.itemId === "settlement:heads")!;
    expect(row.title).toBe("Gratuity, notice and encashment salary head matches your structures");
    expect(row.state).toBe("NOT_SET");
    const n = Number(/^(\d+) employees? without the chosen head$/.exec(row.label ?? "")?.[1]);
    expect(n).toBeGreaterThanOrEqual(1); // at least this person; other active people in the test database may lack it too
    expect(row.detail).toContain("'BASIC' missing for");
    expect(row.detail).toContain(`gratuity: ${world.basic}`);
    expect(row.where.path).toBe("/admin/settings/behaviours");
  });
});
