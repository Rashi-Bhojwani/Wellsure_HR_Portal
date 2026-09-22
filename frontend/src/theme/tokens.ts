import type { ThemeConfig } from "antd";

// Our own brand tokens — never greytHR's. See docs/UI_REFERENCE.md
// "General visual style": light grey background, white cards, medium
// blue accent, green for money, soft orange/red for problem states.
export const brand = {
  primary: "#2f6fed",
  success: "#1a9c5e",
  warning: "#e08a1e",
  danger: "#d84c3f",
  info: "#2f6fed",
};

export const lightTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.primary,
    colorSuccess: brand.success,
    colorWarning: brand.warning,
    colorError: brand.danger,
    colorInfo: brand.info,
    colorBgLayout: "#f4f5f7",
    colorBgContainer: "#ffffff",
    borderRadius: 8,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
};

export const darkTheme: ThemeConfig = {
  token: {
    colorPrimary: brand.primary,
    colorSuccess: brand.success,
    colorWarning: brand.warning,
    colorError: brand.danger,
    colorInfo: brand.info,
    colorBgLayout: "#101418",
    colorBgContainer: "#1a1f26",
    borderRadius: 8,
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  },
};

// Attendance status colours (docs/UI_REFERENCE.md §1.5): light green =
// present, light orange/peach = absent/exception, light blue = holiday,
// white/grey = week-off.
export const attendanceStatusColor: Record<string, { bg: string; fg: string }> = {
  P: { bg: "#e6f7ee", fg: "#1a9c5e" },
  A: { bg: "#fdece9", fg: "#d84c3f" },
  HD: { bg: "#fdf2e3", fg: "#e08a1e" },
  H: { bg: "#e8f0fe", fg: "#2f6fed" },
  O: { bg: "#f4f5f7", fg: "#6b7280" },
  L: { bg: "#eef1ff", fg: "#5b5bd6" },
  LOP: { bg: "#fdece9", fg: "#d84c3f" },
};
