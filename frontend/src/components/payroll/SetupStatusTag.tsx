import { StatusChip, type ChipTone } from "../../ui";
import type { SetupStatus } from "../../api/payroll";

const TAG: Record<SetupStatus, { tone: ChipTone; label: string }> = {
  CONFIRMED: { tone: "success", label: "Confirmed" },
  PLACEHOLDER: { tone: "warning", label: "Placeholder" },
  NOT_SET: { tone: "neutral", label: "Not set" },
};

/** Not set / Placeholder / Confirmed, always in words (colour is never the only signal). */
export function SetupStatusTag({ status }: { status: SetupStatus }) {
  return <StatusChip tone={TAG[status].tone}>{TAG[status].label}</StatusChip>;
}
