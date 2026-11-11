import fc from "fast-check";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { netOf } from "../offcycle/service";
import { settlementTotals } from "../settlements/service";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { setDirectorChoices } from "./payrollTestHelpers";
import { Frac } from "./rational";
import { CYCLE, api, calculateRun, day, setRules } from "./runTestHelpers";

// P7-6b (docs/plans/P7_6_SETTLEMENTS.md): off-cycle runs pay a confirmed settlement or held pay, on the same road as a regular run. Made-up people and figures only.

// The Ready-for-first-run list decides whether the real company may pay. The test database is never "ready", so the tests that walk the road switch it on here;
// one test leaves it as the database says (red) and proves the real company is refused. The demo switch is the same idea.
const seam = vi.hoisted(() => ({ ready: false, demo: false }));
vi.mock("../setup/status", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../setup/status")>();
  return {
    ...actual,
    isDemoCompany: async () => (seam.demo ? true : actual.isDemoCompany()),
    readinessOf: (report: Parameters<typeof actual.readinessOf>[0]) => (seam.ready ? { ...actual.readinessOf(report), ready: true, blockers: [] } : actual.readinessOf(report)),
  };
});

const LAYOUT = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  amountDecimals: 2,
  header: [[{ source: "CONSTANT", value: "ZZHDR9917" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
  columns: [{ source: "FIELD", value: "SERIAL" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "ACCOUNT_NUMBER" }, { source: "FIELD", value: "IFSC" }, { source: "FIELD", value: "AMOUNT" }, { source: "FIELD", value: "NARRATION" }],
  narrationPattern: "Pay {PERIOD}",
};
const paise = (s: string) => {
  const neg = s.startsWith("-");
  const [w, f = ""] = (neg ? s.slice(1) : s).split(".");
  const v = BigInt(w!) * 100n + BigInt((f + "00").slice(0, 2));
  return neg ? -v : v;
};

describe("P7-6b — the arithmetic, against an exact-fraction model", () => {
  const amount = fc.tuple(fc.boolean(), fc.bigInt({ min: 0n, max: 99_999_999_99n })).map(([neg, p]) => `${neg && p > 0n ? "-" : ""}${p / 100n}.${String(p % 100n).padStart(2, "0")}`);
  it("a settlement's total and an off-cycle run's net are the exact sum of the signed lines; days-only lines count for nothing; paid only when positive", () => {
    fc.assert(
      fc.property(fc.array(fc.option(amount, { nil: null }), { maxLength: 30 }), (amounts) => {
        const lines = amounts.map((a) => ({ amount: a }));
        const model = amounts.reduce((s, a) => (a === null ? s : s.plus(Frac.of(a))), new Frac(0n));
        const t = settlementTotals(lines);
        expect(Frac.of(t.total.toFixed(2)).cmp(model)).toBe(0);
        expect(t.payable).toBe(model.cmp(new Frac(0n)) > 0);
        if (model.cmp(new Frac(0n)) < 0) expect(Frac.of(t.recoverOutsidePayroll!.toFixed(2)).cmp(new Frac(0n).minus(model))).toBe(0);
        else expect(t.recoverOutsidePayroll).toBeNull();
        const money = lines.filter((l): l is { amount: string } => l.amount !== null);
        expect(Frac.of(netOf(money).toFixed(2)).cmp(model)).toBe(0);
      }),
      { numRuns: 400 },
    );
  });
});

describe("P7-6b — off-cycle runs over the routes", () => {
  let world: Closing;
  let runId = "";
  let hr: { employeeId: string; userId: string; employeeCode: string };
  let dev: { employeeId: string; userId: string; employeeCode: string };
  let tokens: { hr: string; dev: string; employee: string };
  let heldItemId = "";
  let heldNet = "";
  let snapshot: Array<{ employeeId: string; status: string; netPay: string; gross: string }> = [];
  const who = (n: string) => world.named[n]!.employeeId;
  const oc = (token: string, method: "get" | "post", path: string, body?: object) => request(app)[method](`/api/offcycle${path}`).set(...authHeader(token)).send(body);
  const p = (token: string, path: string, body: object = {}) => request(app).post(`/api/payroll${path}`).set(...authHeader(token)).send(body);
  const putLayout = async (value: object) => {
    const pre = await p(world.tokens.maker, "/layouts/BANK_TEMPLATE/save-preview", { value });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    const r = await request(app).put("/api/payroll/layouts/BANK_TEMPLATE").set(...authHeader(world.tokens.maker)).send({ value, fingerprint: pre.body.fingerprint });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const cp = await p(world.tokens.checkerA, "/layouts/BANK_TEMPLATE/confirm-preview");
    expect((await p(world.tokens.checkerA, "/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "checked against the bank's specification", fingerprint: cp.body.fingerprint })).status).toBe(200);
  };
  const paymentDate = "2099-01-15"; // always in the future

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    const hold = await p(world.tokens.maker, "/holds", { input: { employeeId: who("b"), cycleStart: CYCLE.start, reason: "Documents pending" } });
    expect(hold.status, JSON.stringify(hold.body)).toBe(201);
    runId = await calculateRun(world);
    snapshot = (await prisma.payrollRunItem.findMany({ where: { runId }, orderBy: { employeeId: "asc" } })).map((i) => ({ employeeId: i.employeeId, status: i.status, netPay: i.netPay.toString(), gross: i.gross.toString() }));
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    const item = await prisma.payrollRunItem.findFirstOrThrow({ where: { runId, employeeId: who("b") } });
    expect([item.status, item.holdReason]).toEqual(["HELD", "DIRECTOR_HOLD"]);
    heldItemId = item.id;
    heldNet = item.netPay.toString();
    await putLayout(LAYOUT);
    hr = await createFullTestEmployee(world.org, { roleCode: "HR_ADMIN" });
    dev = await createFullTestEmployee(world.org, { roleCode: DEVELOPER_ROLE_CODE });
    world.userIds.push(hr.userId, dev.userId);
    tokens = { hr: await loginAs(hr.employeeCode), dev: await loginAs(dev.employeeCode), employee: await loginAs(world.named.b!.employeeCode) };
  }, 900_000);

  afterAll(async () => {
    seam.ready = false;
    seam.demo = false;
    resetSeams();
    for (const x of [hr, dev]) if (x) await cleanupFullTestEmployee(x.employeeId);
    await closeWorld(world);
  }, 300_000);

  it("HR, the Developer role and an employee (even for their own held pay) are refused every route; no sign-in is refused", async () => {
    for (const [name, token] of Object.entries(tokens)) {
      const routes: Array<[string, () => request.Test]> = [
        ["list", () => oc(token, "get", "")],
        ["candidates", () => oc(token, "get", "/candidates")],
        ["prepare", () => oc(token, "post", "", { kind: "HELD_PAY", sourceRef: heldItemId, paymentDate })],
        ["approval", () => oc(token, "post", "/x/approval", { fingerprint: "0".repeat(64) })],
        ["decision", () => oc(token, "post", "/x/decision", { fingerprint: "0".repeat(64), decision: "APPROVE" })],
        ["finalise", () => oc(token, "post", "/x/finalise")],
        ["bank approval", () => oc(token, "post", "/x/bank/approval", { fingerprint: "0".repeat(64) })],
        ["bank decision", () => oc(token, "post", "/x/bank/decision", { fingerprint: "0".repeat(64), decision: "APPROVE" })],
        ["bank file", () => oc(token, "post", "/x/bank/file")],
        ["download", () => oc(token, "get", "/bank/x/download")],
        ["sent", () => oc(token, "post", "/bank/x/sent")],
      ];
      for (const [label, call] of routes) expect((await call()).status, `${name} ${label}`).toBe(403);
    }
    expect((await request(app).get("/api/offcycle")).status).toBe(401);
  });

  it("the real company is refused while the Ready-for-first-run list has a blocker", async () => {
    seam.ready = false;
    const r = await oc(world.tokens.maker, "post", "", { kind: "HELD_PAY", sourceRef: heldItemId, paymentDate });
    expect([r.status, r.body.error.code]).toEqual([409, "NOT_READY"]);
    expect(await prisma.offCycleRun.count({ where: { sourceRef: heldItemId } })).toBe(0);
  });

  let offId = "";
  it("held pay: the candidate is listed, prepared for its exact net, never in the past, never for oneself; an unchosen run-approval step refuses", async () => {
    seam.ready = true;
    const cands = (await oc(world.tokens.maker, "get", "/candidates")).body.candidates as Array<{ kind: string; sourceRef: string; amount: string }>;
    expect(cands.find((c) => c.sourceRef === heldItemId)).toMatchObject({ kind: "HELD_PAY" });
    expect(paise(cands.find((c) => c.sourceRef === heldItemId)!.amount)).toBe(paise(heldNet));
    expect((await oc(world.tokens.maker, "post", "", { kind: "HELD_PAY", sourceRef: heldItemId, paymentDate: "2000-01-01" })).status).toBe(400);
    expect((await oc(world.tokens.maker, "post", "", { kind: "HELD_PAY", sourceRef: "no-such-item", paymentDate })).body.error.code).toBe("NOT_PAYABLE");
    const made = await oc(world.tokens.maker, "post", "", { kind: "HELD_PAY", sourceRef: heldItemId, paymentDate });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    offId = made.body.id;
    expect(paise(made.body.net)).toBe(paise(heldNet));
    expect(made.body.state).toBe("PREPARED");
    await expect(prisma.offCycleRun.update({ where: { id: offId }, data: { net: "1" } })).rejects.toThrow(/OFF_CYCLE_IMMUTABLE/);
    // An unchosen step refuses (the owners' choice has no default).
    await setDirectorChoices({});
    expect((await oc(world.tokens.maker, "post", `/${offId}/approval`, { fingerprint: made.body.fingerprint })).body.error.code).toBe("DIRECTOR_CHOICE_NOT_SET");
    await setDirectorChoices({ RUN_APPROVAL: "SECOND_DIRECTOR", BANK_FILE: "SECOND_DIRECTOR" });
  });

  it("a different director approves; the approver does not finalise; the preparer finalises once; the same source is never paid twice", async () => {
    const view = (await oc(world.tokens.maker, "get", "")).body.runs.find((r: { id: string }) => r.id === offId);
    expect((await oc(world.tokens.maker, "post", `/${offId}/approval`, { fingerprint: "f".repeat(64) })).body.error.code).toBe("PREVIEW_STALE");
    expect((await oc(world.tokens.maker, "post", `/${offId}/approval`, { fingerprint: view.fingerprint })).status).toBe(200);
    expect((await oc(world.tokens.maker, "post", `/${offId}/finalise`)).body.error.code).toBe("APPROVAL_REQUIRED");
    expect((await oc(world.tokens.maker, "post", `/${offId}/decision`, { fingerprint: view.fingerprint, decision: "APPROVE" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await oc(world.tokens.checkerA, "post", `/${offId}/decision`, { fingerprint: view.fingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await oc(world.tokens.checkerA, "post", `/${offId}/finalise`)).body.error.code).toBe("CHECKER_IS_EXECUTOR");
    // A second run for the same held pay may be prepared while the first is not final, but only one of them can ever be finalised.
    const twin = await oc(world.tokens.checkerB, "post", "", { kind: "HELD_PAY", sourceRef: heldItemId, paymentDate });
    expect(twin.status).toBe(201);
    const done = await oc(world.tokens.maker, "post", `/${offId}/finalise`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.state).toBe("FINALISED");
    expect(await prisma.offCycleHeldRelease.count({ where: { itemId: heldItemId } })).toBe(1);
    // Finalising again, preparing again, paying the twin, releasing the hold and unlocking the period are all refused.
    expect((await oc(world.tokens.maker, "post", `/${offId}/finalise`)).status).toBe(409);
    expect((await oc(world.tokens.maker, "post", "", { kind: "HELD_PAY", sourceRef: heldItemId, paymentDate })).body.error.code).toBe("NOT_PAYABLE");
    const twinView = (await oc(world.tokens.checkerB, "get", "")).body.runs.find((r: { id: string }) => r.id === twin.body.id);
    expect((await oc(world.tokens.checkerB, "post", `/${twin.body.id}/approval`, { fingerprint: twinView.fingerprint })).status).toBe(200);
    expect((await oc(world.tokens.checkerA, "post", `/${twin.body.id}/decision`, { fingerprint: twinView.fingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await oc(world.tokens.checkerB, "post", `/${twin.body.id}/finalise`)).status).toBe(409);
    expect(await prisma.offCycleHeldRelease.count({ where: { itemId: heldItemId } })).toBe(1);
    expect((await oc(world.tokens.maker, "get", "/candidates")).body.candidates.some((c: { sourceRef: string }) => c.sourceRef === heldItemId)).toBe(false);
    const holdRow = await prisma.payrollSalaryHold.findFirstOrThrow({ where: { employeeId: who("b"), cycleStart: day(CYCLE.start) } });
    expect((await p(world.tokens.maker, `/holds/${holdRow.id}/release`, { input: { note: "Documents received" } })).body.error.code).toBe("ALREADY_PAID");
    const unlock = await api(world.tokens.maker, "post", `/runs/${runId}/approvals/unlock/preview`);
    expect(unlock.body.canRequest).toBe(false);
    expect(unlock.body.blockers.map((b: { code: string }) => b.code)).toContain("RUN_RELEASED");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/unlock`)).status).toBe(409);
    expect((await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } })).status).toBe("FINALISED");
  });

  it("the database is what refuses a second payment: the unique keys hold, and without them a duplicate would get in (mutation check)", async () => {
    const fin = await prisma.offCycleFinalisation.findFirstOrThrow({ where: { runId: offId } });
    const twin = await prisma.offCycleRun.findFirstOrThrow({ where: { sourceRef: heldItemId, id: { not: offId } } });
    await expect(prisma.offCycleFinalisation.create({ data: { runId: twin.id, kind: "HELD_PAY", sourceRef: heldItemId, statement: {}, finalisedByUserId: world.maker.userId } })).rejects.toThrow(/Unique constraint/);
    await expect(prisma.offCycleHeldRelease.create({ data: { itemId: heldItemId, runId: twin.id } })).rejects.toThrow(/Unique constraint/);
    await expect(prisma.offCycleFinalisation.update({ where: { id: fin.id }, data: { statement: {} } })).rejects.toThrow(/OFF_CYCLE_IMMUTABLE/);
    // The mutant: drop the unique keys inside a transaction that is rolled back, and the same inserts succeed. So the keys, not luck, keep it to one.
    const MUTANT = new Error("rolled back on purpose");
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`DROP INDEX "off_cycle_finalisations_kind_source_ref_key"`);
        await tx.$executeRawUnsafe(`DROP INDEX "off_cycle_held_releases_item_id_key"`);
        await tx.offCycleFinalisation.create({ data: { runId: twin.id, kind: "HELD_PAY", sourceRef: heldItemId, statement: {}, finalisedByUserId: world.maker.userId } });
        await tx.offCycleHeldRelease.create({ data: { itemId: heldItemId, runId: twin.id } });
        expect(await tx.offCycleHeldRelease.count({ where: { itemId: heldItemId } })).toBe(2);
        throw MUTANT;
      }),
    ).rejects.toBe(MUTANT);
    expect(await prisma.offCycleHeldRelease.count({ where: { itemId: heldItemId } })).toBe(1);
  });

  it("the regular run is untouched: its figures are what they were when it was calculated", async () => {
    const now = (await prisma.payrollRunItem.findMany({ where: { runId }, orderBy: { employeeId: "asc" } })).map((i) => ({ employeeId: i.employeeId, status: i.status, netPay: i.netPay.toString(), gross: i.gross.toString() }));
    expect(now).toEqual(snapshot);
  });

  it("the bank file: the same second-director choice, a non-approver writes it, the real company's is never named DEMO, written once, sent once after a download", async () => {
    const v = (await oc(world.tokens.maker, "get", "")).body.runs.find((r: { id: string }) => r.id === offId);
    expect((await oc(world.tokens.maker, "post", `/${offId}/bank/file`)).body.error.code).toBe("APPROVAL_REQUIRED");
    expect((await oc(world.tokens.maker, "post", `/${offId}/bank/approval`, { fingerprint: v.bankFingerprint })).status).toBe(200);
    expect((await oc(world.tokens.maker, "post", `/${offId}/bank/decision`, { fingerprint: v.bankFingerprint, decision: "APPROVE" })).body.error.code).toBe("CHECKER_IS_MAKER");
    expect((await oc(world.tokens.checkerB, "post", `/${offId}/bank/decision`, { fingerprint: v.bankFingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await oc(world.tokens.checkerB, "post", `/${offId}/bank/file`)).body.error.code).toBe("CHECKER_IS_EXECUTOR");
    const file = await oc(world.tokens.maker, "post", `/${offId}/bank/file`);
    expect(file.status, JSON.stringify(file.body)).toBe(201);
    expect(file.body.fileName).not.toMatch(/DEMO/);
    const batch = await prisma.offCycleBankBatch.findUniqueOrThrow({ where: { runId: offId } });
    expect(paise(batch.amount.toString())).toBe(paise(heldNet));
    expect((await oc(world.tokens.maker, "post", `/${offId}/bank/file`)).status).toBe(409);
    expect((await oc(world.tokens.maker, "post", `/bank/${batch.id}/sent`)).body.error.code).toBe("NOT_DOWNLOADED");
    expect((await oc(world.tokens.maker, "get", `/bank/${batch.id}/download`)).status).toBe(200);
    expect((await oc(world.tokens.maker, "post", `/bank/${batch.id}/sent`)).status).toBe(200);
    expect((await oc(world.tokens.maker, "post", `/bank/${batch.id}/sent`)).body.error.code).toBe("ALREADY_SENT");
    await expect(prisma.offCycleBankBatch.update({ where: { id: batch.id }, data: { amount: "1" } })).rejects.toThrow(/OFF_CYCLE_IMMUTABLE/);
  });

  it("a settlement: paid once, its pending adjustment marked paid by the off-cycle run (so no regular run pays it), and the demo company's file is DEMO only from a DEMO layout", async () => {
    const c = who("c");
    const sep = await prisma.separation.create({ data: { employeeId: c, lastWorkingDate: day(CYCLE.end), reason: "test", initiatedByUserId: hr.userId } });
    const adj = await prisma.payrollAdjustment.create({ data: { employeeId: c, componentCode: "TEST_ANY", direction: "EARNING", amount: "1234.56", reason: "made-up arrears", source: "MANUAL", sourceRef: `offcycle-test-${c}`, createdByUserId: world.maker.userId } });
    const s = await request(app).post("/api/settlements").set(...authHeader(world.tokens.maker)).send({ separationId: sep.id, directorLines: [{ label: "Notice recovery", amount: "-200.10", source: "made-up: the notice shortfall" }] });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect((await request(app).post(`/api/settlements/${s.body.id}/confirm`).set(...authHeader(world.tokens.maker)).send({ fingerprint: s.body.fingerprint })).status).toBe(200);
    // Not confirmed yet: refused.
    expect((await oc(world.tokens.maker, "post", "", { kind: "SETTLEMENT", sourceRef: s.body.id, paymentDate })).body.error.code).toBe("SETTLEMENT_NOT_CONFIRMED");
    expect((await request(app).post(`/api/settlements/${s.body.id}/decision`).set(...authHeader(world.tokens.checkerA)).send({ fingerprint: s.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    seam.demo = true;
    const made = await oc(world.tokens.maker, "post", "", { kind: "SETTLEMENT", sourceRef: s.body.id, paymentDate });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    expect(paise(made.body.net)).toBe(paise("1234.56") - paise("200.10"));
    expect((await oc(world.tokens.maker, "post", `/${made.body.id}/approval`, { fingerprint: made.body.fingerprint })).status).toBe(200);
    expect((await oc(world.tokens.checkerA, "post", `/${made.body.id}/decision`, { fingerprint: made.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await oc(world.tokens.maker, "post", `/${made.body.id}/finalise`)).status).toBe(200);
    const paid = await prisma.payrollAdjustment.findUniqueOrThrow({ where: { id: adj.id } });
    expect([paid.status, paid.consumedByOffCycleRunId, paid.consumedByRunId]).toEqual(["CONSUMED", made.body.id, null]);
    const after = (await request(app).get("/api/settlements").set(...authHeader(world.tokens.maker))).body.separations.find((x: { separationId: string }) => x.separationId === sep.id).settlement;
    expect(after.state).toBe("PAID");
    expect((await request(app).post("/api/settlements").set(...authHeader(world.tokens.maker)).send({ separationId: sep.id, directorLines: [] })).body.error.code).toBe("ALREADY_PAID");
    // The demo company: no file from a layout that does not say DEMO.
    let v = (await oc(world.tokens.maker, "get", "")).body.runs.find((r: { id: string }) => r.id === made.body.id);
    expect((await oc(world.tokens.maker, "post", `/${made.body.id}/bank/approval`, { fingerprint: v.bankFingerprint })).status).toBe(200);
    expect((await oc(world.tokens.checkerB, "post", `/${made.body.id}/bank/decision`, { fingerprint: v.bankFingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await oc(world.tokens.maker, "post", `/${made.body.id}/bank/file`)).body.error.code).toBe("DEMO_LAYOUT_NOT_LABELLED");
    await putLayout({ ...LAYOUT, header: [[{ source: "CONSTANT", value: "DEMO" }, ...LAYOUT.header[0]!.slice(1)]] });
    expect((await oc(world.tokens.maker, "post", `/${made.body.id}/bank/file`)).body.error.code).toBe("APPROVAL_VOIDED"); // the layout changed after the approval
    v = (await oc(world.tokens.maker, "get", "")).body.runs.find((r: { id: string }) => r.id === made.body.id);
    { const r = await oc(world.tokens.maker, "post", `/${made.body.id}/bank/approval`, { fingerprint: v.bankFingerprint }); expect(r.status, JSON.stringify(r.body)).toBe(200); }
    expect((await oc(world.tokens.checkerB, "post", `/${made.body.id}/bank/decision`, { fingerprint: v.bankFingerprint, decision: "APPROVE" })).status).toBe(200);
    const file = await oc(world.tokens.maker, "post", `/${made.body.id}/bank/file`);
    expect(file.status, JSON.stringify(file.body)).toBe(201);
    expect(file.body.fileName).toMatch(/^DEMO-/);
    seam.demo = false;
  });

  it("nobody prepares, asks for or decides an off-cycle run for their own pay", async () => {
    const own = await prisma.separation.create({ data: { employeeId: world.checkerB.employeeId, lastWorkingDate: day(CYCLE.end), reason: "test", initiatedByUserId: hr.userId } });
    const s = await request(app).post("/api/settlements").set(...authHeader(world.tokens.maker)).send({ separationId: own.id, directorLines: [{ label: "Gratuity", amount: "10.00", source: "made-up figure" }] });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    expect((await request(app).post(`/api/settlements/${s.body.id}/confirm`).set(...authHeader(world.tokens.maker)).send({ fingerprint: s.body.fingerprint })).status).toBe(200);
    expect((await request(app).post(`/api/settlements/${s.body.id}/decision`).set(...authHeader(world.tokens.checkerA)).send({ fingerprint: s.body.fingerprint, decision: "APPROVE" })).status).toBe(200);
    expect((await oc(world.tokens.checkerB, "post", "", { kind: "SETTLEMENT", sourceRef: s.body.id, paymentDate })).body.error.code).toBe("OWN_PAY");
    const made = await oc(world.tokens.maker, "post", "", { kind: "SETTLEMENT", sourceRef: s.body.id, paymentDate });
    expect(made.status).toBe(201);
    expect((await oc(world.tokens.checkerB, "post", `/${made.body.id}/approval`, { fingerprint: made.body.fingerprint })).body.error.code).toBe("OWN_PAY");
    expect((await oc(world.tokens.maker, "post", `/${made.body.id}/approval`, { fingerprint: made.body.fingerprint })).status).toBe(200);
    expect((await oc(world.tokens.checkerB, "post", `/${made.body.id}/decision`, { fingerprint: made.body.fingerprint, decision: "APPROVE" })).body.error.code).toBe("OWN_PAY");
  });
});
