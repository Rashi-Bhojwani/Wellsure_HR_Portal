import dayjs from "dayjs";
import type { ColumnsType } from "antd/es/table";
import type { HolidayRow } from "../../api/leave";
import { fw, v } from "../../theme/tokens";
import { HolidayKindChip, type HolidayKind } from "./HolidayKindChip";

export interface HolidayListRow extends HolidayRow {
  kind: HolidayKind;
}

export const fmtHolidayDate = (d: string) => dayjs(d).format("DD MMM YYYY");
export const holidayWeekday = (d: string) => dayjs(d).format("dddd");
export const isPastHoliday = (d: string) => dayjs(d).isBefore(dayjs(), "day");

// The holiday table of time-off-09: name, date, weekday (+ type chip where both lists are shown together). Past holidays read in secondary text.
export function holidayColumns<T extends HolidayRow>(opts: { withKind?: (row: T) => HolidayKind } = {}): ColumnsType<T> {
  return [
    {
      title: "Holiday Name",
      dataIndex: "name",
      render: (name: string, r) => <span style={{ fontWeight: fw.medium, color: isPastHoliday(r.date) ? v.textSecondary : v.textPrimary }}>{name}</span>,
    },
    { title: "Date", dataIndex: "date", width: 150, render: (d: string) => <span className="ws-num">{fmtHolidayDate(d)}</span> },
    { title: "Weekday", key: "weekday", width: 140, render: (_, r) => holidayWeekday(r.date) },
    ...(opts.withKind ? [{ title: "Type", key: "kind", width: 140, render: (_: unknown, r: T) => <HolidayKindChip kind={opts.withKind!(r)} /> }] : []),
  ];
}
