import { ApprovalBanner } from "../../ui";

// The leave encashment daily rate is still a flat HR-entered amount
// (System Settings → Leave), pending the owners' confirmation of the formula
// and its tax treatment (spec §5.2, docs/PROGRESS.md open questions). Shown
// wherever a rupee amount is computed from it — Year End Process and the
// Leave liability report — so nobody mistakes an estimate for a final figure.
export function ProvisionalRateAlert({ rateMissing = false }: { rateMissing?: boolean }) {
  return (
    <ApprovalBanner
      tone="warning"
      title={rateMissing ? "No encashment rate is set — showing days only" : "Encashment rate is provisional"}
      description={
        rateMissing
          ? "Set the default daily rate in System Settings → Leave to see rupee amounts. The rate itself is still awaiting the owners' confirmation of the encashment formula and its tax treatment (spec §5.2)."
          : "Amounts use the flat daily rate set in System Settings → Leave, pending the owners' confirmation of the encashment formula and its tax treatment (spec §5.2). Treat them as estimates until then."
      }
    />
  );
}
