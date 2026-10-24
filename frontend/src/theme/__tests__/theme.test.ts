import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AA_TEXT_PAIRS, chart, cssVarsFor, dark, light, palettes, v, type Palette } from "../tokens";
import { antdThemeFor } from "../antdTheme";

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("design tokens (docs/DESIGN_SYSTEM.md)", () => {
  it("every light token has a dark twin and vice versa", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
    for (const [k, val] of Object.entries(dark)) expect(val, `dark.${k}`).toBeTruthy();
  });

  it("every token is a valid colour", () => {
    for (const mode of ["light", "dark"] as const) {
      for (const [k, val] of Object.entries(palettes[mode])) {
        expect(val, `${mode}.${k}`).toMatch(/^(#[0-9A-Fa-f]{6}|rgba\(\d+, \d+, \d+, [\d.]+\))$/);
      }
    }
  });

  it("text pairs meet WCAG AA (4.5:1) in both themes", () => {
    for (const mode of ["light", "dark"] as const) {
      const p: Palette = palettes[mode];
      for (const [fg, bg] of AA_TEXT_PAIRS) {
        expect(contrast(p[fg], p[bg]), `${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the accent fill keeps 3:1 against the surface (non-text UI)", () => {
    expect(contrast(light.accent, light.bgSurface)).toBeGreaterThanOrEqual(3);
    expect(contrast(dark.accent, dark.bgSurface)).toBeGreaterThanOrEqual(3);
  });

  it("CSS variables exist for every key, and v.* points at them", () => {
    const vars = cssVarsFor("dark");
    expect(Object.keys(vars)).toHaveLength(Object.keys(dark).length);
    expect(v.textSecondary).toBe("var(--ws-text-secondary)");
    expect(vars["--ws-text-secondary"]).toBe(dark.textSecondary);
  });

  it("charts have the same number of slots in both themes", () => {
    expect(chart.dark.categorical).toHaveLength(chart.light.categorical.length);
  });

  it("the Ant Design theme is built from the tokens in both modes", () => {
    expect(antdThemeFor("light").token?.colorBgLayout).toBe(light.bgPage);
    expect(antdThemeFor("dark").token?.colorBgLayout).toBe(dark.bgPage);
    expect(antdThemeFor("dark").components?.Button?.colorPrimary).toBe(dark.primary);
  });

  it("index.html's before-first-paint colours equal the tokens (no flash)", () => {
    const html = readFileSync(path.resolve(import.meta.dirname, "../../../index.html"), "utf8");
    expect(html).toContain(`dark ? "${dark.bgPage}" : "${light.bgPage}"`);
    expect(html).toContain(`dark ? "${dark.textBody}" : "${light.textBody}"`);
  });
});
