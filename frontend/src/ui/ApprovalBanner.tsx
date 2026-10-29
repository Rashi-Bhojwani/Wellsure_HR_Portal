import type { ReactNode } from "react";
import { CheckCircleFilled, CloseCircleFilled, ExclamationCircleFilled, InfoCircleFilled } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../theme/tokens";

export type BannerTone = "info" | "warning" | "success" | "danger";

const TONES: Record<BannerTone, { bg: string; fg: string; icon: ReactNode }> = {
  info: { bg: v.infoSubtle, fg: v.infoText, icon: <InfoCircleFilled /> },
  warning: { bg: v.warningSubtle, fg: v.warningText, icon: <ExclamationCircleFilled /> },
  success: { bg: v.chipSuccessBg, fg: v.chipSuccessText, icon: <CheckCircleFilled /> },
  danger: { bg: v.dangerSubtle, fg: v.danger, icon: <CloseCircleFilled /> },
};

export interface ApprovalBannerProps {
  tone?: BannerTone;
  title: ReactNode;
  description?: ReactNode;
  /** Approve / Reject buttons, or a link. Never optimistic for approvals or audited actions. */
  actions?: ReactNode;
  icon?: ReactNode;
  style?: React.CSSProperties;
}

// Tinted status bar (from the board's info banner, attendance-01): icon, message, actions on the right. Used for maker-checker states and page-level notices.
export function ApprovalBanner({ tone = "info", title, description, actions, icon, style }: ApprovalBannerProps) {
  const t = TONES[tone];
  return (
    <div
      role={tone === "danger" || tone === "warning" ? "alert" : "status"}
      style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[3], background: t.bg, borderRadius: radius.md, padding: `${space[3]}px ${space[4]}px`, ...style }}
    >
      <span aria-hidden style={{ color: t.fg, fontSize: fs.lg + 2, display: "inline-flex" }}>
        {icon ?? t.icon}
      </span>
      <div style={{ flex: "1 1 240px", minWidth: 0 }}>
        <div style={{ color: t.fg, fontWeight: fw.semibold, fontSize: fs.md }}>{title}</div>
        {description && <div style={{ color: v.textBody, fontSize: fs.md, marginTop: 2 }}>{description}</div>}
      </div>
      {actions && <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>{actions}</div>}
    </div>
  );
}
