import dayjs, { type Dayjs } from "dayjs";
import { Tag, Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";

// Effective dating in the UI (EF3, docs/plans/EFFECTIVE_DATES.md): a change
// dated today or earlier takes effect now; one dated later is SCHEDULED —
// stored now, in force on its day, cancellable until then.

export type HistoryStatus = "past" | "current" | "scheduled";

const longDate = (iso: string) => dayjs(iso).format("D MMM YYYY");

/** The line under an "Effective from" picker. */
export function EffectiveDateHint({ value }: { value?: Dayjs | null }) {
  if (!value) return null;
  return value.isAfter(dayjs(), "day") ? (
    <Typography.Text type="warning">
      <ClockCircleOutlined /> Scheduled — takes effect on {value.format("D MMM YYYY")}. It can be cancelled from the history until then.
    </Typography.Text>
  ) : (
    <Typography.Text type="secondary">Takes effect now.</Typography.Text>
  );
}

/** "Current" / "Scheduled from 1 Nov 2026" / the end date, for a history table's To column. */
export function HistoryStatusCell({ status, effectiveFrom, effectiveTo }: { status: HistoryStatus; effectiveFrom: string; effectiveTo: string | null }) {
  if (status === "scheduled") return <Tag color="gold" icon={<ClockCircleOutlined />}>Scheduled from {longDate(effectiveFrom)}</Tag>;
  if (status === "current") return <Tag color="green">Current</Tag>;
  // Stored end dates are exclusive (the next row's start); show the last day covered.
  return <>until {effectiveTo ? dayjs(effectiveTo).subtract(1, "day").format("D MMM YYYY") : "—"}</>;
}
