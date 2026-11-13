// The design tokens (docs/DESIGN_SYSTEM.md §1–3) — the ONLY place in src/ where a colour or a font size is written as a literal. Everything else uses:
//   - `v.*` — CSS variables (`var(--ws-…)`), which follow the theme without a hook (safe in plain objects, inline styles and module constants);
//   - `fs.*`, `space.*`, `radius.*`, `control.*` — the type scale and sizes (plain numbers);
//   - Ant Design's own tokens (`theme.useToken()`), configured from these values in antdTheme.ts.
// `npm run lint` fails on a hex/rgb colour or a numeric fontSize anywhere else (eslint.config.mjs + scripts/check-design-tokens.mjs), and src/theme/__tests__ checks
// that every light token has a dark twin and that the text pairs below meet WCAG AA.

export type ThemeMode = "light" | "dark";

/** Every semantic colour. Both themes must define every key (theme.test.ts). Wellsure brand palette (DESIGN_SYSTEM.md §1); every pair the UI draws is checked for WCAG AA in theme.test.ts. */
export interface Palette {
  bgPage: string;
  bgSurface: string;
  bgSubtle: string;
  bgTableHeader: string;
  bgReadonly: string;
  bgOverlay: string;
  bgHover: string;
  /** The chosen option of a Segmented control: must stand off its track (bgSubtle) in both themes. */
  bgSegmentSelected: string;
  /** Disabled controls (buttons): visibly inert, never mistaken for an enabled button. */
  bgDisabled: string;
  borderDisabled: string;
  textDisabled: string;
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
  /** Pressed primary button. */
  primaryActive: string;
  accent: string;
  /** Text or a mark drawn on an `accent` fill (today's date, a checked box). */
  accentOn: string;
  accentText: string;
  accentSubtle: string;
  accentSelected: string;
  navActive: string;
  navActiveText: string;
  navGlow: string;
  /** The selected menu item's marker bar, and its edge (keeps 3:1 on a light sidebar). */
  navMarker: string;
  navMarkerEdge: string;
  /** The sign-in page's brand panel. */
  brandPanel: string;
  brandPanelText: string;
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
  /** The inner ring between the element and focusRing (yellow in light; a page-coloured gap in dark). */
  focusRingInner: string;
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
  // Wellsure brand (2026-11 theme): brand yellow #FFF605 + ink, on a warm cream page. Yellow is a fill (buttons, markers, tints), never text on white.
  bgPage: "#FFFDF0",
  bgSurface: "#FFFFFF",
  bgSubtle: "#FFFDF0", // cream, not the yellow tint: muted text must keep 4.5:1 on it
  bgTableHeader: "#FFF8DC", // cream header row
  bgReadonly: "#F7F5E8",
  bgOverlay: "rgba(11, 11, 11, 0.5)",
  bgHover: "#FFFCE0",
  bgSegmentSelected: "#FFFFFF",
  bgDisabled: "#F3F1E4",
  borderDisabled: "#E3E0CC",
  textDisabled: "#A3A196",
  borderDefault: "#ECE8C8",
  borderControl: "#8F8C78", // 3:1 on white (input outlines are UI components)
  textPrimary: "#0B0B0B",
  textBody: "#1C1C18",
  textSecondary: "#4B4B45",
  textPlaceholder: "#75756C",
  textOnRaised: "#4B4B45",
  textInverse: "#FFFFFF",
  primary: "#FFF605",
  primaryText: "#0B0B0B",
  primaryHover: "#F2E900",
  primaryActive: "#DBD000",
  accent: "#0B0B0B", // non-text fills and borders (checkbox, switch, radio, progress, steps, selected outlines): ink on light
  accentOn: "#FFF605", // text/marks on an accent fill
  accentText: "#8A6D00", // gold: links, active labels and icons on white
  accentSubtle: "#FFFBC2", // the yellow tint: selection, range bands, icon tiles
  accentSelected: "#0B0B0B",
  navActive: "#0B0B0B",
  navActiveText: "#FFFFFF",
  navGlow: "rgba(219, 208, 0, 0.35)",
  navMarker: "#FFF605",
  navMarkerEdge: "#0B0B0B",
  brandPanel: "#0B0B0B",
  brandPanelText: "#FFFFFF",
  edit: "#2F6FED",
  view: "#0E8A7C",
  danger: "#D14040", // brief #D64545 darkened just enough for 4.5:1 (white text on it, and as text on cream)
  dangerSubtle: "#FCEBEA",
  warning: "#E5A100",
  warningText: "#7A5F00",
  warningSubtle: "#FFF4CC",
  info: "#2F6FED",
  infoText: "#1F55C0",
  infoSubtle: "#EAF1FE",
  success: "#1F9D55",
  chipSuccessBg: "#E6F5EC",
  chipSuccessText: "#16723E",
  chipWarningBg: "#FFF4CC",
  chipWarningText: "#7A5F00",
  chipPurpleBg: "#EFEDFD",
  chipPurpleText: "#5443C9",
  chipDangerBg: "#FCEBEA",
  chipDangerText: "#B3302F",
  chipNeutralBg: "#F1EFE3",
  chipNeutralText: "#4B4B45",
  chipInfoBg: "#EAF1FE",
  chipInfoText: "#1F55C0",
  focusRing: "#0B0B0B",
  focusRingInner: "#FFF605",
  skeleton: "#F3F0DE",
  skeletonShine: "#FAF8EC",
  shadowColor: "rgba(11, 11, 11, 0.08)",
  attPBg: "#E6F5EC",
  attPFg: "#16723E",
  attABg: "#FCEBEA",
  attAFg: "#B3302F",
  attHdBg: "#FFF4CC",
  attHdFg: "#7A5F00",
  attHBg: "#EAF1FE",
  attHFg: "#1F55C0",
  attOBg: "#F1EFE3",
  attOFg: "#4B4B45",
  attLBg: "#EFEDFD",
  attLFg: "#5443C9",
  illoLine: "#B9B59A",
  illoFill: "#FFFDF0",
  illoAccent: "#F2E900",
  illoAccentSoft: "#FFFBC2",
  demoBg: "#FFF4CC",
  demoText: "#5C4A00",
  demoBorder: "#EAD889",
};

export const dark: Palette = {
  bgPage: "#0E0E0C",
  bgSurface: "#181815",
  bgSubtle: "#22221E", // raised
  bgTableHeader: "#22221E",
  bgReadonly: "#22221E",
  bgOverlay: "rgba(0, 0, 0, 0.65)",
  bgHover: "#1F1F1B",
  bgSegmentSelected: "#3E3E36",
  bgDisabled: "#1D1D1A",
  borderDisabled: "#2A2A25",
  textDisabled: "#6E6D62",
  borderDefault: "#34342D",
  borderControl: "#75746A", // 3:1 on the card
  textPrimary: "#F5F3E4",
  textBody: "#E6E4D4",
  textSecondary: "#BDBBA8",
  textPlaceholder: "#9A9886",
  textOnRaised: "#BDBBA8",
  textInverse: "#0B0B0B",
  primary: "#FFF605",
  primaryText: "#0B0B0B",
  primaryHover: "#F2E900",
  primaryActive: "#DBD000",
  accent: "#FFF605",
  accentOn: "#0B0B0B",
  accentText: "#FFF35C",
  accentSubtle: "#2E2C10",
  accentSelected: "#FFF605",
  navActive: "#34342D",
  navActiveText: "#FFFFFF",
  navGlow: "rgba(255, 246, 5, 0.16)",
  navMarker: "#FFF605",
  navMarkerEdge: "#FFF605",
  brandPanel: "#181815",
  brandPanelText: "#F5F3E4",
  edit: "#2F6FED",
  view: "#0E8A7C",
  danger: "#F06A6A",
  dangerSubtle: "#3A1D1C",
  warning: "#F2B92E",
  warningText: "#F5C84C",
  warningSubtle: "#332A0E",
  info: "#5B8DF6",
  infoText: "#9BBBFA",
  infoSubtle: "#172440",
  success: "#3CC37A",
  chipSuccessBg: "#15301F",
  chipSuccessText: "#6EDC9C",
  chipWarningBg: "#332A0E",
  chipWarningText: "#F5C84C",
  chipPurpleBg: "#25213F",
  chipPurpleText: "#B4A9FF",
  chipDangerBg: "#3A1D1C",
  chipDangerText: "#FF8F8C",
  chipNeutralBg: "#2A2A25",
  chipNeutralText: "#CFCDBA",
  chipInfoBg: "#172440",
  chipInfoText: "#9BBBFA",
  focusRing: "#FFF605",
  focusRingInner: "#0E0E0C",
  skeleton: "#22221E",
  skeletonShine: "#2C2C27",
  shadowColor: "rgba(0, 0, 0, 0.5)",
  attPBg: "#15301F",
  attPFg: "#6EDC9C",
  attABg: "#3A1D1C",
  attAFg: "#FF8F8C",
  attHdBg: "#332A0E",
  attHdFg: "#F5C84C",
  attHBg: "#172440",
  attHFg: "#9BBBFA",
  attOBg: "#2A2A25",
  attOFg: "#CFCDBA",
  attLBg: "#25213F",
  attLFg: "#B4A9FF",
  illoLine: "#5A594F",
  illoFill: "#22221E",
  illoAccent: "#FFF605",
  illoAccentSoft: "#2E2C10",
  demoBg: "#332A0E",
  demoText: "#F6E3A1",
  demoBorder: "#5C4F23",
};

export const palettes: Record<ThemeMode, Palette> = { light, dark };

/** Text (and small-icon) pairs that must meet WCAG AA 4.5:1 in both themes; checked by src/theme/__tests__/theme.test.ts. */
export const AA_TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ["textPrimary", "bgSurface"],
  ["textPrimary", "bgPage"],
  ["textPrimary", "bgSubtle"],
  ["textPrimary", "accentSubtle"],
  ["textBody", "bgSurface"],
  ["textBody", "bgPage"],
  ["textBody", "bgHover"],
  ["textSecondary", "bgSurface"],
  ["textSecondary", "bgPage"],
  ["textSecondary", "bgSubtle"],
  ["textSecondary", "bgTableHeader"],
  ["textPlaceholder", "bgSurface"],
  ["textPlaceholder", "bgSubtle"],
  ["textOnRaised", "bgTableHeader"],
  ["primaryText", "primary"],
  ["primaryText", "primaryHover"],
  ["primaryText", "primaryActive"],
  ["accentOn", "accent"],
  ["accentText", "bgSurface"],
  ["accentText", "bgPage"],
  ["accentText", "accentSubtle"],
  ["accentText", "bgHover"],
  ["navActiveText", "navActive"],
  ["brandPanelText", "brandPanel"],
  ["textInverse", "danger"],
  ["danger", "bgSurface"],
  ["danger", "bgPage"],
  ["infoText", "infoSubtle"],
  ["infoText", "bgSurface"],
  ["warningText", "warningSubtle"],
  ["warningText", "bgSurface"],
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

/** Non-text UI pairs that must meet WCAG AA 3:1 (control outlines, checked/selected fills, focus ring, white icons on the square row actions). */
export const AA_UI_PAIRS: [keyof Palette, keyof Palette][] = [
  ["borderControl", "bgSurface"],
  ["accent", "bgSurface"],
  ["accent", "bgPage"],
  ["accentSelected", "bgSurface"],
  ["focusRing", "bgSurface"],
  ["focusRing", "bgPage"],
  ["navMarkerEdge", "bgSurface"],
  ["navActiveText", "edit"],
  ["navActiveText", "view"],
  ["navActiveText", "danger"],
  ["success", "bgSurface"],
  ["info", "bgSurface"],
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
  // Brand accents in a fixed slot order: teal, blue, coral, violet, orange, gold. Every mark keeps 3:1 on the card (theme.test.ts); light orange is the brief's
  // #F28C28 darkened to #C96A0E for that, and slot 6 is the gold text colour (pure yellow is invisible on white).
  light: {
    categorical: ["#0E9F8E", "#2F6FED", "#F0605D", "#6C5CE7", "#C96A0E", "#8A6D00"],
    track: "#F5F3E6",
    grid: "#ECE8C8",
    ink: "#0B0B0B",
    muted: "#4B4B45",
    positive: "#1F9D55",
    negative: "#D14040",
  },
  dark: {
    categorical: ["#2CC7B3", "#6B9BFF", "#FF7A77", "#9C8FFF", "#FFA552", "#FFF35C"],
    track: "#22221E",
    grid: "#34342D",
    ink: "#F5F3E4",
    muted: "#BDBBA8",
    positive: "#3CC37A",
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
