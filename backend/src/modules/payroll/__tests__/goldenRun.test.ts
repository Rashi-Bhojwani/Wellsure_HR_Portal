import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { buildPayslips } from "../run/payslip";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Golden regression (docs/plans/A_PART3.md): one real finalised run over the shared closing world, compared figure for figure with fixtures/golden-run.json, which was
// written ONCE from the code as it was before part 3 (GOLDEN_WRITE=1). Every part-3 mechanism must leave it identical while its settings are Not set and with one
// company. Pay-head codes lose their random test prefix; people are keyed by their letter. Made-up people and figures only.
const FIXTURE = path.join(__dirname, "fixtures", "golden-run.json");

export interface GoldenSnapshot {
  items: Record<string, { status: string; gross: string; deductions: string; employerContributions: string; netBeforeRounding: string; roundingAdjustment: string; netPay: string; lines: string[] }>;
  payslips: Record<string, { totals: unknown; days: unknown; earnings: string[]; deductions: string[]; employer: string[] }>;
}

/** The run's figures and payslip contents in a form that does not depend on random ids, codes or names. */
export async function goldenSnapshot(world: Closing, runId: string): Promise<GoldenSnapshot> {
  const strip = (code: string) => code.replace(`${world.prefix}_`, "P_");
  const letterOf = new Map(Object.entries(world.named).map(([k, v]) => [v.employeeId, k]));
  const items = await prisma.payrollRunItem.findMany({ where: { runId }, include: { lines: { orderBy: { sortOrder: "asc" } } } });
  const out: GoldenSnapshot = { items: {}, payslips: {} };
  for (const i of items) {
    const k = letterOf.get(i.employeeId);
    if (!k) continue;
    out.items[k] = {
      status: i.status,
      gross: i.gross.toString(),
      deductions: i.deductions.toString(),
      employerContributions: i.employerContributions.toString(),
      netBeforeRounding: i.netBeforeRounding.toString(),
      roundingAdjustment: i.roundingAdjustment.toString(),
      netPay: i.netPay.toString(),
      lines: i.lines.map((l) => `${l.sortOrder}|${strip(l.code)}|${l.kind}|${l.source}|${l.amount.toString()}`),
    };
  }
  const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
  for (const [employeeId, slip] of await buildPayslips(run)) {
    const k = letterOf.get(employeeId);
    if (!k) continue;
    const c = slip.content as unknown as { totals: unknown; days: unknown; earnings: Array<{ code: string; amount: string }>; deductions: Array<{ code: string; amount: string }>; employer?: Array<{ code: string; amount: string }> };
    const fmt = (xs: Array<{ code: string; amount: string }> | undefined) => (xs ?? []).map((l) => `${strip(l.code)}|${l.amount}`);
    out.payslips[k] = { totals: c.totals, days: c.days, earnings: fmt(c.earnings), deductions: fmt(c.deductions), employer: fmt(c.employer) };
  }
  return out;
}

describe("golden run — the figures of a finalised run are exactly as before part 3", () => {
  let world: Closing;
  let runId = "";

  beforeAll(async () => {
    world = await closingWorld(["a", "b", "c"]);
    await staffWith(world, ["a", "b", "c"]);
    await setRules(world.maker.userId, REAL_RULES);
    const hold = await request(app).post("/api/payroll/holds").set(...authHeader(world.tokens.maker)).send({ input: { employeeId: world.named.c!.employeeId, cycleStart: CYCLE.start, reason: "Documents pending" } });
    expect(hold.status).toBe(201);
    runId = await calculateRun(world);
    await confirmAllPins(world, runId);
    await driveToFinal(world, runId);
  }, 900_000);

  afterAll(async () => {
    await closeWorld(world);
  }, 300_000);

  it("every item's figures and lines, and every payslip's totals and lines, equal the fixture written before part 3", async () => {
    const snap = await goldenSnapshot(world, runId);
    if (process.env.GOLDEN_WRITE === "1") {
      if (!existsSync(path.dirname(FIXTURE))) mkdirSync(path.dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, `${JSON.stringify(snap, null, 2)}\n`);
    }
    expect(Object.keys(snap.items).sort()).toEqual(["a", "b", "c"]);
    expect(snap).toEqual(JSON.parse(readFileSync(FIXTURE, "utf8")));
  });

  it("each payslip shows the statutory identifiers' last digits held for the person", async () => {
    const run = await prisma.payrollRun.findUniqueOrThrow({ where: { id: runId } });
    for (const [employeeId, slip] of await buildPayslips(run)) {
      const st = await prisma.employeeStatutory.findUnique({ where: { employeeId } });
      const s = (slip.content as unknown as { statutory: { panLast4: string | null; uanLast4: string | null; esiLast4: string | null } }).statutory;
      expect(s).toEqual({ panLast4: st?.panLast4 ?? null, uanLast4: st?.uanLast4 ?? null, esiLast4: st?.esiLast4 ?? null });
    }
  });
});
