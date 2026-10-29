import { chart, type ThemeMode } from "./tokens";

// Chart colours from the boards (docs/DESIGN_SYSTEM.md §1.5): fixed slot order, never cycled; the dark values are stepped for the dark surface, not a flip.
// Every chart also carries a legend with labels and values, so colour is never the only signal.
export function useChartColors(mode: ThemeMode) {
  const c = chart[mode];
  return {
    categorical: c.categorical,
    sequential: c.categorical[0]!,
    positive: c.positive,
    negative: c.negative,
    track: c.track,
    ink: { primary: c.ink, secondary: c.muted, muted: c.muted, grid: c.grid },
  };
}
