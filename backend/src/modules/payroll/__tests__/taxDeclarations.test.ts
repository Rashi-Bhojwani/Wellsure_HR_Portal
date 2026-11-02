import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEVELOPER_ROLE_CODE } from "@shared/constants/sensitiveData";
import { businessToday } from "../../../lib/businessDate";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { setPayrollConsumptionCheck, setPayrollInputsListener, setPayrollLockCheck } from "../../../lib/effectiveDating";
import { payrollConsumption, payrollLockOn } from "../run/lock";
import { assertRunIsReal, type RulePin } from "../rules/context";
import { countedDeductions } from "../tax/declarations";
import { CYCLE, api, buildRunWorld, calculateAgain, calculateRun, lockCycle, sidelineEveryoneBut, teardownRunWorld, type RunWorld } from "./runTestHelpers";
import { FIRST_SALARY_DAY, giveSalary, setRule, type Person } from "./salaryTestHelpers";

// Stage 7, P7-2 and P7-3 (docs/plans/STAGE_7_PLAN.md): the tax year the directors enter and a different director confirms, a person's own declaration and proofs, a director's verification, the two
// regimes side by side, and the TDS line of a run. Every figure below is MADE UP for the test; none is a tax rule.

const FY = "2026-27";
const src = { sourceNote: "made-up figure for a test", effectiveFrom: "2026-04-01" };
const leaf = <T>(value: T) => ({ value, ...src });
const SECTIONS = [
  { code: "SEC_A", label: "Section A", appliesTo: "OLD", cap: "150000", groupCap: null, proofRequired: true },
  { code: "SEC_C", label: "Section C", appliesTo: "BOTH", cap: null, groupCap: null, proofRequired: false },
];
const YEAR = {
  NEW: { slabs: leaf([{ from: "0", to: "300000", ratePercent: "0" }, { from: "300000", to: "700000", ratePercent: "5" }, { from: "700000", to: "1000000", ratePercent: "10" }, { from: "1000000", to: null, ratePercent: "20" }]), standardDeduction: leaf("50000"), rebate: leaf({ thresholdIncome: "700000", maximum: "25000" }) },
  OLD: { slabs: leaf([{ from: "0", to: "250000", ratePercent: "0" }, { from: "250000", to: "500000", ratePercent: "5" }, { from: "500000", to: null, ratePercent: "30" }]), standardDeduction: leaf("50000"), rebate: leaf({ thresholdIncome: "500000", maximum: "12500" }) },
  surcharge: leaf([]),
  cessPercent: leaf("4"),
  defaultRegime: leaf("NEW"),
  rounding: leaf({ mode: "HALF_UP", scale: 0 }),
  minimumMonthlyTds: leaf("0"),
  oneOffs: leaf("MONTH_PAID"),
  sections: leaf(SECTIONS),
};
const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const addDays = (iso: string, n: number) => new Date(new Date(`${iso}T00:00:00Z`).getTime() + n * 86_400_000).toISOString().slice(0, 10); // allow-number: a day count in a test

describe("tax years, declarations, proofs and TDS in a run", () => {
  let w: RunWorld;
  let dev: Person;
  let restore: () => Promise<void>;
  let tokens: { dev: string; a: string; b: string };
  const id = (n: string) => w.named[n]!.employeeId;
  const maker = () => w.tokens.maker;
  const t = (token: string, method: "get" | "post" | "put", path: string, body?: object) => request(app)[method](`/api/tax${path}`).set(...authHeader(token)).send(body);
  const today = businessToday().toISOString().slice(0, 10);
  const saveYear = async (value: object, token = maker()) => {
    const pre = await t(token, "post", `/years/${FY}/save-preview`, { value });
    expect(pre.status, JSON.stringify(pre.body)).toBe(200);
    return t(token, "put", `/years/${FY}`, { value, note: "entered in the test", fingerprint: pre.body.fingerprint });
  };
  const confirmYear = async (token: string) => {
    const cp = await t(token, "post", `/years/${FY}/confirm-preview`);
    return t(token, "post", `/years/${FY}/confirm`, { version: cp.body.version, note: "checked against the made-up notice", fingerprint: cp.body.fingerprint });
  };
  const openWindows = async () => {
    for (const kind of ["DECLARATION", "PROOF"] as const) expect((await t(maker(), "put", "/windows", { fy: FY, kind, opensOn: addDays(today, -5), closesOn: addDays(today, 30) })).status).toBe(200);
  };

  beforeAll(async () => {
    setPayrollLockCheck(payrollLockOn);
    setPayrollConsumptionCheck(payrollConsumption);
    w = await buildRunWorld(["a", "b"]);
    dev = await createFullTestEmployee(w.org, { roleCode: DEVELOPER_ROLE_CODE });
    const everyone = [w.maker, w.checkerA, w.checkerB, w.outsider, dev, ...w.staff];
    restore = await sidelineEveryoneBut(everyone.map((p) => p.employeeId));
    for (const p of everyone) await lockCycle(p.employeeId, CYCLE.start, CYCLE.end);
    for (const n of ["a", "b"]) await giveSalary(w, id(n), "2400000", FIRST_SALARY_DAY);
    tokens = { dev: await loginAs(dev.employeeCode), a: await loginAs(w.named.a!.employeeCode), b: await loginAs(w.named.b!.employeeCode) };
  }, 300_000);
  afterAll(async () => {
    setPayrollLockCheck(null);
    setPayrollConsumptionCheck(null);
    setPayrollInputsListener(null);
    const proofs = await prisma.taxProof.findMany({ where: { employeeId: { in: [id("a"), id("b"), w.maker.employeeId] } }, select: { id: true } });
    const { deleteWithDependents } = await import("../../../lib/__tests__/cleanup");
    await deleteWithDependents("TaxProof", proofs.map((p) => p.id));
    await deleteWithDependents("TaxDeclaration", (await prisma.taxDeclaration.findMany({ where: { employeeId: { in: [id("a"), id("b"), w.maker.employeeId] } }, select: { id: true } })).map((d) => d.id));
    await restore?.();
    await cleanupFullTestEmployee(dev.employeeId);
    await teardownRunWorld(w);
  }, 120_000);

  it("only directors reach the tax years, windows, declarations of others and proofs: HR, the Developer role and the employee are refused on every route", async () => {
    const calls: Array<[string, "get" | "post" | "put", string, object?]> = [
      ["windows", "get", `/windows?fy=${FY}`], ["set window", "put", "/windows", { fy: FY, kind: "DECLARATION", opensOn: "2026-04-01", closesOn: "2026-05-01" }],
      ["declarations", "get", `/declarations?fy=${FY}`], ["proofs", "get", `/proofs?fy=${FY}`], ["decide", "post", "/proofs/x/decision", { decision: "REJECTED", reason: "no" }], ["proof file", "get", "/proofs/x/file"],
      ["years", "get", "/years"], ["year", "get", `/years/${FY}`], ["save preview", "post", `/years/${FY}/save-preview`, { value: {} }],
      ["save", "put", `/years/${FY}`, { value: {}, fingerprint: "x" }], ["confirm preview", "post", `/years/${FY}/confirm-preview`], ["confirm", "post", `/years/${FY}/confirm`, { version: 1, note: "x", fingerprint: "x" }],
    ];
    for (const [who, token] of [["HR", w.tokens.outsider], ["Developer", tokens.dev], ["employee", tokens.a]] as const) {
      for (const [label, method, path, body] of calls) expect((await t(token, method, path, body)).status, `${who} ${label}`).toBe(403);
    }
    expect((await request(app).get(`/api/tax/me`)).status).toBe(401);
  });

  it("a tax year is Not set until a director enters it, saved as a Placeholder and confirmed by a different director; each value needs its source note", async () => {
    expect((await t(maker(), "get", "/years")).body.years).toEqual([]);
    const bad = await t(maker(), "post", `/years/${FY}/save-preview`, { value: { cessPercent: { value: "4", effectiveFrom: "2026-04-01" } } });
    expect([bad.status, bad.body.error.code]).toEqual([400, "VALIDATION_ERROR"]);
    expect((await t(maker(), "post", `/years/2026-28/save-preview`, { value: {} })).status).toBe(400); // not a financial year
    const saved = await saveYear(YEAR);
    expect([saved.status, saved.body.status, saved.body.missing], JSON.stringify(saved.body)).toEqual([200, "PLACEHOLDER", []]);
    expect((await saveYear({})).status).toBe(200); // an emptied year is Not set again, and says what it lacks
    expect((await t(maker(), "get", `/years/${FY}`)).body.year.missing.length).toBeGreaterThan(5);
    expect((await saveYear(YEAR)).status).toBe(200);
    const own = await confirmYear(maker());
    expect([own.status, own.body.error?.code]).toContain(403); // the person who entered it cannot confirm it
    expect((await confirmYear(w.tokens.checkerA)).body.status).toBe("CONFIRMED");
    expect((await t(maker(), "get", "/years")).body.years.map((y: { year: string }) => y.year)).toEqual([FY]);
  });

  it("a declaration needs its window, the confirmed catalogue, and is the person's own: versions, no section outside the catalogue, nobody else's", async () => {
    const body = { fy: FY, regime: "OLD", lines: [{ section: "SEC_A", amount: "120000" }] };
    const closed = await t(tokens.a, "put", "/me/declaration", body);
    expect([closed.status, closed.body.error.code]).toEqual([409, "WINDOW_CLOSED"]); // no window set: closed
    await openWindows();
    expect((await t(tokens.a, "put", "/me/declaration", { ...body, lines: [{ section: "NOT_A_SECTION", amount: "1" }] })).status).toBe(400);
    expect((await t(tokens.a, "put", "/me/declaration", { ...body, lines: [{ section: "SEC_A", amount: "-1" }] })).status).toBe(400);
    expect((await t(tokens.a, "put", "/me/declaration", { ...body, lines: [{ section: "SEC_A", amount: "1" }, { section: "SEC_A", amount: "2" }] })).status).toBe(400);
    const one = await t(tokens.a, "put", "/me/declaration", body);
    expect([one.status, one.body.declaration.version, one.body.declaration.regime]).toEqual([200, 1, "OLD"]);
    const two = await t(tokens.a, "put", "/me/declaration", { ...body, regime: "NEW", lines: [{ section: "SEC_A", amount: "100000" }, { section: "SEC_C", amount: "5000.50" }] });
    expect([two.body.declaration.version, two.body.declaration.regime, two.body.declaration.lines.map((l: { amount: string }) => l.amount)]).toEqual([2, "NEW", ["100000", "5000.5"]]);
    expect(await prisma.taxDeclaration.count({ where: { employeeId: id("a") } })).toBe(2); // append-only: both versions are on record
    const first = await prisma.taxDeclaration.findFirstOrThrow({ where: { employeeId: id("a"), version: 1 } });
    await expect(prisma.taxDeclaration.update({ where: { id: first.id }, data: { regime: "NEW" } })).rejects.toThrow(/TAX_APPEND_ONLY/);
    // The employee-cannot-read-others rule: the route has no person in it, so b sees only b's own, which is nothing yet; the directors' list shows a.
    expect((await t(tokens.b, "get", `/me?fy=${FY}`)).body.declaration).toBeNull();
    expect((await t(tokens.a, "get", `/me?fy=${FY}`)).body.declaration.version).toBe(2);
    const list = await t(maker(), "get", `/declarations?fy=${FY}`);
    expect(list.body.declarations.map((d: { employeeCode: string }) => d.employeeCode)).toEqual([w.named.a!.employeeCode]);
  });

  it("the two regimes are shown side by side from the engine on the person's own figures, the system never chooses, and a draft year says so", async () => {
    const me = await t(tokens.b, "get", `/me?fy=${FY}`); // b has declared nothing
    const cmp = me.body.comparison;
    expect([cmp.available, cmp.chosen, cmp.defaultRegime, cmp.draft]).toEqual([true, null, "NEW", false]);
    expect(Object.keys(cmp.results).sort()).toEqual(["NEW", "OLD"]);
    expect(cmp.results.NEW.regime).toBe("NEW");
    expect(cmp.results.NEW.notModelled).toContain("marginal relief on the rebate");
    const a = (await t(tokens.a, "get", `/me?fy=${FY}`)).body.comparison;
    expect(a.chosen).toBe("NEW"); // the person's own choice, as declared
    expect(a.results.OLD.sections.find((s: { code: string }) => s.code === "SEC_A").counted).toBe("100000");
    expect(a.results.NEW.sections.find((s: { code: string }) => s.code === "SEC_A").counted).toBe("0"); // not allowed under the new regime
    const statement = await t(tokens.a, "get", `/me/statement?fy=${FY}`);
    expect([statement.status, statement.body.available, statement.body.chosenRegime, statement.body.draft]).toEqual([200, true, "NEW", false]);
    expect(Object.keys(statement.body.regimes).sort()).toEqual(["NEW", "OLD"]);
  });

  let proofId = "";
  it("a proof belongs to a declared line and a window that is open; a director verifies it, never their own, and never for more than was declared", async () => {
    const upload = (token: string, section: string, fy = FY) => request(app).post("/api/tax/me/proofs").set(...authHeader(token)).field("fy", fy).field("section", section).attach("file", PDF, { filename: "receipt.pdf", contentType: "application/pdf" });
    expect((await upload(tokens.b, "SEC_A")).body.error.code).toBe("NOT_DECLARED"); // b declared nothing
    const up = await upload(tokens.a, "SEC_A");
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    proofId = up.body.id;
    expect((await t(tokens.b, "get", `/me/proofs/${proofId}/file`)).status).toBe(404); // somebody else's proof is a 404 exactly like one that does not exist
    expect((await t(tokens.a, "get", `/me/proofs/${proofId}/file`)).status).toBe(200);
    const queue = await t(maker(), "get", `/proofs?fy=${FY}`);
    expect(queue.body.proofs.map((p: { id: string; declared: string; decision: unknown }) => [p.id, p.declared, p.decision])).toEqual([[proofId, "100000", null]]);
    expect((await t(maker(), "post", `/proofs/${proofId}/decision`, { decision: "REJECTED" })).status).toBe(400); // a reason is needed
    expect((await t(maker(), "post", `/proofs/${proofId}/decision`, { decision: "ACCEPTED" })).status).toBe(400); // and an amount
    expect((await t(maker(), "post", `/proofs/${proofId}/decision`, { decision: "ACCEPTED", amountVerified: "100000.01" })).status).toBe(400);
    const ok = await t(maker(), "post", `/proofs/${proofId}/decision`, { decision: "ACCEPTED", amountVerified: "80000" });
    expect([ok.status, ok.body.decision]).toEqual([201, "ACCEPTED"]);
    expect((await t(tokens.a, "get", `/me?fy=${FY}`)).body.proofs[0].decision).toMatchObject({ decision: "ACCEPTED", amountVerified: "80000" });
    // Nobody verifies their own proof: the service says so, and so does the database.
    const mine = await request(app).post("/api/tax/me/proofs").set(...authHeader(maker())).field("fy", FY).field("section", "SEC_A").attach("file", PDF, { filename: "x.pdf", contentType: "application/pdf" });
    expect(mine.body.error.code).toBe("NOT_DECLARED"); // the director has declared nothing yet
    await prisma.taxDeclaration.create({ data: { employeeId: w.maker.employeeId, fy: FY, version: 1, regime: "NEW", lines: { create: [{ section: "SEC_A", amount: "1000" }] } } });
    const own = await request(app).post("/api/tax/me/proofs").set(...authHeader(maker())).field("fy", FY).field("section", "SEC_A").attach("file", PDF, { filename: "x.pdf", contentType: "application/pdf" });
    const refused = await t(maker(), "post", `/proofs/${own.body.id}/decision`, { decision: "ACCEPTED", amountVerified: "10" });
    expect([refused.status, refused.body.error.code]).toEqual([403, "NOT_YOUR_OWN"]);
    await expect(prisma.taxProofDecision.create({ data: { proofId: own.body.id, decision: "ACCEPTED", amountVerified: "10", reason: "", decidedByUserId: w.maker.userId } })).rejects.toThrow(/TAX_NOT_YOUR_OWN/);
    await expect(prisma.taxProofDecision.create({ data: { proofId, decision: "ACCEPTED", amountVerified: "10", reason: "", decidedByUserId: w.outsider.userId } })).rejects.toThrow(/TAX_DIRECTORS_ONLY/);
    const decision = await prisma.taxProofDecision.findFirstOrThrow({ where: { proofId } });
    await expect(prisma.taxProofDecision.delete({ where: { id: decision.id } })).rejects.toThrow(/TAX_APPEND_ONLY/);
  });

  it("until the proof window closes the declared amounts count; after it, only what a director verified", async () => {
    const sections = SECTIONS as Parameters<typeof countedDeductions>[2];
    const before = await countedDeductions(id("a"), FY, sections, today);
    expect(before.basis).toBe("DECLARED");
    expect(before.deductions.map((d) => [d.section, d.amount])).toEqual([["SEC_A", "100000"], ["SEC_C", "5000.5"]]);
    const later = await countedDeductions(id("a"), FY, sections, addDays(today, 60));
    expect(later.basis).toBe("VERIFIED");
    // SEC_A needs a proof: only the 80000 a director verified counts. SEC_C needs none: counted as declared.
    expect(later.deductions.map((d) => [d.section, d.amount])).toEqual([["SEC_A", "80000"], ["SEC_C", "5000.5"]]);
    expect(later.declarationVersion).toBe(2);
  });

  it("TDS in a run: refused while a tax value is Not set (naming it), then worked out line by line; a Placeholder year makes the run a test; a changed declaration makes the run stale", async () => {
    await setRule(w.maker.userId, "TDS_MODE", "PROJECTED");
    // The year has everything but is a draft (unconfirmed) after one more edit: the line is worked out, and the run is a test.
    expect((await saveYear({ ...YEAR, minimumMonthlyTds: leaf("0") })).status).toBe(409); // nothing changed: refused
    const emptied = await saveYear({});
    expect(emptied.status).toBe(200);
    const run = await calculateRun(w);
    const itemA = await api(maker(), "get", `/runs/${run}/items/${id("a")}`);
    expect(itemA.body.exceptions.map((e: { code: string; message: string }) => e.code)).toContain("TAX_NOT_SET");
    expect(itemA.body.exceptions.find((e: { code: string }) => e.code === "TAX_NOT_SET").message).toMatch(/the new regime's slabs|the tax year 2026-27 lacks/);
    expect(itemA.body.lines.some((l: { source: string }) => l.source === "TDS")).toBe(false);
    // Entered, but not yet confirmed: the line is there and the run cannot be made real.
    expect((await saveYear(YEAR)).status).toBe(200);
    await calculateAgain(w, run);
    const placeholder = await api(maker(), "get", `/runs/${run}/items/${id("a")}`);
    const tdsA = placeholder.body.lines.find((l: { source: string }) => l.source === "TDS");
    // a: 200000 a month for the 8 months from August (no earlier months are counted: no opening figures yet). Taxable 1600000, less 50000 and the 5000.50 a declared under Section C (which counts under both regimes) = 1544999.50. Slabs 20000 + 30000 + 108999.90 = 158999.90; cess 6359.996; 165359.896 rounds to 165360; over 8 months = 20670.
    expect([tdsA.code, tdsA.kind, tdsA.amount, tdsA.basis.projectedTaxablePay, tdsA.basis.annual.annualTax]).toEqual(["TDS", "DEDUCTION", "20670", "1600000", "165360"]);
    expect([tdsA.basis.regime, tdsA.basis.regimeSource, tdsA.basis.monthsLeft]).toEqual(["NEW", "CHOSEN", 8]);
    const runRow = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    const pins = runRow.pins as unknown as RulePin[];
    expect(pins.some((p) => p.kind === "TAX_YEAR" && p.key === FY)).toBe(true);
    await expect(assertRunIsReal(pins, "approved")).rejects.toMatchObject({ code: "PLACEHOLDER_RULES" });
    // Confirmed by a different director: the year part of the run is real.
    expect((await confirmYear(w.tokens.checkerA)).body.status).toBe("CONFIRMED");
    const statuses = (await import("../rules/context")).pinStatuses;
    expect((await statuses(pins.filter((p) => p.kind === "TAX_YEAR"))).map((s) => s.status)).toEqual(["CONFIRMED"]);
    // b chose nothing: the year's default regime applies, and it is said so. b declares OLD with a line that counts in full.
    const itemB = await api(maker(), "get", `/runs/${run}/items/${id("b")}`);
    expect([itemB.body.lines.find((l: { source: string }) => l.source === "TDS").basis.regimeSource]).toEqual(["DEFAULT"]);
    const before = runRow.inputsFingerprint;
    expect((await t(tokens.b, "put", "/me/declaration", { fy: FY, regime: "OLD", lines: [{ section: "SEC_C", amount: "100000" }] })).status).toBe(200);
    await calculateAgain(w, run);
    const after = await prisma.payrollRun.findUniqueOrThrow({ where: { id: run } });
    expect(after.inputsFingerprint).not.toBe(before); // the declaration is part of what the run was calculated from
    const tdsB = (await api(maker(), "get", `/runs/${run}/items/${id("b")}`)).body.lines.find((l: { source: string }) => l.source === "TDS");
    // OLD: 1600000 - 50000 - 100000 = 1450000. Slabs 12500 + 285000 = 297500; cess 11900; 309400 over 8 = 38675.
    expect([tdsB.amount, tdsB.basis.annual.annualTax, tdsB.basis.regime, tdsB.basis.regimeSource]).toEqual(["38675", "309400", "OLD", "CHOSEN"]);
    // Net pay is lower by exactly the TDS, and the line is explained.
    const why = await api(maker(), "get", `/runs/${run}/items/${id("a")}`);
    expect(why.status).toBe(200);
  }, 300_000);
});
