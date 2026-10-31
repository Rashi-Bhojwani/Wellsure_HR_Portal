import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader, cleanupFullTestEmployee, createFullTestEmployee, loginAs } from "../../employee/__tests__/employeeTestHelpers";
import { salaryHistory, salaryOn } from "../../../lib/effectiveDating";
import { saveStructure } from "../salary/structures";
import { FIRST_SALARY_DAY, REVISION_DAY, buildSalaryWorld, componentPin, makeComponent, makeStructure, setRule, teardownSalaryWorld, type SalaryWorld } from "./salaryTestHelpers";
import { cleanupPayrollRowsBy } from "./payrollTestHelpers";

// Components, structures and salary revisions, through the API as the screens use it: a maker prepares, a different person decides, the maker applies.

let w: SalaryWorld;
let firstRevisionId = "";
// A fingerprint that is certainly not this one (changing the last character to "0" is no change at all one time in sixteen).
const differentFingerprint = (f: string) => `${f.slice(0, -1)}${f.endsWith("0") ? "1" : "0"}`;
const api = (token: string) => ({
  get: (p: string) => request(app).get(`/api/payroll${p}`).set(...authHeader(token)),
  post: (p: string, b: object = {}) => request(app).post(`/api/payroll${p}`).set(...authHeader(token)).send(b),
  put: (p: string, b: object = {}) => request(app).put(`/api/payroll${p}`).set(...authHeader(token)).send(b),
});
const maker = () => api(w.tokens.maker);
const checkerA = () => api(w.tokens.checkerA);
const checkerB = () => api(w.tokens.checkerB);

const structureRef = () => ({ key: w.structure, version: 1 });
const joining = (employeeId: string, annual = "1200000", effectiveFrom = FIRST_SALARY_DAY) => ({
  selection: { kind: "EMPLOYEES", employeeIds: [employeeId] },
  change: { ctc: { mode: "SET", annual }, structure: structureRef() },
  effectiveFrom,
  note: "joining salary",
});

async function createRevision(token: string, input: object) {
  const a = api(token);
  const preview = await a.post("/salary/revisions/preview", { input });
  expect(preview.status, JSON.stringify(preview.body)).toBe(200);
  const created = await a.post("/salary/revisions", { input, fingerprint: preview.body.fingerprint });
  return { preview, created };
}
async function approve(token: string, id: string, decision: "APPROVE" | "REJECT" = "APPROVE", note = "looks right") {
  const detail = await api(token).get(`/salary/revisions/${id}`);
  return api(token).post(`/salary/revisions/${id}/decision`, { decision, note, fingerprint: detail.body.fingerprint });
}

beforeAll(async () => {
  w = await buildSalaryWorld();
});
afterAll(async () => {
  await teardownSalaryWorld(w);
});

describe("components", () => {
  it("are Placeholders until a different person confirms them, and editing one resets it but keeps the last Confirmed value in view", async () => {
    const list = await maker().get("/components");
    const basic = list.body.components.find((c: { code: string }) => c.code === w.basic);
    expect(basic).toMatchObject({ status: "CONFIRMED", sourceLabel: expect.stringMatching(/^Confirmed by /) });
    expect(basic.usedBy).toEqual([expect.objectContaining({ structure: w.structure, pinnedVersion: 1, behind: false })]);

    const value = { ...basic.value, taxable: false };
    const preview = await maker().post(`/components/${w.basic}/save-preview`, { value });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ willResetConfirmation: true, unchanged: false });
    expect(preview.body.impact).toMatch(/keep the version they pinned and nobody's pay moves/);
    const saved = await maker().put(`/components/${w.basic}`, { value, note: "taxability changed", fingerprint: preview.body.fingerprint });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ status: "PLACEHOLDER", current: { version: 2 }, lastConfirmed: { version: 1 } });
    expect(saved.body.usedBy[0]).toMatchObject({ pinnedVersion: 1, behind: true });

    // The author cannot confirm it, a different person can; a stale fingerprint is refused.
    const own = await maker().post(`/components/${w.basic}/confirm-preview`);
    expect([own.status, /You wrote this value/.test(String(own.body.blocked))]).toEqual([200, true]); // D1: a director holds both permissions, so they may look and are told why they cannot confirm their own
    const c = await checkerA().post(`/components/${w.basic}/confirm-preview`);
    expect(c.status).toBe(200);
    const stale = await checkerA().post(`/components/${w.basic}/confirm`, { version: 2, note: "checked the notification", fingerprint: differentFingerprint(c.body.fingerprint) });
    expect(stale.status).toBe(409);
    const ok = await checkerA().post(`/components/${w.basic}/confirm`, { version: 2, note: "checked the notification", fingerprint: c.body.fingerprint });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body.status).toBe("CONFIRMED");
  });

  it("refuse a reserved code, an unknown field and a duplicate of the same value", async () => {
    const good = { name: "X", type: "EARNING", taxable: true, pfApplicable: false, esiApplicable: false, prorates: true, payslipLabel: "X", payslipOrder: 1 };
    expect((await maker().post("/components/PF_EMPLOYEE/save-preview", { value: good })).status).toBe(400);
    expect((await maker().post("/components/ARREARS/save-preview", { value: good })).status).toBe(400);
    expect((await maker().post(`/components/${w.prefix}_ODD/save-preview`, { value: { ...good, surprise: 1 } })).status).toBe(400);
    const current = (await maker().get(`/components/${w.hra}`)).body.component.value;
    const same = await maker().post(`/components/${w.hra}/save-preview`, { value: current });
    expect(same.body.unchanged).toBe(true);
    expect((await maker().put(`/components/${w.hra}`, { value: current, fingerprint: same.body.fingerprint })).status).toBe(409);
  });
});

describe("structures", () => {
  it("are proved to add up for a sample CTC before they can be saved, and the refusal says by how much", async () => {
    const [b, h] = await Promise.all([componentPin(w.basic, 2), componentPin(w.hra)]);
    const noBalance = { name: "Short", ctcIncludes: ["EARNING"], lines: [{ ...b, calc: { method: "PERCENT", of: "CTC", percent: "40" } }, { ...h, calc: { method: "PERCENT", of: "CTC", percent: "50" } }] };
    const refused = await maker().post(`/structures/${w.prefix}_SHORT/save-preview`, { value: noBalance, sampleAnnualCtc: "1200000" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.code).toBe("STRUCTURE_DOES_NOT_SUM");
    expect(refused.body.error.message).toMatch(/10000 less than the monthly CTC of 100000/);
    // A line that pins a component version that does not exist, or the wrong hash, is refused too.
    const ghost = { ...noBalance, lines: [{ ...b, componentVersion: 9, calc: { method: "BALANCE" } }] };
    expect((await maker().post(`/structures/${w.prefix}_GHOST/save-preview`, { value: ghost, sampleAnnualCtc: "1200000" })).status).toBe(400);
    const wrongHash = { ...noBalance, lines: [{ ...b, componentHash: "not-the-hash-at-all", calc: { method: "BALANCE" } }] };
    expect((await maker().post(`/structures/${w.prefix}_GHOST/save-preview`, { value: wrongHash, sampleAnnualCtc: "1200000" })).body.error.message).toMatch(/not the version this structure was built against/);
  });

  it("are refused at the save itself too, not only in the preview: a request that skips the preview cannot store a structure that does not add up", async () => {
    const [b, h] = await Promise.all([componentPin(w.basic, 2), componentPin(w.hra)]);
    const noBalance = { name: "Short", ctcIncludes: ["EARNING"], lines: [{ ...b, calc: { method: "PERCENT", of: "CTC", percent: "40" } }, { ...h, calc: { method: "PERCENT", of: "CTC", percent: "50" } }] };
    const code = `${w.prefix}_SKIPPED`;
    await expect(saveStructure(code, { value: noBalance, sampleAnnualCtc: "1200000", fingerprint: "a-fingerprint-nobody-computed" }, { userId: w.maker.userId })).rejects.toMatchObject({ code: "STRUCTURE_DOES_NOT_SUM" });
    expect(await prisma.payrollItemVersion.count({ where: { kind: "STRUCTURE", key: code } })).toBe(0);
  });

  it("show the split for the sample, flag components that are not Confirmed, and are confirmed by a person who did not write them", async () => {
    const b = await componentPin(w.basic, 2); // version 2 is Confirmed (previous test); make HRA's newest version unconfirmed to see the flag
    const h = await componentPin(w.hra);
    const value = { name: "Two lines", ctcIncludes: ["EARNING"], lines: [{ ...b, calc: { method: "PERCENT", of: "CTC", percent: "30" } }, { ...h, calc: { method: "BALANCE" } }] };
    const code = `${w.prefix}_TWO`;
    const preview = await maker().post(`/structures/${code}/save-preview`, { value, sampleAnnualCtc: "1200000" });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.sample.breakup.lines.map((l: { component: string; amount: string }) => [l.component, l.amount])).toEqual([[w.basic, "30000"], [w.hra, "70000"]]);
    expect(preview.body.unconfirmedComponents).toEqual([]);
    const saved = await maker().put(`/structures/${code}`, { value, sampleAnnualCtc: "1200000", note: "two lines", fingerprint: preview.body.fingerprint });
    expect(saved.status, JSON.stringify(saved.body)).toBe(200);
    expect(saved.body).toMatchObject({ status: "PLACEHOLDER", current: { version: 1 } });
    const c = await checkerB().post(`/structures/${code}/confirm-preview`);
    expect(c.body.blocked).toBeNull();
    const done = await checkerB().post(`/structures/${code}/confirm`, { version: 1, note: "against the offer template", fingerprint: c.body.fingerprint });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body.status).toBe("CONFIRMED");
  });

  it("let the editor see a breakup for any CTC without saving anything", async () => {
    const [b, h, s] = await Promise.all([componentPin(w.basic, 2), componentPin(w.hra), componentPin(w.special)]);
    const value = { name: "Preview", ctcIncludes: ["EARNING"], lines: [{ ...b, calc: { method: "PERCENT", of: "CTC", percent: "40" } }, { ...h, calc: { method: "PERCENT", of: w.basic, percent: "50" } }, { ...s, calc: { method: "BALANCE" } }] };
    const r = await maker().post("/structures/breakup-preview", { value, annualCtc: "1000000" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.breakup.monthlyCtc).toBe("83333");
    expect(await prisma.payrollItemVersion.count({ where: { kind: "STRUCTURE", key: { startsWith: `${w.prefix}_PREVIEW` } } })).toBe(0);
  });
});

describe("a salary revision, from preparing to applying", () => {
  it("a first salary: prepared by the maker, decided by a different person, applied by the maker, and written exactly as previewed", async () => {
    const e = w.staff[0]!;
    const { preview, created } = await createRevision(w.tokens.maker, joining(e.employeeId));
    expect(preview.body.blockers).toEqual([]);
    expect(preview.body.people[0]).toMatchObject({ rowReason: "JOINING", previous: null, next: { annualCtc: "1200000", monthlyCtc: "100000" } });
    expect(preview.body.people[0].next.lines.map((l: { component: string; amount: string }) => [l.component, l.amount])).toEqual([[w.basic, "40000"], [w.hra, "20000"], [w.special, "40000"]]);
    expect(preview.body.checkers.state).toMatch(/ONE|MANY/);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;

    let detail = await maker().get(`/salary/revisions/${id}`);
    expect(detail.body.status).toBe("WAITING_FOR_CHECKER");
    // Not yet written; the maker cannot decide it (no checker permission), cannot apply it unapproved.
    expect(await salaryOn(e.employeeId, new Date("2025-05-01"))).toBeNull();
    const r160 = await api(w.tokens.maker).post(`/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: detail.body.fingerprint });
    expect([r160.status, r160.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
    const early = await maker().post(`/salary/revisions/${id}/apply`);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("APPROVAL_REQUIRED");

    const decided = await approve(w.tokens.checkerA, id);
    expect(decided.status, JSON.stringify(decided.body)).toBe(200);
    detail = await maker().get(`/salary/revisions/${id}`);
    expect(detail.body.status).toBe("APPROVED");

    const applied = await maker().post(`/salary/revisions/${id}/apply`);
    expect(applied.status, JSON.stringify(applied.body)).toBe(200);
    const row = await salaryOn(e.employeeId, new Date("2025-05-01"));
    expect(row).toMatchObject({ reason: "JOINING", revisionId: id, structureKey: w.structure, structureVersion: 1 });
    expect(row!.lines.map((l) => [l.componentCode, l.amount.toString()])).toEqual([[w.basic, "40000"], [w.hra, "20000"], [w.special, "40000"]]);
    expect(row!.roundingPin).toMatchObject({ key: "LINE_ROUNDING" });

    detail = await maker().get(`/salary/revisions/${id}`);
    expect(detail.body.status).toBe("APPLIED");
    firstRevisionId = id;
    // An applied revision reads back as it was written, not recomputed from today's setup.
    expect(detail.body.blockers).toEqual([]);
    expect(detail.body.plan.people[0]).toMatchObject({ rowReason: "JOINING", previous: null, problems: [], next: { annualCtc: "1200000", monthlyCtc: "100000" } });
    const approval = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "SALARY_REVISION", subjectId: id } });
    expect(approval).toMatchObject({ status: "CONSUMED", makerUserId: w.maker.userId, checkerUserId: w.checkerA.userId });
    expect(approval.hashAtDecision).toBe(approval.contentHash);
    // Applied twice: refused, and nothing is written twice.
    expect((await maker().post(`/salary/revisions/${id}/apply`)).status).toBe(409);
    expect(await prisma.employeeSalary.count({ where: { employeeId: e.employeeId } })).toBe(1);
    // The audit rows carry references, not amounts.
    const audit = await prisma.auditLog.findMany({ where: { action: "payroll.salary.revised", actorUserId: w.maker.userId, entityId: row!.id } });
    expect(audit).toHaveLength(1);
    expect(JSON.stringify(audit[0]!.after)).not.toMatch(/1200000|40000/);
    expect(audit[0]!.after).toMatchObject({ employeeId: e.employeeId, revisionId: id, amounts: "redacted" });
  });

  it("a percentage increase needs its rounding rule, and says so rather than choosing one", async () => {
    const e = w.staff[0]!;
    const input = { selection: { kind: "EMPLOYEES", employeeIds: [e.employeeId] }, change: { ctc: { mode: "INCREASE_PERCENT", percent: "10" } }, effectiveFrom: REVISION_DAY };
    const before = await maker().post("/salary/revisions/preview", { input });
    expect(before.body.canSubmit).toBe(false);
    expect(before.body.blockers.join(" ")).toMatch(/Rounding of a new CTC after a percentage increase/);
    await setRule(w.maker.userId, "REVISION_CTC_ROUNDING", { mode: "HALF_UP", scale: 0 });
    const after = await maker().post("/salary/revisions/preview", { input });
    expect(after.body.blockers).toEqual([]);
    expect(after.body.people[0]).toMatchObject({ rowReason: "REVISION", previous: { annualCtc: "1200000" }, next: { annualCtc: "1320000", monthlyCtc: "110000" } });
    const diff = Object.fromEntries(after.body.people[0].differences.map((d: { component: string; difference: string }) => [d.component, d.difference]));
    expect(diff).toEqual({ [w.basic]: "4000", [w.hra]: "2000", [w.special]: "4000" });
    const created = await maker().post("/salary/revisions", { input, fingerprint: after.body.fingerprint });
    expect(created.status).toBe(201);
    expect((await approve(w.tokens.checkerB, created.body.id)).status).toBe(200);
    expect((await maker().post(`/salary/revisions/${created.body.id}/apply`)).status).toBe(200);
    const history = await salaryHistory(e.employeeId);
    expect(history.map((r) => [r.effectiveFrom.toISOString().slice(0, 10), r.annualCtc.toString(), r.reason])).toEqual([[REVISION_DAY, "1320000", "REVISION"], [FIRST_SALARY_DAY, "1200000", "JOINING"]]);
    // The first revision still shows what it wrote (1,200,000), and the second shows the row it replaced.
    expect((await maker().get(`/salary/revisions/${firstRevisionId}`)).body.plan.people[0].next.annualCtc).toBe("1200000");
    const second = (await maker().get(`/salary/revisions/${created.body.id}`)).body;
    expect(second.status).toBe("APPLIED");
    expect(second.plan.people[0]).toMatchObject({ previous: { annualCtc: "1200000", monthlyCtc: "100000" }, next: { annualCtc: "1320000", monthlyCtc: "110000" } });
    expect(second.plan.people[0].differences.map((d: { difference: string }) => d.difference).sort()).toEqual(["2000", "4000", "4000"]);
  });

  it("a stale fingerprint is refused at creation and at decision, and a changed figure voids an approval", async () => {
    const e = w.staff[1]!;
    const input = joining(e.employeeId, "960000");
    const preview = await maker().post("/salary/revisions/preview", { input });
    expect((await maker().post("/salary/revisions", { input, fingerprint: differentFingerprint(preview.body.fingerprint) })).body.error.code).toBe("PREVIEW_STALE");
    const created = await maker().post("/salary/revisions", { input, fingerprint: preview.body.fingerprint });
    const id = created.body.id as string;
    const seen = await checkerA().get(`/salary/revisions/${id}`);
    // The checker's screen is out of date: refused, nothing decided.
    expect((await checkerA().post(`/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: differentFingerprint(seen.body.fingerprint) })).body.error.code).toBe("PREVIEW_STALE");
    // The rounding rule changes after submission: the figures the checker would approve are not the figures that were submitted. Void.
    await setRule(w.maker.userId, "LINE_ROUNDING", { mode: "HALF_UP", scale: 1 });
    const fresh = await checkerA().get(`/salary/revisions/${id}`);
    expect(fresh.body.fingerprint).not.toBe(seen.body.fingerprint);
    const voided = await checkerA().post(`/salary/revisions/${id}/decision`, { decision: "APPROVE", fingerprint: fresh.body.fingerprint });
    expect(voided.status).toBe(409);
    expect(voided.body.error.code).toBe("APPROVAL_VOIDED");
    expect((await maker().get(`/salary/revisions/${id}`)).body.status).toBe("VOIDED");
    expect(await salaryOn(e.employeeId, new Date("2025-05-01"))).toBeNull();
    // Resubmitting against the new figures starts again; put the rounding back first so the rest of the file is unaffected.
    await setRule(w.maker.userId, "LINE_ROUNDING", { mode: "HALF_UP", scale: 0 });
    const again = await maker().get(`/salary/revisions/${id}`);
    expect((await maker().post(`/salary/revisions/${id}/submit`, { fingerprint: again.body.fingerprint })).status).toBe(200);
    expect((await maker().get(`/salary/revisions/${id}`)).body.status).toBe("WAITING_FOR_CHECKER");
    expect((await approve(w.tokens.checkerA, id)).status).toBe(200);
    expect((await maker().post(`/salary/revisions/${id}/apply`)).status).toBe(200);
  });

  it("another revision for the same person landing first voids an approved one, and nothing is written", async () => {
    const e = w.staff[2]!;
    const first = (await createRevision(w.tokens.maker, joining(e.employeeId, "1200000"))).created.body.id as string;
    const second = (await createRevision(w.tokens.maker, joining(e.employeeId, "1800000"))).created.body.id as string;
    expect((await approve(w.tokens.checkerA, first)).status).toBe(200);
    expect((await approve(w.tokens.checkerA, second)).status).toBe(200);
    expect((await maker().post(`/salary/revisions/${first}/apply`)).status).toBe(200);
    // The second was approved against a person with no salary; now they have one, so what it would write is different.
    const late = await maker().post(`/salary/revisions/${second}/apply`);
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("APPROVAL_VOIDED");
    // The apply step's own check (with its own words) fired before any row was written; the core's identical check on consume is the second line behind it.
    expect(late.body.error.message).toMatch(/Something changed after this was approved/);
    expect((await maker().get(`/salary/revisions/${second}`)).body.status).toBe("VOIDED");
    expect(await prisma.employeeSalary.count({ where: { employeeId: e.employeeId } })).toBe(1);
    expect((await salaryOn(e.employeeId, new Date("2025-05-01")))?.annualCtc.toString()).toBe("1200000");
  });

  it("a rejected revision stays rejected until it is resubmitted, and a withdrawn one can never be applied", async () => {
    const e = w.staff[1]!;
    const input = { selection: { kind: "EMPLOYEES", employeeIds: [e.employeeId] }, change: { ctc: { mode: "SET", annual: "1500000" } }, effectiveFrom: "2026-06-01" };
    const id = (await createRevision(w.tokens.maker, input)).created.body.id as string;
    expect((await checkerA().post(`/salary/revisions/${id}/decision`, { decision: "REJECT", note: "", fingerprint: (await checkerA().get(`/salary/revisions/${id}`)).body.fingerprint })).status).toBe(400); // a rejection needs a reason
    expect((await approve(w.tokens.checkerA, id, "REJECT", "the date is wrong")).status).toBe(200);
    const rejected = await maker().get(`/salary/revisions/${id}`);
    expect(rejected.body).toMatchObject({ status: "REJECTED", approval: { decisionNote: "the date is wrong" } });
    expect((await maker().post(`/salary/revisions/${id}/apply`)).status).toBe(409);
    expect((await maker().post(`/salary/revisions/${id}/withdraw`, { reason: "" })).status).toBe(400);
    expect((await maker().post(`/salary/revisions/${id}/withdraw`, { reason: "will redo with the right date" })).status).toBe(200);
    expect((await maker().get(`/salary/revisions/${id}`)).body).toMatchObject({ status: "WITHDRAWN", withdrawnReason: "will redo with the right date" });
    expect((await maker().post(`/salary/revisions/${id}/apply`)).status).toBe(409);
    expect((await maker().post(`/salary/revisions/${id}/submit`, { fingerprint: rejected.body.fingerprint })).status).toBe(409);
  });

  it("refuses a revision dated before the person joined, or the same day as their latest salary, or with a structure that does not exist", async () => {
    const e = w.staff[0]!;
    const base = { selection: { kind: "EMPLOYEES", employeeIds: [e.employeeId] }, change: { ctc: { mode: "SET", annual: "1500000" } } };
    const sameDay = await maker().post("/salary/revisions/preview", { input: { ...base, effectiveFrom: REVISION_DAY } });
    expect(sameDay.body.canSubmit).toBe(false);
    expect(sameDay.body.blockers.join(" ")).toMatch(/already starts on 2026-04-01/);
    const earlier = await maker().post("/salary/revisions/preview", { input: { ...base, effectiveFrom: "2025-09-01" } });
    expect(earlier.body.blockers.join(" ")).toMatch(/before the current period started|earlier history is never rewritten/);
    const noStructure = await maker().post("/salary/revisions/preview", { input: { ...base, change: { structure: { key: `${w.prefix}_NOPE`, version: 1 } }, effectiveFrom: "2026-09-01" } });
    expect(noStructure.status).toBe(200);
    expect(noStructure.body.canSubmit).toBe(false);
    expect(noStructure.body.blockers.join(" ")).toMatch(/has no version 1/);
    const fresh = w.staff[2]!;
    void fresh;
    const joinBefore = await maker().post("/salary/revisions/preview", { input: { ...joining(w.checkerB.employeeId, "1200000", "2023-06-01") } });
    expect(joinBefore.body.blockers.join(" ")).toMatch(/joined on 2024-01-01/);
  });
});

describe("a director may change their own pay; it is recorded, tagged, and the other director is told", () => {
  const selfNotices = (actorUserId: string) => prisma.directorActionNotice.findMany({ where: { actorUserId, subjectType: "SELF_PAY_CHANGE" }, include: { receipts: true } });
  const selfAudit = (actorUserId: string) => prisma.auditLog.findMany({ where: { actorUserId, action: "payroll.self_pay_change" } });

  it("a maker who is a director may pick themselves by name; a group pick still leaves them out and says so", async () => {
    const before = (await selfNotices(w.maker.userId)).length;
    const own = await maker().post("/salary/revisions/preview", { input: joining(w.maker.employeeId) });
    expect(own.status, JSON.stringify(own.body)).toBe(200);
    expect((await selfNotices(w.maker.userId)).length).toBeGreaterThan(before);
    const group = await maker().post("/salary/revisions/preview", { input: { selection: { kind: "ALL" }, change: { ctc: { mode: "SET", annual: "1300000" } }, effectiveFrom: "2026-09-01" } });
    expect(group.status).toBe(200);
    expect(group.body.skipped.some((s: { employeeId: string; reason: string }) => s.employeeId === w.maker.employeeId && /Your own pay is not part of a bulk change/.test(s.reason))).toBe(true);
    expect(group.body.people.some((p: { employeeId: string }) => p.employeeId === w.maker.employeeId)).toBe(false);
  });

  it("each such act leaves an audit row tagged SELF_CHANGE and a notice for every other director, with no figure, no name and no identifier in it", async () => {
    const rows = await selfAudit(w.maker.userId);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]!.after).toMatchObject({ tag: "SELF_CHANGE", amounts: "redacted" });
    const notices = await selfNotices(w.maker.userId);
    expect(notices.length).toBeGreaterThan(0);
    const n = notices[0]!;
    expect([n.kind, n.step, n.subjectLabel]).toEqual(["ACTION", "SALARY_REVISION", "a change to their own pay"]);
    expect(n.receipts.length).toBeGreaterThan(0);
    expect(n.receipts.some((r) => r.recipientUserId === w.maker.userId)).toBe(false); // not told of their own act
    expect(n.itemCount).toBeNull();
    expect(Object.keys(n.detail as object).sort()).toEqual(["tag", "what"]); // nothing but the tag and the kind of act: no amount, no person
  });

  it("a Super Admin whose own pay is in an adjustment may add it; it is recorded the same way", async () => {
    const boss = await createFullTestEmployee(w.org, { roleCode: "SUPER_ADMIN" });
    try {
      const token = await loginAs(boss.employeeCode);
      const adj = await api(token).post("/adjustments/preview", { input: { employeeId: boss.employeeId, componentCode: w.basic, direction: "EARNING", amount: "100", reason: "bonus" } });
      expect(adj.status, JSON.stringify(adj.body)).toBe(200);
      expect((await selfAudit(boss.userId)).length).toBeGreaterThan(0);
    } finally {
      await cleanupPayrollRowsBy([boss.userId]);
      await cleanupFullTestEmployee(boss.employeeId);
    }
  });

  it("somebody who is NOT a director still cannot change their own pay, whatever else they hold (and nothing is recorded)", async () => {
    const { assertNotOwnPay } = await import("../salary/guards");
    await expect(assertNotOwnPay(w.outsider.userId, [w.outsider.employeeId], "This revision")).rejects.toMatchObject({ status: 403, code: "SELF_PAY" });
    expect(await selfNotices(w.outsider.userId)).toEqual([]);
    expect(await selfAudit(w.outsider.userId)).toEqual([]);
    await expect(assertNotOwnPay(w.outsider.userId, [w.staff[0]!.employeeId], "This revision")).resolves.toBeUndefined(); // somebody else's pay is another question
  });

  it("the director whose pay is in a revision may approve it when the OTHER director prepared it; the maker can never be the checker; and either may apply it", async () => {
    const input = joining(w.checkerA.employeeId, "1000000");
    const preview = await maker().post("/salary/revisions/preview", { input });
    expect(preview.status).toBe(200);
    const created = await maker().post("/salary/revisions", { input, fingerprint: preview.body.fingerprint });
    const id = created.body.id as string;
    const byMaker = await approve(w.tokens.maker, id);
    expect(byMaker.status).toBe(403); // the maker is not the checker
    const mine = await approve(w.tokens.checkerA, id);
    expect(mine.status, JSON.stringify(mine.body)).toBe(200);
    expect((await selfAudit(w.checkerA.userId)).length).toBeGreaterThan(0);
    const applied = await api(w.tokens.checkerA).post(`/salary/revisions/${id}/apply`);
    expect([200, 403]).toContain(applied.status);
    if (applied.status === 403) expect((await maker().post(`/salary/revisions/${id}/apply`)).status).toBe(200);
    expect(await prisma.employeeSalary.count({ where: { employeeId: w.checkerA.employeeId } })).toBeGreaterThan(0);
  });

  it("the approval core lets a director prepare a change to their own pay (it used to refuse), and records it", async () => {
    const { submit } = await import("../approvals");
    const rev = await prisma.payrollSalaryRevision.create({
      data: { effectiveFrom: new Date("2026-09-01"), reason: "REVISION", selection: { kind: "EMPLOYEES" }, employeeIds: [w.maker.employeeId], change: { ctc: { mode: "SET", annual: "1" } }, createdByUserId: w.maker.userId },
    });
    const before = (await selfAudit(w.maker.userId)).length;
    await expect(submit({ subject: "SALARY_REVISION", subjectId: rev.id, makerUserId: w.maker.userId, previewFingerprint: "fingerprint-x" })).resolves.toMatchObject({ status: "PENDING", makerUserId: w.maker.userId });
    expect((await selfAudit(w.maker.userId)).length).toBeGreaterThan(before);
  });
});

describe("the people a revision covers", () => {
  it("a group pick skips people with no salary on record and says why, and picking nobody is refused", async () => {
    // Everyone in the test branch: staff[0..2] have (or will have) salary; checkerB has none yet.
    const branch = await prisma.employeeJobHistory.findFirstOrThrow({ where: { employeeId: w.staff[0]!.employeeId }, select: { locationId: true } });
    const r = await maker().post("/salary/revisions/preview", { input: { selection: { kind: "BRANCH", locationId: branch.locationId }, change: { ctc: { mode: "SET", annual: "2000000" } }, effectiveFrom: "2026-09-01" } });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.skipped.map((s: { reason: string }) => s.reason).join(" ")).toMatch(/No salary on record/);
    const nobody = await maker().post("/salary/revisions/preview", { input: { selection: { kind: "STRUCTURE", structureKey: `${w.prefix}_NOT_A_STRUCTURE` }, change: { ctc: { mode: "SET", annual: "2000000" } }, effectiveFrom: "2026-09-01" } });
    expect(nobody.status).toBe(400);
  });

  it("an employee list is an employee list: the people, the date and the change are fixed when it is created", async () => {
    const id = (await createRevision(w.tokens.maker, joining(w.checkerB.employeeId, "900000"))).created.body.id as string;
    await expect(prisma.payrollSalaryRevision.update({ where: { id }, data: { employeeIds: [w.staff[0]!.employeeId] } })).rejects.toThrow(/SALARY_REVISION_IMMUTABLE/);
    await expect(prisma.payrollSalaryRevision.update({ where: { id }, data: { effectiveFrom: new Date("2026-01-01") } })).rejects.toThrow(/SALARY_REVISION_IMMUTABLE/);
    await expect(prisma.payrollSalaryRevision.delete({ where: { id } })).rejects.toThrow(/SALARY_REVISION_IMMUTABLE/);
  });
});

describe("who can see and do what", () => {
  it("lists people's salaries with their current structure, finds those without one, and shows a timeline", async () => {
    const list = await maker().get(`/salary/employees?q=${w.staff[0]!.employeeCode}`);
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ employeeCode: w.staff[0]!.employeeCode, current: { annualCtc: "1320000", structure: `${w.structure} v1` } });
    const missing = await maker().get(`/salary/employees?missing=true&q=${w.checkerB.employeeCode}`);
    expect(missing.body.items.map((i: { employeeCode: string }) => i.employeeCode)).toContain(w.checkerB.employeeCode);
    const timeline = await maker().get(`/salary/employees/${w.staff[0]!.employeeId}`);
    expect(timeline.body.history).toHaveLength(2);
    expect(timeline.body.history.map((r: { status: string; annualCtc: string }) => [r.status, r.annualCtc])).toEqual([["current", "1320000"], ["past", "1200000"]]);
    expect((await maker().get(`/salary/people?q=${w.staff[2]!.employeeCode}`)).body.people[0]).toMatchObject({ hasSalary: true });
  });

  it("an HR Executive (no payroll permission) can neither look nor prepare, a director can, and an ordinary employee can do nothing", async () => {
    const input = joining(w.checkerB.employeeId);
    expect((await api(w.tokens.outsider).post("/salary/revisions/preview", { input })).status).toBe(403);
    expect((await api(w.tokens.outsider).get("/salary/revisions")).status).toBe(403);
    expect((await checkerA().get("/salary/revisions")).status).toBe(200);
    const plain = await createFullTestEmployee(w.org);
    try {
      const t = await loginAs(plain.employeeCode);
      for (const path of ["/components", "/structures", "/salary/employees", "/salary/revisions", "/adjustments"]) expect((await api(t).get(path)).status, path).toBe(403);
      expect((await api(t).post("/salary/revisions/preview", { input })).status).toBe(403);
    } finally {
      await cleanupFullTestEmployee(plain.employeeId);
    }
  });
});

describe("adjustments", () => {
  it("are previewed, then added against a fingerprint, listed, and cancelled; the same person's pending ones are shown first", async () => {
    await makeComponent(w, `${w.prefix}_BONUS`, { name: "Bonus", payslipLabel: "Bonus", payslipOrder: 9 });
    await makeComponent(w, `${w.prefix}_RECOVERY`, { name: "Recovery", type: "DEDUCTION", payslipLabel: "Recovery", payslipOrder: 10 });
    const e = w.staff[0]!;
    const input = { employeeId: e.employeeId, componentCode: `${w.prefix}_BONUS`, direction: "EARNING", amount: "5000", reason: "Diwali bonus" };
    const p = await maker().post("/adjustments/preview", { input });
    expect(p.status, JSON.stringify(p.body)).toBe(200);
    expect(p.body).toMatchObject({ amount: "5000", alreadyPending: [] });
    expect((await maker().post("/adjustments", { input: { ...input, amount: "6000" }, fingerprint: p.body.fingerprint })).body.error.code).toBe("PREVIEW_STALE");
    const added = await maker().post("/adjustments", { input, fingerprint: p.body.fingerprint });
    expect(added.status).toBe(201);
    const second = await maker().post("/adjustments/preview", { input });
    expect(second.body.alreadyPending).toHaveLength(1); // a duplicate is visible before it is added
    const list = await maker().get(`/adjustments?employeeId=${e.employeeId}&status=PENDING`);
    expect(list.body.items[0]).toMatchObject({ componentCode: `${w.prefix}_BONUS`, direction: "EARNING", amount: "5000", source: "MANUAL" });
    expect((await maker().post(`/adjustments/${added.body.id}/cancel`, { reason: "" })).status).toBe(400);
    expect((await maker().post(`/adjustments/${added.body.id}/cancel`, { reason: "entered twice" })).status).toBe(200);
    expect((await maker().post(`/adjustments/${added.body.id}/cancel`, { reason: "again" })).status).toBe(409);
    // The amount of a cancelled adjustment cannot be changed behind the application's back either.
    await expect(prisma.$executeRawUnsafe(`UPDATE payroll_adjustments SET amount = 1 WHERE id = '${added.body.id}'`)).rejects.toThrow(/ADJUSTMENT_IMMUTABLE/);
  });

  it("refuse a kind that does not match the component, arrears by hand, zero, and an employer contribution", async () => {
    const e = w.staff[0]!;
    const base = { employeeId: e.employeeId, direction: "EARNING", amount: "100", reason: "test" };
    expect((await maker().post("/adjustments/preview", { input: { ...base, componentCode: `${w.prefix}_RECOVERY` } })).body.error.message).toMatch(/can only be added as one/);
    expect((await maker().post("/adjustments/preview", { input: { ...base, componentCode: "ARREARS" } })).body.error.message).toMatch(/created by a salary revision/);
    expect((await maker().post("/adjustments/preview", { input: { ...base, componentCode: `${w.prefix}_BONUS`, amount: "0" } })).status).toBe(400);
    await makeComponent(w, `${w.prefix}_GRATUITY`, { name: "Gratuity", type: "EMPLOYER_CONTRIBUTION", payslipLabel: "Gratuity", payslipOrder: 11 });
    expect((await maker().post("/adjustments/preview", { input: { ...base, componentCode: `${w.prefix}_GRATUITY` } })).body.error.message).toMatch(/not paid to the person/);
    expect((await maker().post("/adjustments/preview", { input: { ...base, componentCode: `${w.prefix}_NOPE` } })).status).toBe(400);
  });
});

void makeStructure;
