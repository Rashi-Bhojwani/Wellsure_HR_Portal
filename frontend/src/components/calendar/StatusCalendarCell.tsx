import { CalendarOutlined, EditOutlined } from "@ant-design/icons";
import { attendanceStatusColor, fs, fw, radius, space, v } from "../../theme/tokens";

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
  return attendanceStatusColor[primaryCode] ?? { bg: v.bgSubtle, fg: v.textSecondary };
}

// One day cell in the Attendance Info month calendar
// (docs/UI_REFERENCE.md §1.5): date top-left, status code centred, shift
// code bottom-right, edit/regularize + leave-apply icons top-right,
// background colour keyed off status (theme tokens, so it follows light/dark). The status code is always written, never colour alone.
export function StatusCalendarCell({ day, selected, onSelect }: StatusCalendarCellProps) {
  const { bg, fg } = colorFor(day.status);

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${day.date}: ${day.status}${day.shift ? `, shift ${day.shift}` : ""}${day.hasException ? ", needs attention" : ""}`}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect?.()}
      style={{
        background: bg,
        borderRadius: radius.sm,
        padding: space[2],
        minHeight: 72,
        cursor: onSelect ? "pointer" : "default",
        outline: selected ? `2px solid ${v.accent}` : "none",
        outlineOffset: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span style={{ fontSize: fs.sm, fontWeight: fw.semibold, color: v.textBody }}>{day.date}</span>
        {day.hasException && (
          <span style={{ display: "inline-flex", gap: space[1] }}>
            <EditOutlined aria-hidden style={{ fontSize: fs.xs, color: fg }} />
            <CalendarOutlined aria-hidden style={{ fontSize: fs.xs, color: fg }} />
          </span>
        )}
      </div>
      <div style={{ textAlign: "center", fontWeight: fw.bold, fontSize: fs.md, color: fg }}>{day.status}</div>
      <div style={{ textAlign: "right", fontSize: fs.chip, color: v.textSecondary }}>{day.shift ?? ""}</div>
    </div>
  );
}
