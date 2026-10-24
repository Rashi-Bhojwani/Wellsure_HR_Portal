import { Space } from "antd";
import { CalendarOutlined, EditOutlined } from "@ant-design/icons";
import { attendanceStatusColor, fs } from "../../theme/tokens";

export interface AttendanceDayData {
  date: number;
  status: string; // P | A | HD | H | O | A:P | L:<code> | LOP ...
  shift?: string;
  hasException?: boolean;
}

interface StatusCalendarCellProps {
  day: AttendanceDayData;
  selected?: boolean;
  onSelect?: () => void;
}

function colorFor(status: string): { bg: string; fg: string } {
  const primaryCode = status.split(":")[0] ?? status;
  return attendanceStatusColor[primaryCode] ?? { bg: "#f4f5f7", fg: "#6b7280" };
}

// One day cell in the Attendance Info month calendar
// (docs/UI_REFERENCE.md §1.5): date top-left, status code centred, shift
// code bottom-right, edit/regularize + leave-apply icons top-right,
// background colour keyed off status.
export function StatusCalendarCell({ day, selected, onSelect }: StatusCalendarCellProps) {
  const { bg, fg } = colorFor(day.status);

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => e.key === "Enter" && onSelect?.()}
      style={{
        background: bg,
        borderRadius: 8,
        padding: 8,
        minHeight: 72,
        cursor: onSelect ? "pointer" : "default",
        outline: selected ? "2px solid #2f6fed" : "none",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: fs.sm, fontWeight: 600 }}>{day.date}</span>
        {day.hasException && (
          <Space size={4}>
            <EditOutlined style={{ fontSize: fs.xs, color: fg }} />
            <CalendarOutlined style={{ fontSize: fs.xs, color: fg }} />
          </Space>
        )}
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: fs.md, color: fg }}>{day.status}</div>
      <div style={{ textAlign: "right", fontSize: fs.chip, color: "#6b7280" }}>{day.shift ?? ""}</div>
    </div>
  );
}
