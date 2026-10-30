import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { businessToday } from "../../../lib/businessDate";
import { setPayrollLockCheck } from "../../../lib/effectiveDating";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { dec, intDec } from "../money";
import { monthsBack, reversalAmounts, type HeadForReversal } from "../salary/lopReversal";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, day, handFinalise, lockCycle, setRules, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "./salaryTestHelpers";

// Stage 3.3b: attendance corrected for a month whose run is final gives back (or takes) loss of pay in a LATER run, a line for each prorated head, linked to the
// month; nothing is posted twice; a correction older than the look-back is refused unless a director records a reason and the rule allows it.

const half = { mode: "HALF_UP" as const, scale: 0 };
const head = (code: string, monthly: string, prorates = true): HeadForReversal => ({ code, prorates, parts: [{ from: "2026-08-01", to: "2026-08-31", monthly }] });

describe("the arithmetic (pure)", () => {
  it("a whole day restored gives back exactly what the run took for it; half a day, half", () => {
    const heads = [head("BASIC", "20000"), head("HRA", "10000")];
    const full = reversalAmounts({ heads, days: [{ date: "2026-08-10", restored: "1" }], divisor: intDec(31), rounding: () => half });
    expect(full.map((a) => [a.component, a.amount.toString()])).toEqual([["BASIC", "645"], ["HRA", "323"]]); // 645.16, 322.58
    const halfDay = reversalAmounts({ heads, days: [{ date: "2026-08-10", restored: "0.5" }], divisor: intDec(31), rounding: () => half });
    expect(halfDay.map((a) => a.amount.toString())).toEqual(["323", "161"]); // 322.58, 161.29
  });

  it("is exact before it rounds: three days are rounded once, not three times", () => {
    const three = reversalAmounts({ heads: [head("BASIC", "20000")], days: ["10", "11", "12"].map((d) => ({ date: `2026-08-${d}`, restored: "1" })), divisor: intDec(31), rounding: () => half });
    expect(three[0]!.amount.toString()).toBe("1935"); // 3 x 645.16 = 1935.48
    expect(three[0]!.exact.times(31).toString()).toBe("60000");
  });

  it("more loss of pay (a minus) takes, and each head uses its own rounding", () => {
    const r = reversalAmounts({ heads: [head("BASIC", "20000"), head("HRA", "10000")], days: [{ date: "2026-08-10", restored: "-1" }], divisor: intDec(31), rounding: (c) => (c === "HRA" ? { mode: "DOWN", scale: 0 } : half) });
    expect(r.map((a) => [a.component, a.amount.toString()])).toEqual([["BASIC", "-645"], ["HRA", "-322"]]);
  });

  it("a head that does not prorate, and a day outside the head's dates, add nothing", () => {
    expect(reversalAmounts({ heads: [head("CONV", "1600", false)], days: [{ date: "2026-08-10", restored: "1" }], divisor: intDec(31), rounding: () => half })).toEqual([]);
    const late: HeadForReversal = { code: "BASIC", prorates: true, parts: [{ from: "2026-08-20", to: "2026-08-31", monthly: "20000" }] };
    expect(reversalAmounts({ heads: [late], days: [{ date: "2026-08-10", restored: "1" }], divisor: intDec(31), rounding: () => half })).toEqual([]);
    expect(() => reversalAmounts({ heads: [head("BASIC", "1")], days: [{ date: "2026-08-10", restored: "1" }], divisor: dec("0"), rounding: () => half })).toThrow(/zero/);
  });

  it("counts whole months back, across a year end", () => {
    expect(monthsBack("2026-08-01", "2026-08-31")).toBe(0);
    expect(monthsBack("2026-08-01", "2026-09-01")).toBe(1);
    expect(monthsBack("2026-08-01", "2026-10-30")).toBe(2);
    expect(monthsBack("2025-12-01", "2026-01-31")).toBe(1);
    expect(monthsBack("2025-04-01", "2026-04-01")).toBe(12);
  });
});

describe("a correction to a final month, end to end", () => {
  let w: RunWorld;
  let augId: string;
  let septId = "";
  const lopId = () => w.named.lop!.employeeId;
  const fullId = () => w.named.full!.employeeId;
  const maker = () => w.tokens.maker;
  const input = (over: Record<string, unknown> = {}) => ({ employeeId: lopId(), cycleStart: CYCLE.start, correctionRef: "ATT-1", days: [{ date: "2026-08-10", restored: "1" }], reason: "Attendance corrected: they were on site", ...over });
  const post = (path: string, body: object, token = maker()) => request(app).post(`/api/payroll${path}`).set(...authHeader(token)).send(body);
  const preview = (over: Record<string, unknown> = {}, token = maker()) => post("/lop-corrections/preview", { input: input(over) }, token);

  beforeAll(async () => {
    w = await buildRunWorld(["lop", "full"]);
    for (const n of ["lop", "full"]) await giveSalary(w, w.named[n]!.employeeId, "600000", FIRST_SALARY_DAY);
    await lockCycle(fullId(), CYCLE.start, CYCLE.end);
    await lockCycle(lopId(), CYCLE.start, CYCLE.end, { "2026-08-10": { lop: "1" }, "2026-08-11": { lop: "1" }, "2026-08-12": { lop: "0.5" } });
    augId = await calculateRun(w);
    await handFinalise(augId, w.maker.userId, w.checkerA.userId);
  }, 300_000);

  afterAll(async () => {
    setPayrollLockCheck(null);
    await teardownRunWorld(w);
  });

  it("previews what each prorated head gives back, linked to the month, and changes nothing", async () => {
    const p = await preview();
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ cycleLabel: CYCLE.label, key: `${CYCLE.start}:${lopId()}:ATT-1`, monthsBack: expect.any(Number), needsOverride: false });
    expect(p.body.days).toEqual([{ date: "2026-08-10", restored: "1", hadLop: "1" }]);
    expect(p.body.lines.length).toBeGreaterThan(0);
    expect(dec(p.body.net).equals(p.body.lines.reduce((s: ReturnType<typeof dec>, l: { amount: string }) => s.plus(dec(l.amount)), dec("0")))).toBe(true);
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: lopId(), source: "LOP_REVERSAL" } })).toBe(0);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: augId } })).status).toBe("FINALISED"); // never altered
  });

  it("is posted once: the same correction (month + person + reference) cannot be recorded twice", async () => {
    const shown = await preview();
    expect(shown.status, JSON.stringify(shown.body)).toBe(200);
    const first = await post("/lop-corrections", { input: input(), fingerprint: shown.body.fingerprint });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const again = await preview();
    expect([again.status, again.body.error.code]).toEqual([409, "LOP_CORRECTION_DUPLICATE"]);
    const forced = await post("/lop-corrections", { input: input(), fingerprint: shown.body.fingerprint });
    expect([forced.status, forced.body.error.code]).toEqual([409, "LOP_CORRECTION_DUPLICATE"]);
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: lopId(), source: "LOP_REVERSAL" } })).toBe(1);
  });

  it("cannot give back more than the month had: that day is already restored; a day with no loss of pay has none to give back", async () => {
    const dup = await preview({ correctionRef: "ATT-2" });
    expect(dup.status).toBe(409);
    expect(dup.body.error.message).toMatch(/already been given back/);
    const none = await preview({ correctionRef: "ATT-3", days: [{ date: "2026-08-20", restored: "1" }] });
    expect(none.status).toBe(409);
    expect(none.body.error.message).toMatch(/had 0 of loss of pay/);
    const half = await preview({ correctionRef: "ATT-4", days: [{ date: "2026-08-12", restored: "1" }] });
    expect(half.status).toBe(409); // that day had only half a day
    expect(half.body.error.message).toMatch(/had 0\.5 of loss of pay/);
    const outside = await preview({ correctionRef: "ATT-5", days: [{ date: "2026-09-02", restored: "1" }] });
    expect(outside.status).toBe(409);
    expect(outside.body.error.message).toMatch(/not in Aug 2026/);
  });

  it("refuses a month with no final run, and a person who was not paid in it", async () => {
    const noRun = await preview({ cycleStart: "2026-05-01" });
    expect([noRun.status, noRun.body.error.code]).toEqual([409, "NO_FINAL_RUN"]);
    const other = await request(app).post("/api/payroll/lop-corrections/preview").set(...authHeader(maker())).send({ input: input({ employeeId: w.outsider.employeeId }) });
    expect([other.status, other.body.error.code]).toEqual([409, "NOT_IN_RUN"]);
  });

  it("is paid in the next run as a line for each prorated head, linked to the month, carrying the correction's key", async () => {
    await lockCycle(lopId(), "2026-09-01", "2026-09-30");
    await lockCycle(fullId(), "2026-09-01", "2026-09-30");
    await setRules(w.maker.userId, { ARREARS_PF_ESI: "FOLLOW_COMPONENT_FLAGS" }); // a run that pays a reversal needs the rule on how PF and ESI treat it (salaryRules32 proves it is asked for)
    const sept = await calculateRun(w, "2026-09-01");
    septId = sept;
    const item = (await api(maker(), "get", `/runs/${sept}/items/${lopId()}`)).body;
    const lines = item.lines.filter((l: { source: string }) => l.source === "LOP_REVERSAL");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) {
      expect(l.kind).toBe("EARNING");
      expect(l.code).toBe("LOP_REVERSAL");
      expect(l.label).toMatch(/Loss of pay reversal: .* for 2026-08-01 to 2026-08-31/);
      expect(l.basis).toMatchObject({ kind: "LOP_REVERSAL", correctionKey: `${CYCLE.start}:${lopId()}:ATT-1` });
    }
    const adjustment = await prisma.payrollAdjustment.findFirstOrThrow({ where: { employeeId: lopId(), source: "LOP_REVERSAL" } });
    expect(lines.every((l: { sourceRef: string }) => l.sourceRef === adjustment.id)).toBe(true);
    const total = lines.reduce((s: ReturnType<typeof dec>, l: { amount: string }) => s.plus(dec(l.amount)), dec("0"));
    expect(total.equals(dec(adjustment.amount.toString()))).toBe(true);
    expect((await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: adjustment.id } })).status).toBe("PENDING"); // a draft only reads it
    // The person with no correction gets no such line.
    const other = (await api(maker(), "get", `/runs/${sept}/items/${fullId()}`)).body;
    expect(other.lines.filter((l: { source: string }) => l.source === "LOP_REVERSAL")).toEqual([]);
  });

  it("is a director's act: somebody without payroll permission is refused, and nobody can correct their own pay", async () => {
    expect((await preview({ correctionRef: "ATT-9" }, w.tokens.outsider)).status).toBe(403);
    expect((await post("/lop-corrections", { input: input({ correctionRef: "ATT-9" }), fingerprint: "x" }, w.tokens.outsider)).status).toBe(403);
    const own = await request(app).post("/api/payroll/lop-corrections/preview").set(...authHeader(maker())).send({ input: input({ employeeId: w.maker.employeeId, correctionRef: "ATT-9" }) });
    expect(own.status).toBe(403);
  });

  it("a preview that no longer matches is refused", async () => {
    const p = await preview({ correctionRef: "ATT-6", days: [{ date: "2026-08-11", restored: "1" }] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    const stale = await post("/lop-corrections", { input: input({ correctionRef: "ATT-6", days: [{ date: "2026-08-11", restored: "0.5" }] }), fingerprint: p.body.fingerprint });
    expect([stale.status, stale.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
  });

  describe("the look-back", () => {
    it("a correction older than the look-back is refused when the override is off, and needs a reason when it is on", async () => {
      await setRules(w.maker.userId, { LOP_REVERSAL_LOOKBACK_MONTHS: 1, LOP_REVERSAL_OVERRIDE_ALLOWED: false });
      const refused = await preview({ correctionRef: "ATT-7", days: [{ date: "2026-08-11", restored: "1" }] });
      expect([refused.status, refused.body.error.code]).toEqual([409, "LOP_LOOKBACK_EXCEEDED"]);
      expect(refused.body.error.message).toMatch(/only 1 month back/);
      await setRules(w.maker.userId, { LOP_REVERSAL_OVERRIDE_ALLOWED: true });
      const needReason = await preview({ correctionRef: "ATT-7", days: [{ date: "2026-08-11", restored: "1" }] });
      expect([needReason.status, needReason.body.error.code]).toEqual([409, "LOP_OVERRIDE_REASON_REQUIRED"]);
      const ok = await preview({ correctionRef: "ATT-7", days: [{ date: "2026-08-11", restored: "1" }], overrideReason: "Late biometric import found" });
      expect(ok.status, JSON.stringify(ok.body)).toBe(200);
      expect(ok.body).toMatchObject({ needsOverride: true, overrideReason: "Late biometric import found" });
      const added = await post("/lop-corrections", { input: input({ correctionRef: "ATT-7", days: [{ date: "2026-08-11", restored: "1" }], overrideReason: "Late biometric import found" }), fingerprint: ok.body.fingerprint });
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      const row = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: added.body.id } });
      expect(row.reason).toMatch(/director override: Late biometric import found/);
      const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.lop_correction.added", entityId: row.id } });
      expect(audit.after).toMatchObject({ overridden: true, amounts: "redacted" });
    });

    it("a correction exactly at the look-back is allowed without an override; one month beyond it is not", async () => {
      const back = monthsBack(CYCLE.start, businessToday().toISOString().slice(0, 10));
      await setRules(w.maker.userId, { LOP_REVERSAL_LOOKBACK_MONTHS: back, LOP_REVERSAL_OVERRIDE_ALLOWED: false });
      const at = await preview({ correctionRef: "ATT-8", days: [{ date: "2026-08-12", restored: "0.5" }] });
      expect(at.status, JSON.stringify(at.body)).toBe(200);
      expect(at.body).toMatchObject({ needsOverride: false, monthsBack: back, lookbackMonths: back });
      await setRules(w.maker.userId, { LOP_REVERSAL_LOOKBACK_MONTHS: back - 1 });
      const beyond = await preview({ correctionRef: "ATT-8", days: [{ date: "2026-08-12", restored: "0.5" }] });
      expect([beyond.status, beyond.body.error.code]).toEqual([409, "LOP_LOOKBACK_EXCEEDED"]);
      await setRules(w.maker.userId, { LOP_REVERSAL_LOOKBACK_MONTHS: 36, LOP_REVERSAL_OVERRIDE_ALLOWED: true });
    });
  });

  it("more loss of pay found later is taken as a deduction line", async () => {
    const p = await preview({ correctionRef: "ATT-10", days: [{ date: "2026-08-20", restored: "-1" }] });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(dec(p.body.net).isNegative()).toBe(true);
    const added = await post("/lop-corrections", { input: input({ correctionRef: "ATT-10", days: [{ date: "2026-08-20", restored: "-1" }] }), fingerprint: p.body.fingerprint });
    expect(added.status).toBe(201);
    expect((await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: added.body.id } })).direction).toBe("DEDUCTION");
    await calculateAgain(w, septId);
    const item = (await api(maker(), "get", `/runs/${septId}/items/${lopId()}`)).body;
    const taken = item.lines.filter((l: { source: string; kind: string }) => l.source === "LOP_REVERSAL" && l.kind === "DEDUCTION");
    expect(taken.length).toBeGreaterThan(0);
    expect(taken.every((l: { basis: { signed: string }; amount: string }) => dec(l.basis.signed).isNegative() && !dec(l.amount).isNegative())).toBe(true);
  });

  it("the August run's own figures are untouched by all of it", async () => {
    const aug = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: lopId() }, include: { lines: true } });
    expect(aug.lines.some((l) => l.source === "LOP_REVERSAL")).toBe(false);
    expect(calculateAgain).toBeDefined();
    expect(day(CYCLE.start)).toBeInstanceOf(Date);
  });
});
