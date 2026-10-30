import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { DIRECTOR_STEPS } from "@shared/constants/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { api, calculateRun, day, setRules } from "./runTestHelpers";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, resetSeams, runRow, staffWith, step, type Closing } from "./closeTestHelpers";
import { useSecondDirectorChecks } from "./payrollTestHelpers";

const LAYOUT = {
  format: "DELIMITED",
  delimiter: ",",
  lineEnding: "LF",
  extension: "csv",
  dateFormat: "DD-MM-YYYY",
  amountDecimals: 2,
  header: [[{ source: "CONSTANT", value: "ZZHDR9917" }, { source: "PATTERN", value: "{DEBIT_ACCOUNT}" }, { source: "PATTERN", value: "{COUNT}" }, { source: "PATTERN", value: "{TOTAL}" }]],
  columns: [{ source: "FIELD", value: "SERIAL" }, { source: "FIELD", value: "NAME" }, { source: "FIELD", value: "ACCOUNT_NUMBER" }, { source: "FIELD", value: "IFSC" }, { source: "FIELD", value: "AMOUNT" }],
  narrationPattern: "Salary {PERIOD}",
};

// Director authority for the run's steps (docs/plans/DIRECTOR_AUTHORITY.md, D2): unless the owners switched a second-director check on for a step, the director who prepares a step
// decides it in the same act, it takes effect at once, and the other director is told. The worlds in the other test files switch every check ON, so everything there describes the
// two-director behaviour; here each step is run both ways.

const STEP_OF = { run: "RUN_APPROVAL", finalise: "PERIOD_FINALISE", unlock: "PERIOD_UNLOCK", publish: "PAYSLIP_PUBLISH", "bank-file": "BANK_FILE" } as const;
type Slug = keyof typeof STEP_OF;

const goOn = async (world: Closing, runId: string, slug: Slug, note?: string) => {
  const p = await step(world.tokens.maker, runId, slug, "preview");
  if (p.status !== 200) throw new Error(`${slug} preview: ${JSON.stringify(p.body)}`);
  return step(world.tokens.maker, runId, slug, "request", { fingerprint: p.body.fingerprint, ...(note ? { note } : {}) });
};

describe("a director acting on their own authority: approving and closing a run", () => {
  let world: Closing;
  let restore: () => Promise<void>;
  let runId: string;

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    restore = await useSecondDirectorChecks(false); // every step on the director's own authority, as a new installation starts
  }, 600_000);
  afterAll(async () => {
    await restore();
    resetSeams();
    vi.restoreAllMocks();
    await closeWorld(world);
  });

  it("says in the preview that the director can do it alone, and that the other director will be told", async () => {
    const p = await step(world.tokens.maker, runId, "run", "preview");
    expect([p.body.authority, p.body.checkers.state]).toEqual(["DIRECTOR_AUTHORITY", "SELF"]);
    expect(p.body.checkers.message).toMatch(/yourself.*the other director is told/i);
    const s = (await api(world.tokens.maker, "get", `/runs/${runId}/approvals`)).body.steps.find((x: { slug: string }) => x.slug === "run");
    expect(s.authority).toBe("DIRECTOR_AUTHORITY");
  });

  it("somebody who is not a director cannot do it at all", async () => {
    const p = await step(world.tokens.maker, runId, "run", "preview");
    const r = await step(world.tokens.outsider, runId, "run", "request", { fingerprint: p.body.fingerprint });
    expect(r.status).toBe(403);
    expect((await runRow(runId)).status).toBe("CALCULATED");
  });

  it("approving the run is one act: the run is APPROVED at once, recorded under director authority, the other directors are told (counts only), the actor is not", async () => {
    const r = await goOn(world, runId, "run", "checked it myself");
    expect([r.status, r.body.status, r.body.authority, r.body.runStatus]).toEqual([201, "APPROVED", "DIRECTOR_AUTHORITY", "APPROVED"]);
    expect((await runRow(runId)).status).toBe("APPROVED");
    const a = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "RUN_APPROVAL", subjectId: runId } });
    expect([a.status, a.authority, a.makerUserId, a.checkerUserId, a.hashAtDecision]).toEqual(["APPROVED", "DIRECTOR_AUTHORITY", world.maker.userId, world.maker.userId, a.contentHash]);
    const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { subjectId: runId, step: "RUN_APPROVAL" }, include: { receipts: true } });
    expect(notice.actorUserId).toBe(world.maker.userId);
    expect(notice.receipts.map((x) => x.recipientUserId)).not.toContain(world.maker.userId);
    expect(notice.receipts.length).toBeGreaterThanOrEqual(1);
    // No amount, no name, anywhere in it.
    const run = await runRow(runId);
    expect(JSON.stringify(notice)).not.toContain(run.totalNet.toString());
    expect(JSON.stringify(notice)).not.toContain(world.named.a!.employeeCode);
    // Nothing is waiting for a second decision.
    const again = await step(world.tokens.checkerA, runId, "run", "decision", { decision: "APPROVE", hash: a.contentHash });
    expect([again.status, again.body.error.code]).toEqual([409, "NOTHING_PENDING"]);
    expect((await prisma.payrollEvent.findMany({ where: { subjectType: "RUN_APPROVAL", subjectId: runId }, orderBy: { seq: "asc" } })).map((e) => e.type)).toEqual(["SUBMITTED", "APPROVED"]);
  });

  it("closing the period: the same director asks and carries it out; the approval is single use", async () => {
    const r = await goOn(world, runId, "finalise");
    expect([r.status, r.body.status, r.body.authority]).toEqual([201, "APPROVED", "DIRECTOR_AUTHORITY"]);
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
    expect([done.status, done.body.status]).toEqual([200, "FINALISED"]);
    expect(await prisma.payrollApproval.count({ where: { subjectId: runId, status: "CONSUMED", authority: "DIRECTOR_AUTHORITY" } })).toBe(2);
    expect(await prisma.directorActionNotice.count({ where: { subjectId: runId, step: "PERIOD_FINALISE" } })).toBe(1);
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/finalise`)).status).toBe(409);
  });

  it("the other steps are the same: publishing and the unlock (which still needs a reason and is still refused once something has been released)", async () => {
    const unlockNoReason = await goOn(world, runId, "unlock");
    expect(unlockNoReason.status).toBe(400); // a reason is still required
    const pub = await goOn(world, runId, "publish");
    expect([pub.status, pub.body.authority]).toEqual([201, "DIRECTOR_AUTHORITY"]);
    const published = await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`);
    expect(published.status).toBe(201);
    // Released: the period can no longer be unlocked, on any authority.
    const p = await step(world.tokens.maker, runId, "unlock", "preview");
    expect(p.body.blockers.map((b: { code: string }) => b.code)).toContain("RUN_RELEASED");
    expect(await prisma.directorActionNotice.count({ where: { subjectId: runId, step: "PAYSLIP_PUBLISH" } })).toBe(1);
  });

  it("the bank file: the layout is confirmed by the other director (a layout is not on this step), then one director asks for the file and generates it", async () => {
    const pre = await api(world.tokens.maker, "post", "/layouts/BANK_TEMPLATE/save-preview", { value: { ...LAYOUT, debitAccountNumber: "000111222333444" } });
    expect(pre.status).toBe(200);
    expect((await request(app).put("/api/payroll/layouts/BANK_TEMPLATE").set(...authHeader(world.tokens.maker)).send({ value: { ...LAYOUT, debitAccountNumber: "000111222333444" }, fingerprint: pre.body.fingerprint, note: "from the test bank's sheet" })).status).toBe(200);
    const cp = await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm-preview");
    expect((await api(world.tokens.checkerA, "post", "/layouts/BANK_TEMPLATE/confirm", { version: cp.body.version, note: "matches the sheet", fingerprint: cp.body.fingerprint })).status).toBe(200);
    const r = await goOn(world, runId, "bank-file");
    expect([r.status, r.body.status, r.body.authority]).toEqual([201, "APPROVED", "DIRECTOR_AUTHORITY"]);
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/bank-file/generate`);
    expect([done.status, done.body.rows]).toEqual([201, 2]);
    expect(await prisma.directorActionNotice.count({ where: { subjectId: runId, step: "BANK_FILE" } })).toBe(1);
  });
});

describe("director authority: unlocking", () => {
  let world: Closing;
  let restore: () => Promise<void>;
  let runId: string;

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId); // the two-director way
    restore = await useSecondDirectorChecks(false);
  }, 600_000);
  afterAll(async () => {
    await restore();
    resetSeams();
    await closeWorld(world);
  });

  it("one director asks, with a reason, and carries it out; the period is open again, and the other director is told", async () => {
    const r = await goOn(world, runId, "unlock", "A day was wrong in the register");
    expect([r.status, r.body.authority]).toEqual([201, "DIRECTOR_AUTHORITY"]);
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/unlock`);
    expect([done.status, done.body.status]).toEqual([200, "VOID"]);
    expect(await prisma.payrollPeriodLock.count({ where: { runId, action: "UNLOCK" } })).toBe(1);
    const approval = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "PERIOD_UNLOCK", subjectId: runId } });
    expect([approval.status, approval.authority, approval.submitNote]).toEqual(["CONSUMED", "DIRECTOR_AUTHORITY", "A day was wrong in the register"]);
    expect(await prisma.directorActionNotice.count({ where: { subjectId: runId, step: "PERIOD_UNLOCK" } })).toBe(1);
  });
});

describe("director authority for a run: what stays", () => {
  let world: Closing;
  let restore: () => Promise<void>;
  let runId: string;
  const who = (n: string) => world.named[n]!.employeeId;

  beforeAll(async () => {
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    restore = await useSecondDirectorChecks(false);
  }, 600_000);
  afterAll(async () => {
    await restore();
    resetSeams();
    await closeWorld(world);
  });

  it("the preview's fingerprint is still required, and a stale one is refused", async () => {
    const stale = await step(world.tokens.maker, runId, "run", "request", { fingerprint: "payroll-hash-v1:" + "0".repeat(64) });
    expect([stale.status, stale.body.error.code]).toEqual([409, "PREVIEW_STALE"]);
    expect((await runRow(runId)).status).toBe("CALCULATED");
  });

  it("the figures are still bound: if they move between the approval and the act, the act is refused and the approval is void", async () => {
    expect((await goOn(world, runId, "run")).status).toBe(201);
    expect((await goOn(world, runId, "finalise")).status).toBe(201);
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: day("2026-08-20") } }); // a change nothing announced
    const done = await api(world.tokens.maker, "post", `/runs/${runId}/finalise`);
    expect([done.status, done.body.error.code]).toEqual([409, "APPROVAL_VOIDED"]);
    expect((await runRow(runId)).status).toBe("CALCULATED");
    expect(await prisma.payrollPeriodLock.count({ where: { runId } })).toBe(0);
    await prisma.employee.update({ where: { id: who("b") }, data: { lastWorkingDate: null } });
  }, 240_000);

  it("a second-director check switched on for ONE step applies to that step only, and an approval keeps the mode it was written under", async () => {
    const results: Record<string, string> = {};
    for (const slug of Object.keys(STEP_OF) as Slug[]) {
      const undo = await useSecondDirectorChecks({ [STEP_OF[slug]]: true });
      try {
        for (const other of Object.keys(STEP_OF) as Slug[]) {
          const p = await step(world.tokens.maker, runId, other, "preview");
          results[`${slug}/${other}`] = p.body.authority;
        }
      } finally {
        await undo();
      }
    }
    for (const slug of Object.keys(STEP_OF) as Slug[]) for (const other of Object.keys(STEP_OF) as Slug[]) expect(results[`${slug}/${other}`], `${slug} on, asking about ${other}`).toBe(slug === other ? "SECOND_DIRECTOR" : "DIRECTOR_AUTHORITY");
    expect(DIRECTOR_STEPS.length).toBe(10);
  });

  it("with the check switched on for the step, nothing changes: the maker waits, the other director decides, the same person can never be both", async () => {
    const undo = await useSecondDirectorChecks({ RUN_APPROVAL: true });
    try {
      const r = await goOn(world, runId, "run");
      expect([r.status, r.body.status, r.body.authority]).toEqual([201, "PENDING", "SECOND_DIRECTOR"]);
      expect((await runRow(runId)).status).toBe("SUBMITTED");
      const hash = (await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "RUN_APPROVAL", subjectId: runId, status: "PENDING" } })).contentHash;
      const own = await step(world.tokens.maker, runId, "run", "decision", { decision: "APPROVE", hash });
      expect([own.status, own.body.error.code]).toEqual([403, "CHECKER_IS_MAKER"]);
      expect((await step(world.tokens.checkerA, runId, "run", "decision", { decision: "APPROVE", hash })).status).toBe(200);
    } finally {
      await undo();
    }
  }, 240_000);
});
