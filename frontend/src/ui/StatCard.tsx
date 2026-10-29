import type { ReactNode } from "react";
import { Tooltip } from "antd";
import { ArrowDownOutlined, ArrowUpOutlined, InfoCircleOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../theme/tokens";
import { Skel } from "./Skeletons";

export interface StatCardProps {
  label: ReactNode;
  value: ReactNode;
  icon?: ReactNode;
  /** A delta chip: only from figures the API returns, never invented. */
  delta?: { text: string; direction: "up" | "down"; good?: boolean };
  hint?: ReactNode;
  info?: string;
  loading?: boolean;
  onClick?: () => void;
  /** "compact": the attendance-style tile (title + info icon, value below). */
  variant?: "default" | "compact";
  /** Accent colour for the icon circle. */
  tone?: "accent" | "info" | "warning" | "danger" | "neutral";
}

const ICON_TONES = {
  accent: { bg: v.accentSubtle, fg: v.accentText },
  info: { bg: v.infoSubtle, fg: v.infoText },
  warning: { bg: v.warningSubtle, fg: v.warningText },
  danger: { bg: v.dangerSubtle, fg: v.danger },
  neutral: { bg: v.bgSubtle, fg: v.textSecondary },
};

// The board's stat cell (home-02): 48px icon circle, big number, delta chip, label. Compact variant: attendance-01's tiles.
export function StatCard({ label, value, icon, delta, hint, info, loading, onClick, variant = "default", tone = "neutral" }: StatCardProps) {
  const it = ICON_TONES[tone];
  const clickable = Boolean(onClick);
  const body =
    variant === "compact" ? (
      <>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: space[2] }}>
          <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{label}</span>
          {info && (
            <Tooltip title={info}>
              <InfoCircleOutlined aria-label={info} style={{ color: v.textSecondary }} />
            </Tooltip>
          )}
        </div>
        <div className="ws-num" style={{ marginTop: space[2], fontSize: fs.lg, color: v.textSecondary, fontWeight: fw.medium }}>
          {loading ? <Skel w="40%" h={18} /> : value}
        </div>
        {hint && <div style={{ marginTop: space[1], fontSize: fs.sm, color: v.textSecondary }}>{hint}</div>}
      </>
    ) : (
      <>
        {icon && (
          <span aria-hidden style={{ width: 48, height: 48, borderRadius: radius.pill, background: it.bg, color: it.fg, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.h2, marginBottom: space[4] }}>
            {icon}
          </span>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: space[3], flexWrap: "wrap" }}>
          <span className="ws-num" style={{ fontSize: fs.stat, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.15 }}>
            {loading ? <Skel w={90} h={32} /> : value}
          </span>
          {delta && !loading && (
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                padding: "2px 8px",
                borderRadius: radius.xs,
                fontSize: fs.sm,
                fontWeight: fw.semibold,
                background: (delta.good ?? delta.direction === "up") ? v.chipSuccessBg : v.chipDangerBg,
                color: (delta.good ?? delta.direction === "up") ? v.chipSuccessText : v.chipDangerText,
              }}
            >
              {delta.direction === "up" ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              {delta.text}
            </span>
          )}
        </div>
        <div style={{ marginTop: space[2], fontSize: fs.md, color: v.textBody, fontWeight: fw.medium, display: "flex", alignItems: "center", gap: space[2] }}>
          {label}
          {info && (
            <Tooltip title={info}>
              <InfoCircleOutlined aria-label={info} style={{ color: v.textSecondary }} />
            </Tooltip>
          )}
        </div>
        {hint && <div style={{ marginTop: space[1], fontSize: fs.sm, color: v.textSecondary }}>{hint}</div>}
      </>
    );
  const style: React.CSSProperties = {
    background: v.bgSurface,
    border: `1px solid ${v.borderDefault}`,
    borderRadius: radius.lg,
    padding: variant === "compact" ? `${space[4]}px ${space[5]}px` : space[5],
    height: "100%",
    textAlign: "left",
    width: "100%",
    font: "inherit",
    color: "inherit",
    cursor: clickable ? "pointer" : undefined,
    transition: "transform 0.15s, box-shadow 0.15s",
  };
  return clickable ? (
    <button type="button" onClick={onClick} style={style} className="ws-stat-card">
      {body}
    </button>
  ) : (
    <div style={style}>{body}</div>
  );
}
