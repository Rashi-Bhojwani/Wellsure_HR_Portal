import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderCatalogue } from "@shared/attendance/simulator";

// docs/plans/PHASE_2_SCENARIOS.md is generated from the scenarios so a person can
// read what the engine is held to. If a scenario changes and the page doesn't,
// the page would be telling them something untrue: fail until it is regenerated.
describe("the scenario catalogue", () => {
  it("the committed page matches the scenarios in the code", () => {
    // a Windows checkout turns line endings into CRLF; the words are what must match
    const committed = readFileSync(path.resolve(import.meta.dirname, "../../../../docs/plans/PHASE_2_SCENARIOS.md"), "utf8").replace(/\r\n/g, "\n");
    expect(committed, "stale: run `npm run catalogue --prefix biometric-agent` and commit the result").toBe(renderCatalogue());
  });

  it("is deterministic and covers every working-day scenario", () => {
    const a = renderCatalogue();
    expect(renderCatalogue()).toBe(a);
    for (const name of ["normal-day", "missing-punch", "threshold-edges", "catch-up", "leave-full", "not-employed"]) expect(a).toContain(`\`${name}\``);
  });
});
