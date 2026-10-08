import { theme } from "antd";

// Shared by the muster grid and its legend (Phase 2 P2-D).

export const cellKey = (employeeId: string, date: string) => `${employeeId}|${date}`;

export interface CellTone {
  background: string;
  color: string;
}

/** Colours per code, from the theme's tokens (works in dark mode too). */
export function useCellTones() {
  const { token } = theme.useToken();
  return (code: string | null): CellTone => {
    if (!code) return { background: "transparent", color: token.colorTextQuaternary };
    if (code === "P") return { background: token.colorSuccessBg, color: token.colorSuccessText };
    if (code === "A") return { background: token.colorErrorBg, color: token.colorErrorText };
    if (code === "OFF" || code === "H") return { background: token.colorFillTertiary, color: token.colorTextTertiary };
    if (code === "NM" || code === "NS") return { background: "transparent", color: token.colorTextTertiary };
    if (code === "HD" || /^(P:A|A:P)$/.test(code)) return { background: token.colorWarningBg, color: token.colorWarningText };
    return { background: token.colorInfoBg, color: token.colorInfoText }; // leave codes and leave splits
  };
}

