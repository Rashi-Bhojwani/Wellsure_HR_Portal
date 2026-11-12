import type { ChipTone } from "../ui/statusTone";

// The words for where a loan's recovery stands (backend loans/service.ts recoveryOf). Shared by the directors' and the employee's loan screens.
export const RECOVERY_LABEL: Record<string, { text: string; tone: ChipTone }> = {
  NOT_PAID_OUT: { text: "Sanctioned, paid with the next run", tone: "info" },
  RECOVERING: { text: "Recovering", tone: "success" },
  STOPPED: { text: "Recovery stopped", tone: "warning" },
  FULLY_RECOVERED: { text: "Fully recovered", tone: "neutral" },
  RECOVERED_AT_EXIT: { text: "Recovered at exit", tone: "neutral" },
};
