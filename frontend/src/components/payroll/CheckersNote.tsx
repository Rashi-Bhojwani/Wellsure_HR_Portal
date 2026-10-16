import { Alert } from "antd";
import type { CheckerAvailability } from "../../api/payroll";

/** Who could decide this, in words. One eligible person and nobody are shown as what they are, never as a silent block. */
export function CheckersNote({ checkers, what }: { checkers: CheckerAvailability | null | undefined; what: string }) {
  if (!checkers) return null;
  const type = checkers.state === "NONE" ? "error" : checkers.state === "ONE" ? "warning" : "info";
  const title = checkers.state === "MANY" ? `Who can approve ${what}` : checkers.state === "ONE" ? `One person can approve ${what}` : `Nobody can approve ${what}`;
  return <Alert type={type} showIcon title={title} description={checkers.message} />;
}
