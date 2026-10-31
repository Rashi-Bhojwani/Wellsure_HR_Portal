import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, handFinalise, lockCycle, sidelineEveryoneBut, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary, makeComponent, type Person } from "./salaryTestHelpers";
import { setPayrollConsumptionCheck, setPayrollInputsListener, setPayrollLockCheck } from "../../../lib/effectiveDating";
import { payrollConsumption, payrollLockOn } from "../run/lock";
import { setDirectorChoices, useSecondDirectorChecks } from "./payrollTestHelpers";

// Stage 4: Monthly Inputs, directors only (docs/plans/STAGE_4_PLAN.md). The grid opens when attendance is final; a figure is exact, entered once per change and never
// overwritten; a second director confirms exactly these figures and any change voids it; the run refuses until every figure is entered and confirmed, naming each.

describe("monthly inputs: entry, history, confirmation and the run", () => {
  let w: RunWorld;
  let dev: Person;
  let restore: () => Promise<void>;
  let incentive = "";
  let advance = "";
  const id = (n: string) => w.named[n]!.employeeId;
  const maker = () => w.tokens.maker;
  const month = CYCLE.start;
  const get = (path: string, token = maker()) => request(app).get(`/api/payroll/monthly-inputs${path}`).set(...authHeader(token));
  const post = (path: string, body: object, token = maker()) => request(app).post(`/api/payroll/monthly-inputs${path}`).set(...authHeader(token)).send(body);
  const enter = (entries: Array<{ employeeId: string; head: string; amount: string | null }>, token = maker(), cycleStart = month) => post("/entries", { cycleStart, entries, reason: "Entered in the test" }, token);
  const figure = async (n: string, head: string) => {
    const g = await get(`?cycleStart=${month}&employeeId=${id(n)}`);
    return g.body.rows[0]?.cells.find((c: { head: string }) => c.head === head)?.amount as string | null;
  };
  const confirmAs = async (maker_ = maker(), checker = w.tokens.checkerA) => {
    const preview = await post("/confirm-preview", { cycleStart: month }, maker_);
    const submitted = await post("/confirm", { cycleStart: month, fingerprint: preview.body.fingerprint }, maker_);
    if (submitted.status !== 201) return { submitted, decided: null };
    const seen = await post("/confirm-preview", { cycleStart: month }, checker);
    const decided = await post(`/decision/${month}`, { decision: "APPROVE", fingerprint: seen.body.fingerprint }, checker);
    return { submitted, decided };
  };

  beforeAll(async () => {
    // The seams payroll plugs into at process start (the api and the worker do it): what a month's "locked" means is a run that is with an approver or final.
    setPayrollLockCheck(payrollLockOn);
    setPayrollConsumptionCheck(payrollConsumption);
    w = await buildRunWorld(["a", "b", "c"]);
    dev = await createFullTestEmployee(w.org, { roleCode: DEVELOPER_ROLE_CODE });
    const everyone = [w.maker, w.checkerA, w.checkerB, w.outsider, dev, ...w.staff];
    restore = await sidelineEveryoneBut(everyone.map((p) => p.employeeId));
    for (const p of everyone) await lockCycle(p.employeeId, CYCLE.start, CYCLE.end);
    for (const n of ["a", "b", "c"]) await giveSalary(w, id(n), "600000", FIRST_SALARY_DAY);
    incentive = `${w.prefix}_INC`;
    advance = `${w.prefix}_ADV`;
    await makeComponent(w, incentive, { name: `Incentive ${w.prefix}`, payslipOrder: 20, inputItem: true, pfApplicable: false, inputDirection: "EARNING", inputAllowNegative: false });
    await makeComponent(w, advance, { name: `Advance ${w.prefix}`, type: "DEDUCTION", payslipOrder: 21, inputItem: true, taxable: false, inputDirection: "DEDUCTION", inputAllowNegative: false });
  }, 300_000);
  afterAll(async () => {
    setPayrollLockCheck(null);
    setPayrollConsumptionCheck(null);
    setPayrollInputsListener(null);
    await restore?.();
    await cleanupFullTestEmployee(dev.employeeId);
    await teardownRunWorld(w);
  }, 120_000);

  it("the month is open once attendance is final, and lists the flagged heads (nothing hard-coded)", async () => {
    const m = await get(`/month?cycleStart=${month}`);
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body.state).toBe("OPEN");
    expect(m.body.heads.map((h: { code: string }) => h.code).sort()).toEqual([advance, incentive].sort());
    expect(m.body.heads.find((h: { code: string }) => h.code === advance).type).toBe("DEDUCTION");
    expect(m.body.blank).toBe(m.body.cells); // nothing entered yet
  });

  it("a month whose attendance is not final is closed: the grid refuses entry and says why", async () => {
    const sep = "2026-09-01";
    const m = await get(`/month?cycleStart=${sep}`);
    expect(m.body.state).toBe("CLOSED");
    expect(m.body.reason).toMatch(/not finalised/i);
    const refused = await enter([{ employeeId: id("a"), head: incentive, amount: "1" }], maker(), sep);
    expect([refused.status, refused.body.error.code]).toEqual([409, "MONTH_CLOSED"]);
    expect(await prisma.payrollMonthlyInput.count({ where: { cycleStart: new Date(`${sep}T00:00:00Z`), employeeId: id("a") } })).toBe(0);
    expect((await get(`/month?cycleStart=2026-08-15`)).status).toBe(400); // not the first day of a month
  });

  it("enters exact decimals; blank is not zero; a zero is entered; nothing is overwritten", async () => {
    const r = await enter([
      { employeeId: id("a"), head: incentive, amount: "1234.50" },
      { employeeId: id("a"), head: advance, amount: "0" },
      { employeeId: id("b"), head: incentive, amount: "0.000001" },
    ]);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await figure("a", incentive)).toBe("1234.5");
    expect(await figure("a", advance)).toBe("0"); // zero is entered
    expect(await figure("b", incentive)).toBe("0.000001");
    expect(await figure("b", advance)).toBeNull(); // blank is nothing entered
    await enter([{ employeeId: id("a"), head: incentive, amount: "2000" }]);
    expect(await figure("a", incentive)).toBe("2000");
    const h = await get(`/history?cycleStart=${month}&employeeId=${id("a")}&head=${incentive}`);
    expect(h.body.entries.map((e: { amount: string }) => e.amount)).toEqual(["2000", "1234.5"]); // newest first, the old figure still there
    expect(h.body.entries[0].reason).toBe("Entered in the test");
  });

  it("clearing returns a cell to blank, and the clear is itself in the history", async () => {
    await enter([{ employeeId: id("c"), head: incentive, amount: "5" }]);
    await enter([{ employeeId: id("c"), head: incentive, amount: null }]);
    expect(await figure("c", incentive)).toBeNull();
    const h = await get(`/history?cycleStart=${month}&employeeId=${id("c")}`);
    expect(h.body.entries.map((e: { cleared: boolean }) => e.cleared)).toEqual([true, false]);
  });

  it("refuses bad input and saves nothing from a request with any bad entry", async () => {
    const before = await prisma.payrollMonthlyInput.count({ where: { enteredByUserId: w.maker.userId } });
    const cases: Array<[string, Array<{ employeeId: string; head: string; amount: string | null }>]> = [
      ["negative", [{ employeeId: id("a"), head: incentive, amount: "-1" }]],
      ["comma", [{ employeeId: id("a"), head: incentive, amount: "1,000" }]],
      ["not a head", [{ employeeId: id("a"), head: "NOT_A_HEAD", amount: "1" }]],
      ["a flagged-less head", [{ employeeId: id("a"), head: w.basic, amount: "1" }]],
      ["not employed", [{ employeeId: "nobody", head: incentive, amount: "1" }]],
      ["same cell twice", [{ employeeId: id("a"), head: incentive, amount: "1" }, { employeeId: id("a"), head: incentive, amount: "2" }]],
      ["one good one bad", [{ employeeId: id("b"), head: advance, amount: "9" }, { employeeId: id("a"), head: incentive, amount: "x" }]],
    ];
    for (const [name, entries] of cases) {
      const r = await enter(entries);
      expect(r.status, name).toBe(400);
    }
    expect((await post("/entries", { cycleStart: month, entries: [], reason: "x y z" })).status).toBe(400);
    expect((await post("/entries", { cycleStart: month, entries: [{ employeeId: id("a"), head: incentive, amount: "1" }], reason: "x" })).status).toBe(400); // a reason
    expect((await post("/entries", { cycleStart: month, entries: [{ employeeId: id("a"), head: incentive, amount: "1" }], reason: "fine", extra: 1 })).status).toBe(400);
    expect(await figure("b", advance)).toBeNull();
    expect(await prisma.payrollMonthlyInput.count({ where: { enteredByUserId: w.maker.userId } })).toBe(before);
  });

  it("the database holds it too: no change or delete, and only a Super Admin can write", async () => {
    const row = await prisma.payrollMonthlyInput.findFirstOrThrow({ where: { employeeId: id("a"), componentCode: incentive } });
    await expect(prisma.payrollMonthlyInput.update({ where: { id: row.id }, data: { reason: "changed" } })).rejects.toThrow(/MONTHLY_INPUTS_APPEND_ONLY/);
    await expect(prisma.payrollMonthlyInput.delete({ where: { id: row.id } })).rejects.toThrow(/MONTHLY_INPUTS_APPEND_ONLY/);
    const data = { employeeId: id("a"), componentCode: incentive, cycleStart: new Date(`${month}T00:00:00Z`), amount: "1", reason: "sneaky" };
    await expect(prisma.payrollMonthlyInput.create({ data: { ...data, enteredByUserId: w.outsider.userId } })).rejects.toThrow(/MONTHLY_INPUTS_DIRECTORS_ONLY/);
    await expect(prisma.payrollMonthlyInput.create({ data: { ...data, enteredByUserId: w.maker.userId, amount: "1", cleared: true } })).rejects.toThrow(/amount_check/); // a clear carries no amount (the sign of a figure is the pay head's choice now, held by the service: D-31)
    await expect(prisma.payrollMonthlyInput.create({ data: { ...data, enteredByUserId: w.maker.userId, amount: null, cleared: false } })).rejects.toThrow(/amount_check/);
  });

  it("the grid filters by employee, head, status and department; rows are people and columns are heads", async () => {
    const all = await get(`?cycleStart=${month}&pageSize=200`);
    expect(all.status).toBe(200);
    expect(all.body.rows.length).toBeGreaterThanOrEqual(3);
    const one = await get(`?cycleStart=${month}&employeeId=${id("a")}`);
    expect(one.body.rows).toHaveLength(1);
    expect(one.body.rows[0].cells.map((c: { head: string }) => c.head).sort()).toEqual([advance, incentive].sort());
    const byHead = await get(`?cycleStart=${month}&employeeId=${id("a")}&head=${advance}`);
    expect(byHead.body.rows[0].cells).toHaveLength(1);
    const changed = await get(`?cycleStart=${month}&status=CHANGED&pageSize=200`);
    expect(changed.body.rows.map((r: { employeeId: string }) => r.employeeId)).toContain(id("a")); // a's incentive was entered twice
    expect(changed.body.rows.map((r: { employeeId: string }) => r.employeeId)).not.toContain(id("b"));
    const notEntered = await get(`?cycleStart=${month}&status=NOT_ENTERED&pageSize=200`);
    expect(notEntered.body.rows.map((r: { employeeId: string }) => r.employeeId)).toEqual(expect.arrayContaining([id("b"), id("c")]));
    const placement = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId: id("a"), effectiveTo: null } });
    const dept = await get(`?cycleStart=${month}&departmentId=${placement.departmentId}&pageSize=200`);
    expect(dept.body.rows.every((r: { departmentId: string }) => r.departmentId === placement.departmentId)).toBe(true);
    expect(dept.body.rows.map((r: { employeeId: string }) => r.employeeId)).toContain(id("a"));
    const page = await get(`?cycleStart=${month}&pageSize=2&page=2`);
    expect(page.body.rows.length).toBeLessThanOrEqual(2);
    expect(page.body.total).toBe(all.body.total);
    expect((await get(`?cycleStart=${month}&pageSize=500`)).status).toBe(400);
  });

  it("the run refuses while a figure is missing, and names each employee and head", async () => {
    const created = await api(maker(), "post", "/runs", { cycleStart: month });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const preview = await api(maker(), "post", `/runs/${created.body.id}/calculate-preview`);
    expect([preview.status, preview.body.error.code]).toEqual([409, "MONTHLY_INPUTS_MISSING"]);
    expect(preview.body.error.message).toContain(`Advance ${w.prefix}`);
    expect(preview.body.error.message).toMatch(/not been confirmed/);
    const named = (preview.body.error.details.missing as Array<{ employeeId: string; head: string }>).map((m) => `${m.employeeId}|${m.head}`);
    expect(named).toContain(`${id("b")}|${advance}`);
    expect(named).toContain(`${id("c")}|${incentive}`);
    expect(named).not.toContain(`${id("a")}|${advance}`); // a's zero counts as entered
    const readiness = await api(maker(), "get", `/runs/readiness?cycleStart=${month}`);
    expect(readiness.body.monthlyInputs.missingCount).toBe(preview.body.error.details.missingCount);
    expect(readiness.body.monthlyInputs.notConfirmed).toBe(true);
    await api(maker(), "post", `/runs/${created.body.id}/void`, { reason: "test" });
  });

  it("blank cells are filled with explicit zeros by a director's one deliberate act, never over a figure; then the run still waits for the second director", async () => {
    const m = await get(`/month?cycleStart=${month}`);
    const bad = await post("/fill-blanks", { cycleStart: month, head: "NOT_A_HEAD", reason: "none this month" });
    expect(bad.status).toBe(400);
    expect((await post("/fill-blanks", { cycleStart: month, reason: "x" })).status).toBe(400);
    const onlyAdvance = await post("/fill-blanks", { cycleStart: month, head: advance, reason: "No advances this month" });
    expect(onlyAdvance.status, JSON.stringify(onlyAdvance.body)).toBe(201);
    expect(onlyAdvance.body.written).toBeGreaterThan(0);
    expect(await figure("a", advance)).toBe("0"); // was already 0 and is untouched: it had a figure
    expect(await figure("b", incentive)).toBe("0.000001"); // a figure already there is never overwritten
    const rest = await post("/fill-blanks", { cycleStart: month, reason: "Nothing else this month" });
    expect(rest.status).toBe(201);
    expect(onlyAdvance.body.written + rest.body.written).toBe(m.body.blank);
    expect((await post("/fill-blanks", { cycleStart: month, reason: "Again, nothing to do" })).body.written).toBe(0);
    const after = await get(`/month?cycleStart=${month}`);
    expect(after.body.blank).toBe(0);
    expect(after.body.confirmation.status).toBe("NONE");
    const created = await api(maker(), "post", "/runs", { cycleStart: month });
    const preview = await api(maker(), "post", `/runs/${created.body.id}/calculate-preview`);
    expect([preview.status, preview.body.error.code, preview.body.error.details.missingCount, preview.body.error.details.notConfirmed]).toEqual([409, "MONTHLY_INPUTS_MISSING", 0, true]);
    await api(maker(), "post", `/runs/${created.body.id}/void`, { reason: "test" });
  });

  it("a second director confirms exactly these figures; the maker cannot; any change voids it", async () => {
    const preview = await post("/confirm-preview", { cycleStart: month });
    expect(preview.body.mode).toBe("SECOND_DIRECTOR");
    expect(preview.body.warnings).toEqual([]);
    const stale = await post("/confirm", { cycleStart: month, fingerprint: "not-the-hash-you-saw-xxxxxxxx" });
    expect([stale.status, stale.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    const submitted = await post("/confirm", { cycleStart: month, fingerprint: preview.body.fingerprint });
    expect(submitted.status, JSON.stringify(submitted.body)).toBe(201);
    expect((await get(`/month?cycleStart=${month}`)).body.confirmation.status).toBe("PENDING");
    const own = await post(`/decision/${month}`, { decision: "APPROVE", fingerprint: preview.body.fingerprint });
    expect([own.status, own.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
    const reject = await post(`/decision/${month}`, { decision: "REJECT", fingerprint: preview.body.fingerprint, note: "x" }, w.tokens.checkerA);
    expect(reject.status).toBe(400); // a rejection needs its reason
    // A figure changes while it waits: the confirmation is void and the checker is told what they saw is gone.
    await enter([{ employeeId: id("b"), head: incentive, amount: "42" }]);
    expect((await get(`/month?cycleStart=${month}`)).body.confirmation.status).not.toBe("PENDING");
    const late = await post(`/decision/${month}`, { decision: "APPROVE", fingerprint: preview.body.fingerprint }, w.tokens.checkerA);
    expect(late.status).toBe(409);
    // Submit again, and the director who changed the figures cannot be the one who approves them.
    const again = await post("/confirm-preview", { cycleStart: month }, w.tokens.checkerB);
    const resubmitted = await post("/confirm", { cycleStart: month, fingerprint: again.body.fingerprint }, w.tokens.checkerB);
    expect(resubmitted.status, JSON.stringify(resubmitted.body)).toBe(201);
    const approved = await post(`/decision/${month}`, { decision: "APPROVE", fingerprint: again.body.fingerprint }, w.tokens.checkerA);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const m = await get(`/month?cycleStart=${month}`);
    expect([m.body.state, m.body.confirmation.status]).toEqual(["CONFIRMED", "CONFIRMED"]);
    expect(m.body.confirmation.checkerName).toBeTruthy();
  });

  it("a confirmation holds only for the figures it saw, even if a figure is changed behind the service's back", async () => {
    const direct = (amount: string) => prisma.payrollMonthlyInput.create({ data: { employeeId: id("c"), componentCode: incentive, cycleStart: new Date(`${month}T00:00:00Z`), amount, reason: "direct write in the test", enteredByUserId: w.maker.userId } });
    await direct("13"); // the approval row is untouched (nothing voided it), but the figures are no longer the ones it approved
    const moved = await get(`/month?cycleStart=${month}`);
    expect([moved.body.state, moved.body.confirmation.status]).toEqual(["OPEN", "OUT_OF_DATE"]);
    const created = await api(maker(), "post", "/runs", { cycleStart: month });
    const refused = await api(maker(), "post", `/runs/${created.body.id}/calculate-preview`);
    expect([refused.status, refused.body.error.code, refused.body.error.details.notConfirmed]).toEqual([409, "MONTHLY_INPUTS_MISSING", true]);
    await api(maker(), "post", `/runs/${created.body.id}/void`, { reason: "test" });
    await direct("0"); // back to exactly what was approved
    expect((await get(`/month?cycleStart=${month}`)).body.confirmation.status).toBe("CONFIRMED");
  });

  it("the run then calculates, with each figure as a line of its own; the calculation itself is unchanged", async () => {
    const runId = await calculateRun(w);
    const item = await api(maker(), "get", `/runs/${runId}/items/${id("a")}`);
    const lines = item.body.lines as Array<{ code: string; kind: string; source: string; amount: string }>;
    const inc = lines.find((l) => l.code === incentive)!;
    const adv = lines.find((l) => l.code === advance);
    expect([inc.kind, inc.source, inc.amount]).toEqual(["EARNING", "MONTHLY_INPUT", "2000"]);
    expect(adv).toBeUndefined(); // a zero was entered (so the run may go ahead) but pays and takes nothing: no line is printed
    const itemB = (await api(maker(), "get", `/runs/${runId}/items/${id("b")}`)).body.lines as Array<{ code: string; amount: string }>;
    expect(itemB.find((l) => l.code === incentive)!.amount).toBe("42");
    // Entering a deduction for b turns into a DEDUCTION line, and a change voids the confirmation so the run waits again.
    await enter([{ employeeId: id("b"), head: advance, amount: "300.25" }]);
    const stillMonth = await get(`/month?cycleStart=${month}`);
    expect(stillMonth.body.state).toBe("OPEN");
    const preview = await api(maker(), "post", `/runs/${runId}/calculate-preview`);
    expect([preview.status, preview.body.error.code]).toEqual([409, "MONTHLY_INPUTS_MISSING"]);
    const done = await confirmAs(w.tokens.checkerB, w.tokens.checkerA);
    expect(done.decided?.status, JSON.stringify(done.decided?.body)).toBe(200);
    await calculateAgain(w, runId);
    const lines2 = (await api(maker(), "get", `/runs/${runId}/items/${id("b")}`)).body.lines as Array<{ code: string; kind: string; amount: string; source: string }>;
    const adv2 = lines2.find((l) => l.code === advance)!;
    expect([adv2.kind, adv2.amount, adv2.source]).toEqual(["DEDUCTION", "300.25", "MONTHLY_INPUT"]);
    const why = await api(maker(), "get", `/runs/${runId}/items/${id("b")}`);
    expect(why.status).toBe(200);
    // The month is locked once a run is approved or final.
    await handFinalise(runId, w.maker.userId, w.checkerA.userId);
    const locked = await get(`/month?cycleStart=${month}`);
    expect(locked.body.state).toBe("LOCKED");
    const refused = await enter([{ employeeId: id("a"), head: incentive, amount: "1" }]);
    expect([refused.status, refused.body.error.code]).toEqual([409, "MONTH_LOCKED"]);
    expect((await post("/confirm-preview", { cycleStart: month })).status).toBe(200); // looking is allowed
    const request_ = await post("/confirm", { cycleStart: month, fingerprint: (await post("/confirm-preview", { cycleStart: month })).body.fingerprint });
    expect([request_.status, request_.body.error.code]).toEqual([409, "MONTH_LOCKED"]);
  });

  it("directors only: HR, the employee, the Developer and a manager-less outsider are refused on every route", async () => {
    const tokens = { hr: w.tokens.outsider, employee: await loginAs(w.named.a!.employeeCode), developer: await loginAs(dev.employeeCode) };
    const routes: Array<[("get" | "post"), string, object?]> = [
      ["get", "/months"],
      ["get", `/month?cycleStart=${month}`],
      ["get", `/history?cycleStart=${month}`],
      ["post", "/entries", { cycleStart: month, entries: [{ employeeId: id("a"), head: incentive, amount: "1" }], reason: "nope" }],
      ["post", "/fill-blanks", { cycleStart: month, reason: "nope" }],
      ["post", "/confirm-preview", { cycleStart: month }],
      ["post", "/confirm", { cycleStart: month, fingerprint: "0123456789" }],
      ["post", `/decision/${month}`, { decision: "APPROVE", fingerprint: "0123456789" }],
      ["get", "/import/template"],
      ["get", "/import"],
      ["post", "/import", {}],
      ["get", "/import/someid"],
      ["post", "/import/someid/apply", { fingerprint: "0123456789", skipInvalid: false, reason: "nope" }],
      ["post", "/import/someid/discard", {}],
      ["get", `?cycleStart=${month}`],
    ];
    for (const [who, token] of Object.entries(tokens)) {
      for (const [method, path, body] of routes) {
        const r = method === "get" ? await get(path, token) : await post(path, body ?? {}, token);
        expect(r.status, `${who} ${method} ${path}`).toBe(403);
      }
    }
    // Nobody at all.
    expect((await request(app).get(`/api/payroll/monthly-inputs?cycleStart=${month}`)).status).toBe(401);
  });

  it("with the step set to the acting director alone, one director confirms it and the other is told; with it Not set, the request refuses", async () => {
    // The month above is locked, so this uses the preview (what the screen shows) and a direct service call on the choice.
    await setDirectorChoices({ MONTHLY_INPUTS: "DIRECTOR_AUTHORITY" });
    const alone = await post("/confirm-preview", { cycleStart: month });
    expect(alone.body.mode).toBe("DIRECTOR_AUTHORITY");
    expect(alone.body.checkers.state).toBe("SELF");
    await setDirectorChoices({});
    const unset = await post("/confirm-preview", { cycleStart: month });
    expect(unset.body.mode).toBe("NOT_SET");
    await useSecondDirectorChecks(); // back to the world's setting
  });
});
