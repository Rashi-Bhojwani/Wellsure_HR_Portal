import { CalendarOutlined, EditOutlined } from "@ant-design/icons";
import { statusTone } from "../attendance/statusTone";
import { fs, fw, radius, space, v } from "../../theme/tokens";

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

/** Colour pair from the attendanceStatusColor tokens (via statusTone, the same mapping as the muster grid and the day panel). */
function colorFor(status: string): { bg: string; fg: string; label: string } {
  if (!status) return { bg: v.bgSubtle, fg: v.textSecondary, label: "No record" };
  const t = statusTone(status.startsWith("L:") ? (status.split(":")[1] ?? status) : status);
  return { bg: t.bg === "transparent" ? v.bgSubtle : t.bg, fg: t.fg, label: t.label };
}

// One day cell in the Attendance Info month calendar
// (docs/UI_REFERENCE.md §1.5): date top-left, status code centred, shift
// code bottom-right, edit/regularize + leave-apply icons top-right,
// background colour keyed off status (theme tokens, so it follows light/dark). The status code is always written, never colour alone.
// A button only when it can be selected (Enter / Space select it); otherwise a plain cell.
export function StatusCalendarCell({ day, selected, onSelect }: StatusCalendarCellProps) {
  const { bg, fg, label } = colorFor(day.status);
  const interactive = !!onSelect;

  return (
    <div
      role={interactive ? "button" : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? !!selected : undefined}
      aria-label={`${day.date}: ${day.status} (${label})${day.shift ? `, shift ${day.shift}` : ""}${day.hasException ? ", needs attention" : ""}`}
      onClick={onSelect}
      onKeyDown={
        interactive
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect();
              }
            }
          : undefined
      }
      style={{
        background: bg,
        borderRadius: radius.sm,
        padding: space[2],
        minHeight: 72,
        cursor: interactive ? "pointer" : "default",
        outline: selected ? `2px solid ${v.accent}` : undefined,
        outlineOffset: 1,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minWidth: 0,
        transition: "outline-color 0.15s",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <span className="ws-num" style={{ fontSize: fs.sm, fontWeight: fw.semibold, color: v.textBody }}>
          {day.date}
        </span>
        {day.hasException && (
          <span style={{ display: "inline-flex", gap: space[1] }}>
            <EditOutlined aria-hidden style={{ fontSize: fs.xs, color: fg }} />
            <CalendarOutlined aria-hidden style={{ fontSize: fs.xs, color: fg }} />
          </span>
        )}
      </div>
      <div style={{ textAlign: "center", fontWeight: fw.bold, fontSize: fs.md, color: fg, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{day.status}</div>
      <div style={{ textAlign: "right", fontSize: fs.chip, color: v.textSecondary }}>{day.shift ?? ""}</div>
    </div>
  );
}
