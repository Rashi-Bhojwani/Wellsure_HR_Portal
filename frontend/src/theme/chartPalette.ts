// Validated categorical / sequential / diverging chart colours — see the
// dataviz skill (`references/palette.md`). Fixed slot order, never cycled;
// dark values are separately-stepped for the dark surface, not a flip.

export const categorical = {
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"],
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
};

export const sequentialBlue = {
  light: "#2a78d6",
  dark: "#3987e5",
};

export const diverging = {
  positive: { light: "#2a78d6", dark: "#3987e5" }, // e.g. joined / gains
  negative: { light: "#e34948", dark: "#e66767" }, // e.g. resigned / losses
};

export const chartInk = {
  light: { primary: "#0b0b0b", secondary: "#52514e", muted: "#898781", grid: "#e1e0d9" },
  dark: { primary: "#ffffff", secondary: "#c3c2b7", muted: "#898781", grid: "#2c2c2a" },
};

export function useChartColors(mode: "light" | "dark") {
  return {
    categorical: categorical[mode],
    sequential: sequentialBlue[mode],
    positive: diverging.positive[mode],
    negative: diverging.negative[mode],
    ink: chartInk[mode],
  };
}
