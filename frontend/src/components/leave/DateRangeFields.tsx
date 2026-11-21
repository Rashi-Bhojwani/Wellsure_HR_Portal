import { DatePicker } from "antd";
import type { Dayjs } from "dayjs";
import { space } from "../../theme/tokens";

// FIX-M10 (independent audit 2026-11-20): the Apply leave "From" box trapped keyboard focus: Tab and Esc could not leave Ant Design's RangePicker. Two plain date
// boxes, "From" and "To", are two ordinary inputs in the tab order: Tab moves from From to To and on, Shift+Tab back, Esc closes an open calendar and leaves focus
// on its box. The value is still [from, to], so the form and the API are unchanged.
export interface DateRangeFieldsProps {
  value?: [Dayjs | null, Dayjs | null] | null;
  onChange?: (value: [Dayjs | null, Dayjs | null]) => void;
  format?: string;
  fromLabel?: string;
  toLabel?: string;
}

export function DateRangeFields({ value, onChange, format = "DD MMM YYYY", fromLabel = "From", toLabel = "To" }: DateRangeFieldsProps) {
  const [from, to] = value ?? [null, null];
  return (
    <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
      <DatePicker
        id="leave-from"
        aria-label={fromLabel}
        placeholder={fromLabel}
        format={format}
        value={from}
        style={{ flex: "1 1 160px" }}
        onChange={(d) => onChange?.([d, to && d && to.isBefore(d, "day") ? d : to])}
      />
      <DatePicker
        id="leave-to"
        aria-label={toLabel}
        placeholder={toLabel}
        format={format}
        value={to}
        style={{ flex: "1 1 160px" }}
        disabledDate={(d) => !!from && d.isBefore(from, "day")}
        onChange={(d) => onChange?.([from, d])}
      />
    </div>
  );
}
