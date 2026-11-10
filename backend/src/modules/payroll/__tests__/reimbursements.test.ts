import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { dec } from "../money";
import { withinCap } from "../reimbursements/service";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { calculateRun, setRules } from "./runTestHelpers";
import { makeComponent } from "./salaryTestHelpers";

// P7-5 (docs/plans/P7_5_REIMBURSEMENTS.md): reimbursements through the real API, a real run and the real database. Made-up figures only.
const paise = (s: string) => {
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
};

describe("P7-5 — the cap rule against an independent model", () => {
  it("allows exactly up to the cap, never over; no cap allows anything", () => {
    let seed = 5;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const txt = (p: number) => `${Math.floor(p / 100)}.${String(p % 100).padStart(2, "0")}`;
    for (let i = 0; i < 500; i += 1) {
      const cap = 1 + rnd(1_000_000);
      const before = rnd(1_000_000);
      const amount = 1 + rnd(1_000_000);
      expect(withinCap(dec(txt(cap)), dec(txt(before)), dec(txt(amount)))).toBe(before + amount <= cap);
    }
    expect(withinCap(null, dec("999999"), dec("1"))).toBe(true);
  });
});

describe("P7-5 — claims over the routes and a payroll run", () => {
  let world: Closing;
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let hr: { employeeId: string; userId: string; employeeCode: string };
  const tok: Record<string, string> = {};
  const typeKey = `TC${Date.now().toString(36).slice(-5).toUpperCase()}`;
  const ids: Record<string, string> = {};
  const call = (t: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](`/api/reimbursements${path}`).set(...authHeader(t)).send(body);

  beforeAll(async () => {
    world = await closingWorld(["a"]);
    await staffWith(world, ["a"]);
    await setRules(world.maker.userId, REAL_RULES);
    await makeComponent(world, `${world.prefix}_REIMB`, { name: "Reimbursement", payslipLabel: "Reimbursement", payslipOrder: 40, taxable: false, prorates: false });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    world.userIds.push(dev.userId, hr.userId);
    await prisma.employee.updateMany({ where: { id: { in: [dev.employeeId, hr.employeeId] } }, data: { dateOfJoining: new Date("2026-09-01T00:00:00Z") } }); // not in the August run
    tok.dev = await loginAs(dev.employeeCode);
    tok.hr = await loginAs(hr.employeeCode);
    tok.a = await loginAs(world.named.a!.employeeCode);
  }, 600_000);

  afterAll(async () => {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SELECT set_config('app.audit_purge', 'test', true)");
      await tx.claimTypeVersion.deleteMany({ where: { typeKey } });
    });
    await cleanupFullTestEmployee(dev.employeeId);
    await cleanupFullTestEmployee(hr.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("HR, the Developer role and an employee are refused the directors' routes; no sign-in is refused", async () => {
    for (const t of ["hr", "dev", "a"]) {
      expect((await call(tok[t]!, "get", "")).status, t).toBe(403);
      expect((await call(tok[t]!, "put", "/types", { typeKey })).status, t).toBe(403);
    }
    expect((await call(tok.dev!, "get", "/mine")).status).toBe(403);
    expect((await request(app).get("/api/reimbursements/mine")).status).toBe(401);
  });

  it("a type is Not set until every choice is made; a bill is required when the type says so", async () => {
    const half = await call(world.tokens.maker, "put", "/types", { typeKey, name: "Test travel", employeesMayClaim: null, billsRequired: null, monthlyCapSet: false, monthlyCap: null, yearlyCapSet: false, yearlyCap: null, payHead: null, reason: "made up" });
    expect(half.body.gaps.length).toBe(5);
    expect((await call(tok.a!, "post", "/mine", { typeKey, spentOn: "2026-08-05", amount: "100", description: "taxi" })).body.error.code).toBe("TYPE_NOT_SET");
    await call(world.tokens.maker, "put", "/types", { typeKey, name: "Test travel", employeesMayClaim: true, billsRequired: true, monthlyCapSet: true, monthlyCap: "1000", yearlyCapSet: true, yearlyCap: null, payHead: `${world.prefix}_REIMB`, reason: "made up" });
    expect((await call(tok.a!, "post", "/mine", { typeKey, spentOn: "2026-08-05", amount: "100", description: "taxi" })).body.error.code).toBe("BILL_REQUIRED");
    const ok = await call(world.tokens.maker, "put", "/types", { typeKey, name: "Test travel", employeesMayClaim: true, billsRequired: false, monthlyCapSet: true, monthlyCap: "1000", yearlyCapSet: true, yearlyCap: null, payHead: `${world.prefix}_REIMB`, reason: "made up" });
    expect(ok.body.gaps).toEqual([]);
  });

  it("the person claims; a director decides (never their own); the monthly cap is held; a lower amount needs a reason", async () => {
    for (const [k, amount] of [["c1", "600"], ["c2", "500"], ["c3", "50"]] as const) {
      const r = await call(tok.a!, "post", "/mine", { typeKey, spentOn: "2026-08-05", amount, description: `made-up claim ${k}` });
      expect(r.status).toBe(201);
      ids[k] = r.body.id;
    }
    const mine = await call(world.tokens.maker, "post", "/mine", { typeKey, spentOn: "2026-08-05", amount: "10", description: "my own" });
    expect((await call(world.tokens.maker, "post", `/${mine.body.id}/decision`, { decision: "APPROVE" })).body.error.code).toBe("OWN_CLAIM");
    expect((await call(world.tokens.maker, "post", `/${ids.c1}/decision`, { decision: "APPROVE" })).status).toBe(200);
    expect((await call(world.tokens.maker, "post", `/${ids.c2}/decision`, { decision: "APPROVE" })).body.error.code).toBe("OVER_CAP");
    expect((await call(world.tokens.maker, "post", `/${ids.c2}/decision`, { decision: "APPROVE", amount: "400" })).status).toBe(400); // lower: needs a reason
    expect((await call(world.tokens.maker, "post", `/${ids.c2}/decision`, { decision: "APPROVE", amount: "400", reason: "only up to the monthly cap" })).status).toBe(200);
    expect((await call(tok.a!, "post", `/mine/${ids.c3}/withdraw`)).body.status).toBe("WITHDRAWN");
    expect((await call(world.tokens.maker, "post", `/${ids.c3}/decision`, { decision: "APPROVE" })).body.error.code).toBe("ALREADY_DECIDED");
    await expect(prisma.claimDecision.updateMany({ where: { claimId: ids.c1 }, data: { reason: "x" } })).rejects.toThrow(/REIMBURSEMENT_RECORD_IMMUTABLE/);
  });

  it("the August run pays the approved claims; finalising consumes them; the person sees them paid", async () => {
    const runId = await calculateRun(world);
    const lines = await prisma.payrollRunLine.findMany({ where: { runId, employeeId: world.named.a!.employeeId, code: `${world.prefix}_REIMB` } });
    expect(lines.map((l) => paise(l.amount.toFixed(2))).reduce((a, b) => a + b, 0n)).toBe(paise("1000"));
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    const mine = await call(tok.a!, "get", "/mine");
    const byId = new Map(mine.body.claims.map((c: { id: string; status: string; paidIn: string | null }) => [c.id, c]));
    expect(byId.get(ids.c1)).toMatchObject({ status: "PAID", paidIn: "Aug 2026" });
    expect(byId.get(ids.c2)).toMatchObject({ status: "PAID", approvedAmount: "400" });
    expect(byId.get(ids.c3)).toMatchObject({ status: "WITHDRAWN" });
  });
});
