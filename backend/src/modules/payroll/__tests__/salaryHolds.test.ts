import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { outstandingHeldPay } from "../salary/holds";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, handFinalise, lockCycle, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary } from "./salaryTestHelpers";

// Stage 3.3c: a director holds one person's salary for one month; the run calculates them but does not pay them; a release before the run is final lifts the hold,
// and a release after pays the held net pay in a later run as a line of its own. The final run is never changed.

describe("hold salary and release it", () => {
  let w: RunWorld;
  let augId = "";
  const id = (n: string) => w.named[n]!.employeeId;
  const maker = () => w.tokens.maker;
  const post = (path: string, body: object, token = maker()) => request(app).post(`/api/payroll${path}`).set(...authHeader(token)).send(body);
  const hold = (n: string, over: Record<string, unknown> = {}, token = maker()) => post("/holds", { input: { employeeId: id(n), cycleStart: CYCLE.start, reason: "Documents pending", ...over } }, token);
  const release = (holdId: string, note = "Documents received", token = maker()) => post(`/holds/${holdId}/release`, { input: { note } }, token);
  const item = async (runId: string, n: string) => (await api(maker(), "get", `/runs/${runId}/items/${id(n)}`)).body;
  const holdIds: Record<string, string> = {};

  beforeAll(async () => {
    w = await buildRunWorld(["a", "b", "c"]);
    for (const n of ["a", "b", "c"]) {
      await giveSalary(w, id(n), "600000", FIRST_SALARY_DAY);
      await lockCycle(id(n), CYCLE.start, CYCLE.end);
    }
  }, 300_000);
  afterAll(async () => {
    await teardownRunWorld(w);
  });

  it("holds a person's month with a reason; only a director, never for their own pay; a month is held once", async () => {
    const a = await hold("a");
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    holdIds.a = a.body.id;
    holdIds.b = (await hold("b")).body.id;
    expect((await hold("c", {}, w.tokens.outsider)).status).toBe(403);
    expect((await hold("c", { employeeId: w.maker.employeeId })).status).toBe(403); // not their own pay
    const again = await hold("a");
    expect([again.status, again.body.error.code]).toEqual([409, "HOLD_EXISTS"]);
    expect((await hold("c", { reason: "x" })).status).toBe(400);
    expect((await hold("c", { cycleStart: "2026-08-15" })).status).toBe(400); // not the first day of a period
    const list = await request(app).get("/api/payroll/holds?status=HELD").set(...authHeader(maker()));
    expect(list.status).toBe(200);
    expect(list.body.holds.map((h: { id: string }) => h.id).sort()).toEqual([holdIds.a, holdIds.b].sort());
    expect((await request(app).get("/api/payroll/holds").set(...authHeader(w.tokens.outsider))).status).toBe(403);
  });

  it("the database holds it too: not changed or deleted, and not written for somebody who is not a Super Admin", async () => {
    await expect(prisma.payrollSalaryHold.update({ where: { id: holdIds.a! }, data: { reason: "changed" } })).rejects.toThrow(/SALARY_HOLDS_APPEND_ONLY/);
    await expect(prisma.payrollSalaryHold.delete({ where: { id: holdIds.a! } })).rejects.toThrow(/SALARY_HOLDS_APPEND_ONLY/);
    await expect(prisma.payrollSalaryHold.create({ data: { employeeId: id("c"), cycleStart: new Date(`${CYCLE.start}T00:00:00Z`), reason: "sneaky", heldByUserId: w.outsider.userId } })).rejects.toThrow(/SALARY_HOLDS_DIRECTORS_ONLY/);
  });

  it("the run calculates a held person but does not pay them: HELD for a director's hold, no payslip, others unaffected", async () => {
    augId = await calculateRun(w);
    const a = await item(augId, "a");
    expect([a.status, a.holdReason]).toEqual(["HELD", "DIRECTOR_HOLD"]);
    expect(a.lines.length).toBeGreaterThan(0); // still calculated
    expect(a.holdDetail).toMatch(/held by a director/i);
    expect((await item(augId, "c")).status).toBe("PAYABLE");
    expect(await prisma.payslip.count({ where: { runItem: { runId: augId, employeeId: id("a") } } })).toBe(0);
  });

  it("a release before the run is final lifts the hold, creates no payment of its own, and the next calculation pays them", async () => {
    const r = await release(holdIds.a!);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.adjustmentId).toBeNull();
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: id("a"), source: "HOLD_RELEASE" } })).toBe(0);
    await calculateAgain(w, augId);
    expect((await item(augId, "a")).status).toBe("PAYABLE");
    expect((await item(augId, "b")).holdReason).toBe("DIRECTOR_HOLD");
    const twice = await release(holdIds.a!);
    expect([twice.status, twice.body.error.code]).toEqual([409, "ALREADY_RELEASED"]);
  });

  it("what is held and not released is readable for full-and-final settlement", async () => {
    const before = await outstandingHeldPay(id("b"));
    expect(before).toEqual([{ holdId: holdIds.b, cycleStart: CYCLE.start, netPay: null }]); // the run is not final, so no amount yet
    expect(await outstandingHeldPay(id("a"))).toEqual([]);
  });

  it("a month whose run is final cannot be held afterwards", async () => {
    await handFinalise(augId, w.maker.userId, w.checkerA.userId);
    const late = await hold("c");
    expect([late.status, late.body.error.code]).toEqual([409, "RUN_FINAL"]);
    const out = await outstandingHeldPay(id("b"));
    expect(out[0]!.netPay).not.toBeNull();
  });

  it("a release after the run is final pays the held net pay in a later run, as a line of its own, without changing the final run", async () => {
    const held = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId: augId, employeeId: id("b") } });
    expect(held.status).toBe("HELD");
    const r = await release(holdIds.b!);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const adj = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: r.body.adjustmentId } });
    expect([adj.source, adj.direction, adj.status, adj.sourceRef]).toEqual(["HOLD_RELEASE", "EARNING", "PENDING", holdIds.b]);
    expect(adj.amount.toString()).toBe(held.netPay.toString());
    expect((await prisma.payrollRunItem.findUniqueOrThrow({ where: { id: held.id } })).status).toBe("HELD"); // August is as it was
    // Next month: the line is there, carrying the month it belongs to.
    for (const n of ["a", "b", "c"]) await lockCycle(id(n), "2026-09-01", "2026-09-30");
    const sept = await calculateRun(w, "2026-09-01");
    const b = await item(sept, "b");
    const lines = b.lines.filter((l: { source: string }) => l.source === "HOLD_RELEASE");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ kind: "EARNING", code: "HOLD_RELEASE", amount: held.netPay.toString(), sourceRef: adj.id });
    expect(lines[0].label).toMatch(/Held salary released for 2026-08-01 to 2026-08-31/);
    expect(lines[0].basis).toMatchObject({ kind: "HOLD_RELEASE", holdId: holdIds.b, netOfStatutory: true });
    expect((await item(sept, "a")).lines.filter((l: { source: string }) => l.source === "HOLD_RELEASE")).toEqual([]);
    expect(await outstandingHeldPay(id("b"))).toEqual([]);
  });

  it("a release is refused when the final run did not actually hold that person for this reason", async () => {
    const stray = await prisma.payrollSalaryHold.create({ data: { employeeId: id("c"), cycleStart: new Date(`${CYCLE.start}T00:00:00Z`), reason: "recorded after the fact", heldByUserId: w.maker.userId } });
    const r = await release(stray.id);
    expect([r.status, r.body.error.code]).toEqual([409, "NOTHING_TO_RELEASE"]);
    expect(await prisma.payrollAdjustment.count({ where: { employeeId: id("c"), source: "HOLD_RELEASE" } })).toBe(0);
  });

  it("is audited without amounts, and a release needs a reason", async () => {
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "payroll.salary_hold.released", entityId: holdIds.b! } });
    expect(audit.after).toMatchObject({ paidLater: true, amounts: "redacted" });
    expect((await release(holdIds.b!, "x")).status).toBe(400);
    expect((await release("no-such-hold")).status).toBe(404);
    expect((await release(holdIds.b!, "again", w.tokens.outsider)).status).toBe(403);
  });
});
