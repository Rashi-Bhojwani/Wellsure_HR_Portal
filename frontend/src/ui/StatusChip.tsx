import type { ReactNode } from "react";
import { v } from "../theme/tokens";

export type ChipTone = "success" | "warning" | "danger" | "purple" | "info" | "neutral";

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  success: { bg: v.chipSuccessBg, fg: v.chipSuccessText },
  warning: { bg: v.chipWarningBg, fg: v.chipWarningText },
  danger: { bg: v.chipDangerBg, fg: v.chipDangerText },
  purple: { bg: v.chipPurpleBg, fg: v.chipPurpleText },
  info: { bg: v.chipInfoBg, fg: v.chipInfoText },
  neutral: { bg: v.chipNeutralBg, fg: v.chipNeutralText },
};

// Common status words → tone. Anything unknown is neutral. The word is always shown, so colour is never the only signal.
const BY_STATUS: Record<string, ChipTone> = {
  ACTIVE: "success",
  APPROVED: "success",
  APPROVE: "success",
  PUBLISHED: "success",
  PAID: "success",
  DONE: "success",
  COMPLETED: "success",
  CONFIRMED: "success",
  RESOLVED: "success",
  CLOSED: "neutral",
  PRESENT: "success",
  ONLINE: "success",
  LOCKED: "info",
  FINALISED: "info",
  SUBMITTED: "info",
  OPEN: "info",
  IN_PROGRESS: "info",
  INVITED: "purple",
  PROBATION: "purple",
  PENDING: "warning",
  DRAFT: "neutral",
  ON_HOLD: "warning",
  SILENT: "warning",
  INACTIVE: "warning",
  NOT_SET: "warning",
  REJECTED: "danger",
  CANCELLED: "neutral",
  FAILED: "danger",
  OFFLINE: "danger",
  ABSENT: "danger",
  SEPARATED: "neutral",
  ON_LEAVE: "danger",
  TEST: "warning",
};

export function toneForStatus(status: string): ChipTone {
  return BY_STATUS[status.toUpperCase().replace(/[\s-]+/g, "_")] ?? "neutral";
}

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
