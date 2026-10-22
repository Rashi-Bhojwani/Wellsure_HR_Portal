import { Tag } from "antd";
import type { SetupStatus } from "../../api/payroll";

const TAG: Record<SetupStatus, { color: string; label: string }> = {
  CONFIRMED: { color: "green", label: "Confirmed" },
  PLACEHOLDER: { color: "orange", label: "Placeholder" },
  NOT_SET: { color: "default", label: "Not set" },
};

export function SetupStatusTag({ status }: { status: SetupStatus }) {
  return <Tag color={TAG[status].color}>{TAG[status].label}</Tag>;
}
