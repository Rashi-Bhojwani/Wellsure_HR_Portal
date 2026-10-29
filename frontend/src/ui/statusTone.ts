export type ChipTone = "success" | "warning" | "danger" | "purple" | "info" | "neutral";

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
