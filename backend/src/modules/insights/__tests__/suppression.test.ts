import { describe, expect, it } from "vitest";
import { suppress, type Cell } from "../suppression";

// Property test of the small-group rule against an independent reference that does not reuse the implementation: it only looks
// at what was PUBLISHED and asks what an attacker can learn by subtraction.
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Independent reference: from the published table alone, what can be recovered? Returns a list of problems. */
function attack(published: ReturnType<typeof suppress<number>>, truth: Cell<number>[], k: number): string[] {
  const problems: string[] = [];
  for (const c of published.cells) {
    const real = truth.find((t) => t.key === c.key)!;
    if (!c.suppressed && c.n !== real.n) problems.push(`${c.key}: published n differs from the truth`);
    if (!c.suppressed && real.n > 0 && real.n < k) problems.push(`${c.key}: small group published (${real.n})`);
  }
  if (!published.total.suppressed) {
    const visible = published.cells.filter((c) => !c.suppressed).reduce((s, c) => s + (c.n ?? 0), 0);
    const recovered = published.total.n! - visible; // the people hidden behind the suppressed cells, recovered by subtraction
    if (recovered > 0 && recovered < k) problems.push(`subtraction recovers a group of ${recovered} (< ${k})`);
    const hiddenCells = published.cells.filter((c) => c.suppressed);
    // With exactly one hidden non-empty cell, subtraction gives that cell's exact value: it must not be a small group.
    if (hiddenCells.length === 1 && recovered > 0 && recovered < k) problems.push(`single hidden cell ${hiddenCells[0]!.key} recovered`);
  }
  return problems;
}

describe("Insights small-group suppression (property test)", () => {
  it("random populations: no published figure is a small group and no subtraction recovers fewer than k people", () => {
    const next = rng(20261112);
    let checked = 0, suppressedSomething = 0, complementary = 0;
    for (let round = 0; round < 5000; round++) {
      const k = 2 + Math.floor(next() * 9); // 2..10
      const cells: Cell<number>[] = Array.from({ length: 1 + Math.floor(next() * 8) }, (_, i) => {
        const n = next() < 0.15 ? 0 : Math.floor(next() * (next() < 0.5 ? k + 2 : 4 * k));
        return { key: `D${i}`, label: `DEMO dept ${i}`, n, value: n };
      });
      const totalN = cells.reduce((s, c) => s + c.n, 0);
      const out = suppress(cells, { n: totalN, value: totalN }, k);
      const problems = attack(out, cells, k);
      expect(problems, JSON.stringify({ k, cells: cells.map((c) => c.n) })).toEqual([]);
      checked++;
      const primary = cells.filter((c) => c.n > 0 && c.n < k).length;
      const hidden = out.cells.filter((c) => c.suppressed).length;
      if (hidden) suppressedSomething++;
      if (hidden > primary) complementary++;
    }
    expect(checked).toBe(5000);
    expect(suppressedSomething).toBeGreaterThan(500); // the generator really exercises suppression
    expect(complementary).toBeGreaterThan(100); // and complementary suppression
  });

  it("the classic attack: one small department next to a published total is hidden together with another", () => {
    const out = suppress([{ key: "A", label: "A", n: 1, value: 1 }, { key: "B", label: "B", n: 7, value: 7 }, { key: "C", label: "C", n: 9, value: 9 }], { n: 17, value: 17 }, 5);
    expect(out.cells.map((c) => c.suppressed)).toEqual([true, true, false]);
    expect(out.total).toEqual({ suppressed: false, n: 17, value: 17 });
  });

  it("a whole table smaller than k shows nothing, and zero cells reveal nobody", () => {
    const out = suppress([{ key: "A", label: "A", n: 2, value: 2 }, { key: "B", label: "B", n: 0, value: 0 }], { n: 2, value: 2 }, 3);
    expect(out.total.suppressed).toBe(true);
    expect(out.cells.find((c) => c.key === "A")!.suppressed).toBe(true);
    expect(out.cells.find((c) => c.key === "B")).toMatchObject({ suppressed: false, n: 0 });
  });

  it("refuses a minimum group size below 2", () => {
    expect(() => suppress([], null, 1)).toThrow();
  });
});
