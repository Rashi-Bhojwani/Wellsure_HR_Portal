import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mailService } from "../../../integrations/mail";
import { fakeReceipt } from "../../../integrations/mail/testing";
import { prisma } from "../../../lib/prisma";
import { deliverPayslips } from "../run/payslipDelivery";
import { REAL_RULES, approve, closeWorld, closingWorld, confirmAllPins, driveToFinal, requestStep, resetSeams, staffWith, type Closing } from "./closeTestHelpers";
import { api, calculateRun, setRules } from "./runTestHelpers";

// Independent audit 2026-11-20, fix block Phase 2: "check email/notification templates and tests for pay values reaching HR, managers or anyone not entitled".
// A whole month, calculated, approved, finalised, published and delivered: no email and no in-app notification raised along the way carries a pay figure, and
// payroll notices reach only the directors and (for their own payslip) the payee. Every figure in the run is looked for, in plain and Indian-grouped form.
describe("payroll notices and emails carry no pay figure, and reach only the entitled", () => {
  let world: Closing;
  let runId = "";
  const since = new Date();
  const mails: Array<{ to: string; subject: string; html: string }> = [];

  beforeAll(async () => {
    vi.spyOn(mailService, "send").mockImplementation(async (m) => {
      mails.push({ to: String(m.to), subject: m.subject, html: m.html ?? "" });
      return fakeReceipt(String(m.to));
    });
    world = await closingWorld(["a", "b"]);
    await staffWith(world, ["a", "b"]);
    await setRules(world.maker.userId, REAL_RULES);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
    await requestStep(world.tokens.maker, runId, "publish");
    await approve(world, world.tokens.checkerB, runId, "publish");
    expect((await api(world.tokens.maker, "post", `/runs/${runId}/payslips/publish`)).status).toBe(201);
    await deliverPayslips(runId);
  }, 900_000);
  afterAll(async () => {
    resetSeams();
    vi.restoreAllMocks();
    await closeWorld(world);
  }, 300_000);

  const figures = async (): Promise<string[]> => {
    const lines = await prisma.payrollRunLine.findMany({ where: { runId }, select: { amount: true } });
    const out = new Set<string>();
    for (const l of lines) {
      const n = Math.abs(Number(l.amount.toString()));
      if (n < 100) continue; // small numbers (days, counts) would match unrelated text
      const whole = Math.round(n).toString();
      out.add(whole);
      out.add(n.toFixed(2));
      out.add(Math.round(n).toLocaleString("en-IN"));
    }
    return [...out];
  };

  it("no email sent during the month carries a pay figure", async () => {
    expect(mails.length).toBeGreaterThan(0); // the payslip emails at least
    const figs = await figures();
    expect(figs.length).toBeGreaterThan(0);
    for (const m of mails) for (const f of figs) expect(`${m.subject} ${m.html}`, `${m.subject}: ${f}`).not.toContain(f);
  });

  it("no in-app notification carries a pay figure, and payroll notices go only to directors or to the payee about their own payslip", async () => {
    const rows = await prisma.notification.findMany({ where: { createdAt: { gte: since } }, select: { userId: true, type: true, title: true, body: true, payload: true } });
    const figs = await figures();
    for (const r of rows) for (const f of figs) expect(`${r.title} ${r.body} ${JSON.stringify(r.payload)}`, `${r.type}: ${f}`).not.toContain(f);
    const directors = new Set((await prisma.userRole.findMany({ where: { role: { code: "SUPER_ADMIN" } }, select: { userId: true } })).map((u) => u.userId));
    const payees = new Set(Object.values(world.named).map((p) => p.userId));
    for (const r of rows.filter((x) => x.type.startsWith("payroll.") || x.type.startsWith("payslip."))) {
      if (r.type === "payslip.published") expect(payees.has(r.userId), r.type).toBe(true);
      else expect(directors.has(r.userId), r.type).toBe(true);
    }
  });
});
