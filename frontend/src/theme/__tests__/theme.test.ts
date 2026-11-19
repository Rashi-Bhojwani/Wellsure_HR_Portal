// Read through Vite's ?raw import (typed by vite/client), so this test needs no Node typings in the app tsconfig.
import indexHtml from "../../../index.html?raw";
import { describe, expect, it } from "vitest";
import { AA_TEXT_PAIRS, AA_UI_PAIRS, chart, cssVarsFor, dark, light, palettes, v, type Palette } from "../tokens";
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

  it("non-text UI pairs meet WCAG AA (3:1) in both themes: control outlines, checked fills, focus ring, marker edge, row-action icons", () => {
    for (const mode of ["light", "dark"] as const) {
      const p: Palette = palettes[mode];
      for (const [fg, bg] of AA_UI_PAIRS) {
        expect(contrast(p[fg], p[bg]), `${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("the Wellsure brand: yellow #FFF605 primary with ink text in both themes, never yellow as text on a light surface", () => {
    for (const p of [light, dark]) {
      expect(p.primary).toBe("#FFF605");
      expect(p.primaryText).toBe("#0B0B0B");
    }
    expect(light.primaryHover).toBe("#F2E900");
    expect(light.primaryActive).toBe("#DBD000");
    // Brand yellow as text on a light background would be 1.1:1: no such pair may exist (yellow on ink is fine).
    for (const mode of ["light", "dark"] as const) {
      const p: Palette = palettes[mode];
      for (const [fg, bg] of AA_TEXT_PAIRS) if (p[fg] === "#FFF605") expect(luminance(p[bg]), `${mode}: ${fg} on ${bg}`).toBeLessThan(0.2);
    }
    expect(light.accentText).toBe("#8A6D00");
    expect(dark.accentText).toBe("#FFF35C");
  });

  it("the Ant Design theme's own text colours meet 4.5:1 on its backgrounds in both themes", () => {
    for (const mode of ["light", "dark"] as const) {
      const t = antdThemeFor(mode).token!;
      for (const fg of ["colorText", "colorTextHeading", "colorTextSecondary", "colorTextPlaceholder", "colorLink", "colorError"] as const) {
        for (const bg of ["colorBgContainer", "colorBgLayout"] as const) {
          expect(contrast(t[fg] as string, t[bg] as string), `${mode}: ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      const b = antdThemeFor(mode).components!.Button!;
      expect(contrast(b.primaryColor as string, b.colorPrimary as string), `${mode}: primary button label`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(b.primaryColor as string, b.colorPrimaryHover as string), `${mode}: primary button label, hover`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(b.primaryColor as string, b.colorPrimaryActive as string), `${mode}: primary button label, pressed`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("chart marks keep 3:1 on the card, and chart text 4.5:1, in both themes", () => {
    for (const mode of ["light", "dark"] as const) {
      const surface = palettes[mode].bgSurface;
      for (const c of [...chart[mode].categorical, chart[mode].positive, chart[mode].negative]) expect(contrast(c, surface), `${mode}: chart ${c}`).toBeGreaterThanOrEqual(3);
      expect(contrast(chart[mode].ink, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(chart[mode].muted, surface)).toBeGreaterThanOrEqual(4.5);
    }
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
    const html = indexHtml;
    expect(html).toContain(`dark ? "${dark.bgPage}" : "${light.bgPage}"`);
    expect(html).toContain(`dark ? "${dark.textBody}" : "${light.textBody}"`);
  });
});
