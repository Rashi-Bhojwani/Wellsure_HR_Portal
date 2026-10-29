import { createElement, type ReactNode } from "react";
import { fs, fw, v } from "../../theme/tokens";

// Non-component helpers shared by the auth pages (kept apart from authParts.tsx for fast refresh).

/** The board's required mark: a red asterisk after the label (antd's default puts it before). */
export function requiredMark(label: ReactNode, { required }: { required: boolean }): ReactNode {
  return createElement(
    "span",
    { style: { fontWeight: fw.medium } },
    label,
    required ? createElement("span", { "aria-hidden": true, style: { color: v.danger, marginLeft: 4 } }, "*") : null,
  );
}

/** One large centred code field (auth-08's OTP boxes, as a single input so paste, autofill and backup codes keep working). */
export const codeInputStyle = { textAlign: "center", fontSize: fs.h1, fontWeight: fw.semibold, letterSpacing: "0.3em", fontVariantNumeric: "tabular-nums" } as const;
