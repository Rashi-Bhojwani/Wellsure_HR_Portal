import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DIRECTOR_CHOICE_REQUIRED_STEPS, DIRECTOR_RECOMMENDED_SECOND_STEPS, DIRECTOR_STEPS } from "@shared/constants/directorAuthority";
import { prisma } from "../../../lib/prisma";
import { buildSetupReport, readinessOf } from "../setup/status";
import { calculateRun, setRules } from "./runTestHelpers";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, resetSeams, runRow, staffWith, step, type Closing } from "./closeTestHelpers";
import { setDirectorChoices, useSecondDirectorChecks } from "./payrollTestHelpers";

// Docs: the choice for each payroll step has NO default. "A different director must decide" or "the acting director decides alone, the other is told" is set by one director and confirmed
// by the other. While any is Not set, payroll refuses to run and Ready for first real run is red. Both modes tell the other director. (Proposing and confirming themselves are tested in
// directorAuthority.test.ts.)

describe("the choice for each payroll step: Not set, then either way", () => {
  let world: Closing;
  let runId: string;
  let restore: () => Promise<void>;

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
    vi.restoreAllMocks();
    await closeWorld(world);
  });

  const clear = () => prisma.systemSetting.deleteMany({ where: { key: "payroll.secondDirector" } });
  const ask = async () => {
    const p = await step(world.tokens.maker, runId, "run", "preview");
    return { preview: p, request: await step(world.tokens.maker, runId, "run", "request", { fingerprint: p.body.fingerprint ?? "x" }) };
  };

  it("the screen recommends a different director for the four steps that matter most, and those are all payroll steps with a required choice", () => {
    expect([...DIRECTOR_RECOMMENDED_SECOND_STEPS].sort()).toEqual(["BANK_FILE", "RULE_CONFIRM", "RUN_APPROVAL", "SALARY_REVISION"]);
    for (const s of DIRECTOR_RECOMMENDED_SECOND_STEPS) expect(DIRECTOR_CHOICE_REQUIRED_STEPS as readonly string[]).toContain(s);
    expect([...DIRECTOR_CHOICE_REQUIRED_STEPS].sort()).toEqual(["BANK_FILE", "PAYSLIP_PUBLISH", "PERIOD_FINALISE", "PERIOD_UNLOCK", "RULE_CONFIRM", "RUN_APPROVAL", "SALARY_REVISION", "SETUP_SIGNOFF"]);
  });

  it("Not set: Ready for first real run is red with one blocker per step, and the run cannot be asked for approval; nothing is written", async () => {
    await clear();
    const report = await buildSetupReport();
    const rows = report.sections.flatMap((s) => s.items).filter((i) => i.id.startsWith("safety:director-choice:"));
    expect(rows.map((r) => r.id.split(":")[2]).sort()).toEqual([...DIRECTOR_CHOICE_REQUIRED_STEPS].sort());
    for (const r of rows) expect([r.id, r.status, r.required]).toEqual([r.id, "NOT_SET", true]);
    const ready = readinessOf(report);
    expect(ready.ready).toBe(false);
    for (const s of DIRECTOR_CHOICE_REQUIRED_STEPS) expect(ready.blockers.map((b) => b.itemId), s).toContain(`safety:director-choice:${s}`);
    const { preview, request } = await ask();
    expect(preview.status).toBe(200);
    expect(preview.body.blockers.map((b: { code: string }) => b.code)).toContain("DIRECTOR_CHOICE_NOT_SET");
    expect([request.status, request.body.error?.code]).toEqual([409, "DIRECTOR_CHOICE_NOT_SET"]);
    expect((await runRow(runId)).status).toBe("CALCULATED");
    expect(await prisma.payrollApproval.count({ where: { subjectId: runId } })).toBe(0);
  });

  it("proposed but not confirmed is still not set: the row waits, the run still refuses", async () => {
    const at = new Date().toISOString(); // allow-clock: a fixture
    const steps = Object.fromEntries(DIRECTOR_CHOICE_REQUIRED_STEPS.map((s) => [s, { pending: { mode: "DIRECTOR_AUTHORITY", proposedBy: "test-proposer", proposedAt: at } }]));
    await prisma.systemSetting.upsert({ where: { key: "payroll.secondDirector" }, create: { key: "payroll.secondDirector", value: { v: 2, steps } }, update: { value: { v: 2, steps } } });
    const rows = (await buildSetupReport()).sections.flatMap((s) => s.items).filter((i) => i.id.startsWith("safety:director-choice:"));
    for (const r of rows) expect([r.status, r.detail], r.id).toEqual(["PLACEHOLDER", expect.stringMatching(/other director has not confirmed/)]);
    expect((await ask()).request.body.error?.code).toBe("DIRECTOR_CHOICE_NOT_SET");
  });

  it("one step left Not set is enough to keep payroll from running", async () => {
    const all = Object.fromEntries(DIRECTOR_CHOICE_REQUIRED_STEPS.map((s) => [s, "DIRECTOR_AUTHORITY" as const]));
    delete (all as Record<string, unknown>).BANK_FILE;
    await setDirectorChoices(all);
    expect(readinessOf(await buildSetupReport()).blockers.map((b) => b.itemId)).toContain("safety:director-choice:BANK_FILE");
    expect((await ask()).request.body.error?.code).toBe("DIRECTOR_CHOICE_NOT_SET"); // the run-level blocker names every unset step
  });

  it("a different director: the act waits for the other, who is told it is waiting (counts only); the preparer cannot decide it", async () => {
    await setDirectorChoices(Object.fromEntries(DIRECTOR_STEPS.map((s) => [s, "SECOND_DIRECTOR" as const])));
    const rows = (await buildSetupReport()).sections.flatMap((s) => s.items).filter((i) => i.id.startsWith("safety:director-choice:"));
    for (const r of rows) expect(r.status, r.id).toBe("CONFIRMED");
    const { request } = await ask();
    expect([request.status, request.body.authority, request.body.status, request.body.runStatus]).toEqual([201, "SECOND_DIRECTOR", "PENDING", "SUBMITTED"]);
    const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { subjectId: runId, step: "RUN_APPROVAL" }, include: { receipts: true } });
    expect([notice.authority, notice.actorUserId]).toEqual(["SECOND_DIRECTOR", world.maker.userId]);
    expect(notice.subjectLabel).toMatch(/waiting for your decision/);
    expect(notice.receipts.map((x) => x.recipientUserId)).not.toContain(world.maker.userId);
    expect(notice.receipts.length).toBeGreaterThan(0);
    expect(JSON.stringify(notice)).not.toContain((await runRow(runId)).totalNet.toString());
    const approval = await prisma.payrollApproval.findFirstOrThrow({ where: { subject: "RUN_APPROVAL", subjectId: runId } });
    // The preparer cannot decide their own request.
    const own = await step(world.tokens.maker, runId, "run", "decision", { decision: "APPROVE", hash: approval.contentHash });
    expect(own.status).toBe(403);
    // Put it back to a draft for the next case.
    const w = await step(world.tokens.maker, runId, "run", "withdraw-preview");
    const out = await step(world.tokens.maker, runId, "run", "withdraw", { reason: "trying the other way", fingerprint: w.body.fingerprint });
    expect(out.status).toBe(200);
    expect((await runRow(runId)).status).toBe("CALCULATED");
  });

  it("alone: the director's own act takes effect at once and the other director is told", async () => {
    await setDirectorChoices(Object.fromEntries(DIRECTOR_STEPS.map((s) => [s, "DIRECTOR_AUTHORITY" as const])));
    const { request } = await ask();
    expect([request.status, request.body.authority, request.body.runStatus]).toEqual([201, "DIRECTOR_AUTHORITY", "APPROVED"]);
    const notice = await prisma.directorActionNotice.findFirstOrThrow({ where: { subjectId: runId, step: "RUN_APPROVAL", authority: "DIRECTOR_AUTHORITY" }, include: { receipts: true } });
    expect([notice.receipts.length > 0, notice.receipts.map((x) => x.recipientUserId).includes(world.maker.userId)]).toEqual([true, false]);
  });
});
