import type { ReactNode } from "react";
import { v } from "../theme/tokens";
import { toneForStatus, type ChipTone } from "./statusTone";

export type { ChipTone };

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  success: { bg: v.chipSuccessBg, fg: v.chipSuccessText },
  warning: { bg: v.chipWarningBg, fg: v.chipWarningText },
  danger: { bg: v.chipDangerBg, fg: v.chipDangerText },
  purple: { bg: v.chipPurpleBg, fg: v.chipPurpleText },
  info: { bg: v.chipInfoBg, fg: v.chipInfoText },
  neutral: { bg: v.chipNeutralBg, fg: v.chipNeutralText },
};

export interface StatusChipProps {
  /** The status word; also picks the tone when `tone` is not given. */
  status?: string;
  tone?: ChipTone;
  children?: ReactNode;
  icon?: ReactNode;
  title?: string;
}

// The board's status chip (employees-01): uppercase 10px bold on a tint, 24px tall, radius 6.
export function StatusChip({ status, tone, children, icon, title }: StatusChipProps) {
  const t = TONES[tone ?? (status ? toneForStatus(status) : "neutral")];
  const label = children ?? (status ? status.replace(/_/g, " ") : "");
  return (
    <span className="ws-chip" title={title} style={{ background: t.bg, color: t.fg }}>
      {icon}
      {label}
    </span>
  );
}
