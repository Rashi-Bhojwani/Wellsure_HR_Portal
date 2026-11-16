import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../../lib/prisma";
import { app, authHeader } from "../../employee/__tests__/employeeTestHelpers";
import { buildPayslips } from "../run/payslip";
import { GOLDEN_FIXTURE as FIXTURE, goldenSnapshot } from "./goldenHelpers";
import { REAL_RULES, closeWorld, closingWorld, confirmAllPins, driveToFinal, staffWith, type Closing } from "./closeTestHelpers";
import { CYCLE, calculateRun, setRules } from "./runTestHelpers";

// Golden regression (docs/plans/A_PART3.md): one real finalised run over the shared closing world, compared figure for figure with fixtures/golden-run.json, which was
// written ONCE from the code as it was before part 3 (GOLDEN_WRITE=1). Every part-3 mechanism must leave it identical while its settings are Not set and with one
// company. Pay-head codes lose their random test prefix; people are keyed by their letter. Made-up people and figures only.

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
