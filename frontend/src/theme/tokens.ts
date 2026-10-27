// The design tokens (docs/DESIGN_SYSTEM.md §1–3) — the ONLY place in src/ where a colour or a font size is written as a literal. Everything else uses:
//   - `v.*` — CSS variables (`var(--ws-…)`), which follow the theme without a hook (safe in plain objects, inline styles and module constants);
//   - `fs.*`, `space.*`, `radius.*`, `control.*` — the type scale and sizes (plain numbers);
//   - Ant Design's own tokens (`theme.useToken()`), configured from these values in antdTheme.ts.
// `npm run lint` fails on a hex/rgb colour or a numeric fontSize anywhere else (eslint.config.mjs + scripts/check-design-tokens.mjs), and src/theme/__tests__ checks
// that every light token has a dark twin and that the text pairs below meet WCAG AA.

export type ThemeMode = "light" | "dark";

/** Every semantic colour. Both themes must define every key (theme.test.ts). Values sampled from the boards; ⚑ = darkened for AA (DESIGN_SYSTEM.md §10). */
export interface Palette {
  bgPage: string;
  bgSurface: string;
  bgSubtle: string;
  bgTableHeader: string;
  bgReadonly: string;
  bgOverlay: string;
  bgHover: string;
  borderDefault: string;
  borderControl: string;
  textPrimary: string;
  textBody: string;
  textSecondary: string;
  textPlaceholder: string;
  textOnRaised: string;
  textInverse: string;
  primary: string;
  primaryText: string;
  primaryHover: string;
  accent: string;
  accentText: string;
  accentSubtle: string;
  accentSelected: string;
  navActive: string;
  navActiveText: string;
  navGlow: string;
  edit: string;
  view: string;
  danger: string;
  dangerSubtle: string;
  warning: string;
  warningText: string;
  warningSubtle: string;
  info: string;
  infoText: string;
  infoSubtle: string;
  success: string;
  chipSuccessBg: string;
  chipSuccessText: string;
  chipWarningBg: string;
  chipWarningText: string;
  chipPurpleBg: string;
  chipPurpleText: string;
  chipDangerBg: string;
  chipDangerText: string;
  chipNeutralBg: string;
  chipNeutralText: string;
  chipInfoBg: string;
  chipInfoText: string;
  focusRing: string;
  skeleton: string;
  skeletonShine: string;
  shadowColor: string;
  // Attendance day colours (UI_REFERENCE §1.5): present, absent, half day, holiday, week-off, leave.
  attPBg: string;
  attPFg: string;
  attABg: string;
  attAFg: string;
  attHdBg: string;
  attHdFg: string;
  attHBg: string;
  attHFg: string;
  attOBg: string;
  attOFg: string;
  attLBg: string;
  attLFg: string;
  // Illustrations (EmptyState etc.): line, fill and accent strokes.
  illoLine: string;
  illoFill: string;
  illoAccent: string;
  illoAccentSoft: string;
  // Demo company banner (kept exactly as before: a warning strip).
  demoBg: string;
  demoText: string;
  demoBorder: string;
}

export const light: Palette = {
  bgPage: "#FAFAFA",
  bgSurface: "#FFFFFF",
  bgSubtle: "#F8F8F8",
  bgTableHeader: "#FAFAFA",
  bgReadonly: "#F3F4F6",
  bgOverlay: "rgba(0, 0, 0, 0.5)",
  bgHover: "#F5F6F7",
  borderDefault: "#EAEAEA",
  borderControl: "#DADDE2", // ⚑ board #F0F0F0
  textPrimary: "#121828",
  textBody: "#2C2B31",
  textSecondary: "#6B7079", // ⚑ board #8A8C91
  textPlaceholder: "#70757D", // ⚑ board #C1C3C7
  textOnRaised: "#6B7079",
  textInverse: "#FFFFFF",
  primary: "#121828",
  primaryText: "#FFFFFF",
  primaryHover: "#252D40",
  accent: "#28A174",
  accentText: "#1A7F5A", // ⚑ board #28A174
  accentSubtle: "#EAF6F2",
  accentSelected: "#1A7F5A",
  navActive: "#0A8048", // ⚑ board #0CAD5D
  navActiveText: "#FFFFFF",
  navGlow: "rgba(12, 173, 93, 0.25)",
  edit: "#1F66D1", // ⚑ board #2D7AEF
  view: "#1E8A62", // ⚑ board #24A676
  danger: "#D12E2E", // ⚑ board #ED3838
  dangerSubtle: "#FCEDEC",
  warning: "#FFCF25",
  warningText: "#8A6D00",
  warningSubtle: "#FFF5D0",
  info: "#2D7AEF",
  infoText: "#1F5FC4", // ⚑ board #2D7AEF
  infoSubtle: "#ECF3FD",
  success: "#28A174",
  chipSuccessBg: "#EAF6F2",
  chipSuccessText: "#1B7A56",
  chipWarningBg: "#FFF5D0",
  chipWarningText: "#8A6D00",
  chipPurpleBg: "#F1EDFF",
  chipPurpleText: "#6A3FD9",
  chipDangerBg: "#FCEDEC",
  chipDangerText: "#C0262D",
  chipNeutralBg: "#F1F2F4",
  chipNeutralText: "#4B5059",
  chipInfoBg: "#ECF3FD",
  chipInfoText: "#1F5FC4",
  focusRing: "#28A174",
  skeleton: "#F1F2F4",
  skeletonShine: "#F8F8F9",
  shadowColor: "rgba(18, 24, 40, 0.08)",
  attPBg: "#EAF6F2",
  attPFg: "#1B7A56",
  attABg: "#FCEDEC",
  attAFg: "#C0262D",
  attHdBg: "#FFF5D0",
  attHdFg: "#8A6D00",
  attHBg: "#ECF3FD",
  attHFg: "#1F5FC4",
  attOBg: "#F3F4F6",
  attOFg: "#4B5059",
  attLBg: "#F1EDFF",
  attLFg: "#6A3FD9",
  illoLine: "#C3C7CD",
  illoFill: "#F3F4F6",
  illoAccent: "#28A174",
  illoAccentSoft: "#CDEBDF",
  demoBg: "#FFF5D0",
  demoText: "#5C4A00",
  demoBorder: "#F0DC8C",
};

export const dark: Palette = {
  bgPage: "#121828",
  bgSurface: "#202938",
  bgSubtle: "#303948",
  bgTableHeader: "#303948",
  bgReadonly: "#303948",
  bgOverlay: "rgba(0, 0, 0, 0.6)",
  bgHover: "#283142",
  borderDefault: "#2C3545",
  borderControl: "#4A5363", // ⚑ board #3C4554
  textPrimary: "#FFFFFF",
  textBody: "#E1E8F0",
  textSecondary: "#8C95A4", // ⚑ board #5E6776
  textPlaceholder: "#8C95A4",
  textOnRaised: "#C6CFDE",
  textInverse: "#121828",
  primary: "#FFFFFF",
  primaryText: "#121828",
  primaryHover: "#E6E9EE",
  accent: "#28A174",
  accentText: "#34C08E", // ⚑ board #28A174
  accentSubtle: "#1E3B33",
  accentSelected: "#1A7F5A",
  navActive: "#0A8048",
  navActiveText: "#FFFFFF",
  navGlow: "rgba(12, 173, 93, 0.22)",
  edit: "#4D8FF5",
  view: "#28A174",
  danger: "#F06A6A",
  dangerSubtle: "#3A2228",
  warning: "#E0B300",
  warningText: "#E0B300",
  warningSubtle: "#3A3320",
  info: "#4D8FF5",
  infoText: "#8DB6F7",
  infoSubtle: "#1B2A45",
  success: "#34C08E",
  // The board keeps light chips on the dark surface (DESIGN_SYSTEM.md §1.4).
  chipSuccessBg: "#EAF6F2",
  chipSuccessText: "#1B7A56",
  chipWarningBg: "#FFF5D0",
  chipWarningText: "#8A6D00",
  chipPurpleBg: "#F1EDFF",
  chipPurpleText: "#6A3FD9",
  chipDangerBg: "#FCEDEC",
  chipDangerText: "#C0262D",
  chipNeutralBg: "#E4E7EC",
  chipNeutralText: "#363B45",
  chipInfoBg: "#ECF3FD",
  chipInfoText: "#1F5FC4",
  focusRing: "#34C08E",
  skeleton: "#2A3343",
  skeletonShine: "#343E50",
  shadowColor: "rgba(0, 0, 0, 0.4)",
  attPBg: "#1E3B33",
  attPFg: "#5FD3A8",
  attABg: "#3A2228",
  attAFg: "#F58C8C",
  attHdBg: "#3A3320",
  attHdFg: "#F0C94A",
  attHBg: "#1B2A45",
  attHFg: "#8DB6F7",
  attOBg: "#283142",
  attOFg: "#A7AEB7",
  attLBg: "#2C2647",
  attLFg: "#B9A3FF",
  illoLine: "#5B6577",
  illoFill: "#283142",
  illoAccent: "#34C08E",
  illoAccentSoft: "#1E3B33",
  demoBg: "#3A3320",
  demoText: "#F6E3A1",
  demoBorder: "#5C4F23",
};

export const palettes: Record<ThemeMode, Palette> = { light, dark };

/** Text-on-surface pairs that must meet WCAG AA (4.5:1) in both themes; checked by src/theme/__tests__/theme.test.ts. */
export const AA_TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ["textPrimary", "bgSurface"],
  ["textPrimary", "bgPage"],
  ["textBody", "bgSurface"],
  ["textSecondary", "bgSurface"],
  ["textSecondary", "bgPage"],
  ["textPlaceholder", "bgSurface"],
  ["textOnRaised", "bgTableHeader"],
  ["primaryText", "primary"],
  ["accentText", "bgSurface"],
  ["navActiveText", "navActive"],
  ["infoText", "infoSubtle"],
  ["warningText", "warningSubtle"],
  ["chipSuccessText", "chipSuccessBg"],
  ["chipWarningText", "chipWarningBg"],
  ["chipPurpleText", "chipPurpleBg"],
  ["chipDangerText", "chipDangerBg"],
  ["chipNeutralText", "chipNeutralBg"],
  ["chipInfoText", "chipInfoBg"],
  ["attPFg", "attPBg"],
  ["attAFg", "attABg"],
  ["attHdFg", "attHdBg"],
  ["attHFg", "attHBg"],
  ["attOFg", "attOBg"],
  ["attLFg", "attLBg"],
  ["demoText", "demoBg"],
];

const cssName = (key: string) => `--ws-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** CSS variable references for every palette key: `v.textSecondary` → `var(--ws-text-secondary)`. */
export const v = Object.fromEntries(Object.keys(light).map((k) => [k, `var(${cssName(k)})`])) as Record<keyof Palette, string>;

/** The `--ws-*` declarations for one theme (applied to <html> by applyThemeVars). */
export function cssVarsFor(mode: ThemeMode): Record<string, string> {
  const p = palettes[mode];
  const vars: Record<string, string> = {};
  for (const [k, val] of Object.entries(p)) vars[cssName(k)] = val;
  return vars;
}

// ── Type scale (DESIGN_SYSTEM.md §2) ──────────────────────────────────────
export const fontFamily = '"Manrope Variable", Manrope, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

export const fs = {
  chip: 10,
  xs: 11,
  sm: 12, // caption, helper text, timestamps
  table: 13, // table cells and headers
  md: 14, // body
  lg: 16, // buttons, sidebar items, labels
  xl: 18, // h3
  h2: 20,
  h1: 24,
  authH1: 26,
  stat: 32,
  display: 40,
} as const;

export const fw = { regular: 400, medium: 500, semibold: 600, bold: 700 } as const;

// ── Spacing, radii, sizes (DESIGN_SYSTEM.md §3) ───────────────────────────
export const space = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 } as const;
export const radius = { xs: 6, sm: 8, md: 12, lg: 16, pill: 999 } as const;
export const control = { lg: 48, md: 40, sm: 32, touch: 44 } as const;

export const layout = {
  sidebar: 280,
  sidebarCollapsed: 76,
  topbar: 80,
  contentMax: 1600,
  drawer: 440,
  drawerWide: 640,
  drawerXWide: 960,
  phoneTabBar: 64,
} as const;

export const breakpoints = { phone: 768, desktop: 1280, wide: 1920 } as const;

export const motion = { fast: 150, base: 180, slow: 240, easing: "cubic-bezier(0.2, 0, 0, 1)" } as const;

export const shadow = {
  popover: `0 8px 24px ${"var(--ws-shadow-color)"}`,
  drawer: `-8px 0 32px ${"var(--ws-shadow-color)"}`,
  navGlow: "0 8px 20px var(--ws-nav-glow)",
  segment: "0 2px 6px var(--ws-shadow-color)",
  card: "none",
} as const;

// ── Charts (DESIGN_SYSTEM.md §1.5): fixed slot order, never cycled ────────
export const chart: Record<ThemeMode, { categorical: string[]; track: string; grid: string; ink: string; muted: string; positive: string; negative: string }> = {
  light: {
    categorical: ["#28A174", "#FFCF25", "#2B7BFA", "#8D61FC", "#2CD5BE", "#FC964B"],
    track: "#F3F4F6",
    grid: "#EAEAEA",
    ink: "#121828",
    muted: "#6B7079",
    positive: "#28A174",
    negative: "#D12E2E",
  },
  dark: {
    categorical: ["#34C08E", "#F0C94A", "#4D8FF5", "#A585FF", "#2CD5BE", "#FC964B"],
    track: "#303948",
    grid: "#2C3545",
    ink: "#FFFFFF",
    muted: "#8C95A4",
    positive: "#34C08E",
    negative: "#F06A6A",
  },
};

// Attendance status colours (docs/UI_REFERENCE.md §1.5), as CSS variables so they follow the theme without a hook.
export const attendanceStatusColor: Record<string, { bg: string; fg: string }> = {
  P: { bg: v.attPBg, fg: v.attPFg },
  A: { bg: v.attABg, fg: v.attAFg },
  HD: { bg: v.attHdBg, fg: v.attHdFg },
  H: { bg: v.attHBg, fg: v.attHFg },
  O: { bg: v.attOBg, fg: v.attOFg },
  L: { bg: v.attLBg, fg: v.attLFg },
  LOP: { bg: v.attABg, fg: v.attAFg },
};
