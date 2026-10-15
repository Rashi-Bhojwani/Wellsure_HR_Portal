import { useRef, type CSSProperties, type KeyboardEvent } from "react";
import { theme } from "antd";
import { parseMusterCell } from "@shared/attendance/muster";
import type { Muster, MusterCell, MusterRow } from "../../../../api/muster";
import { cellKey, useCellTones } from "./musterCells";

// The editable grid (Phase 2 P2-D, docs/plans/PHASE_2.md §5.1): employees ×
// days, click a cell and type — a status letter or IN-OUT times. Tab or
// Enter moves to the next day, ↑/↓ to the next person, Esc undoes the cell.
// Unsaved cells are yellow; a cell the parser or the server refused is red.

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const TOTALS: Array<{ key: keyof MusterRow["totals"]; label: string; title: string }> = [
  { key: "paidDays", label: "Paid", title: "Paid days: days so far less LOP. NM and NS days count 0 until resolved." },
  { key: "present", label: "P", title: "Present (a half day counts ½)" },
  { key: "absent", label: "A", title: "Absent (a half day counts ½)" },
  { key: "halfDays", label: "HD", title: "Half days" },
  { key: "lop", label: "LOP", title: "Loss of pay, days" },
  { key: "leave", label: "Leave", title: "Leave, days" },
  { key: "holidays", label: "H", title: "Holidays" },
  { key: "off", label: "OFF", title: "Week-offs" },
  { key: "notMarked", label: "NM", title: "Not marked yet" },
  { key: "missingPunch", label: "1×", title: "Days with one time only (forgot to punch out?)" },
];

function describe(row: MusterRow, cell: MusterCell): string {
  const d = new Date(`${cell.date}T00:00:00Z`);
  const parts = [`${row.name}, ${WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`];
  if (cell.code) parts.push(cell.code === "OFF" ? "week-off" : cell.code);
  if (cell.firstIn) parts.push(`${cell.firstIn}–${cell.lastOut ?? "no OUT"}`);
  if (cell.lateInMinutes) parts.push(`late ${cell.lateInMinutes}m`);
  if (cell.earlyOutMinutes) parts.push(`left ${cell.earlyOutMinutes}m early`);
  if (cell.statusOnly) parts.push("status only, no times");
  if (cell.missingPunch) parts.push("one time only: forgot to punch out?");
  if (cell.corrected) parts.push(cell.overrideKind === "MANUAL_OVERRIDE" ? "overridden by HR (not from the device)" : "corrected: an approved request (not from the device)");
  if (cell.shiftOverridden) parts.push("shift set for this day by HR");
  if (cell.workedOnOffDay) parts.push("worked on an off day");
  if (cell.provisional) parts.push("provisional (the day isn't over)");
  if (cell.entry) parts.push(`entered as "${cell.entry.text}"${cell.entry.via === "MUSTER_UPLOAD" ? " (upload)" : cell.entry.via === "BULK" ? " (mark all present)" : ""}${cell.entry.remark ? `: ${cell.entry.remark}` : ""}`);
  if (cell.capture === "DEVICE") parts.push("biometric device");
  if (!cell.editable && cell.reason) parts.push(cell.reason);
  else if (cell.offDayOnly) parts.push("off day: type W or the times worked");
  return parts.join(" · ");
}

interface Props {
  muster: Muster;
  pending: Record<string, string>;
  errors: Record<string, string>;
  onChange: (key: string, text: string | null) => void; // null = back to the saved value
  focused: string | null;
  onFocus: (key: string | null) => void;
  /** HR with Manual Override: a device day opens it (the grid itself only edits manual-capture days). */
  onOpenDay?: (row: MusterRow, cell: MusterCell) => void;
}

/** Marks a day that did not come straight from the device: ~ an approved request, # set by HR, ^ a shift set for the day. */
function marks(cell: MusterCell): string {
  return `${cell.overrideKind === "REGULARIZATION" ? "~" : cell.overrideKind === "MANUAL_OVERRIDE" ? "#" : ""}${cell.shiftOverridden ? "^" : ""}`;
}

export function MusterGrid({ muster, pending, errors, onChange, focused, onFocus, onOpenDay }: Props) {
  const { token } = theme.useToken();
  const tones = useCellTones();
  const tableRef = useRef<HTMLTableElement>(null);

  const move = (rowIdx: number, dayIdx: number, dRow: number, dDay: number) => {
    let r = rowIdx;
    let c = dayIdx;
    for (let i = 0; i < 400; i++) {
      c += dDay;
      r += dRow;
      if (c >= muster.days.length) {
        c = 0;
        r += 1;
      }
      if (c < 0) {
        c = muster.days.length - 1;
        r -= 1;
      }
      if (r < 0 || r >= muster.rows.length) return;
      const el = tableRef.current?.querySelector<HTMLInputElement>(`input[data-r="${r}"][data-c="${c}"]`);
      if (el) {
        el.focus();
        el.select();
        return;
      }
      if (dRow !== 0 && dDay === 0) continue;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>, r: number, c: number, key: string) => {
    if (e.key === "Enter") {
      e.preventDefault();
      move(r, c, 0, e.shiftKey ? -1 : 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      move(r, c, 1, 0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      move(r, c, -1, 0);
    } else if (e.key === "Escape") {
      onChange(key, null);
    }
  };

  const sticky = (left: number, width: number): CSSProperties => ({ position: "sticky", left, zIndex: 2, minWidth: width, maxWidth: width, background: token.colorBgContainer });
  const border = `1px solid ${token.colorBorderSecondary}`;
  const th: CSSProperties = { padding: "4px 2px", fontWeight: 500, fontSize: 12, borderBottom: border, borderRight: border, textAlign: "center", background: token.colorFillQuaternary, position: "sticky", top: 0, zIndex: 1 };
  const td: CSSProperties = { padding: 0, borderBottom: border, borderRight: border, textAlign: "center", height: 30 };

  return (
    <div style={{ overflow: "auto", maxHeight: "calc(100vh - 320px)", minHeight: 240, border, borderRadius: token.borderRadius }}>
      <table ref={tableRef} style={{ borderCollapse: "separate", borderSpacing: 0, fontSize: 12, width: "max-content" }} aria-label={`Attendance muster, ${muster.cycle.label}`}>
        <thead>
          <tr>
            <th style={{ ...th, ...sticky(0, 200), zIndex: 3, textAlign: "left", paddingLeft: 8, background: token.colorFillQuaternary }}>Employee</th>
            {muster.days.map((d) => {
              const n = Number(d.date.slice(8));
              const sunday = d.weekday === 0;
              return (
                <th key={d.date} style={{ ...th, minWidth: 46, color: sunday ? token.colorTextTertiary : undefined, outline: d.date === muster.today ? `2px solid ${token.colorPrimary}` : undefined, outlineOffset: -2 }}>
                  <div>{n}</div>
                  <div style={{ fontWeight: 400, color: token.colorTextTertiary }}>{WEEKDAYS[d.weekday]}</div>
                  <div title={`${d.notMarked} not marked`} style={{ fontWeight: 400, fontSize: 11, color: d.notMarked ? token.colorWarningText : "transparent" }}>
                    {d.notMarked ? `${d.notMarked} NM` : "·"}
                  </div>
                </th>
              );
            })}
            {TOTALS.map((t) => (
              <th key={t.key} title={t.title} style={{ ...th, minWidth: t.key === "paidDays" ? 52 : 40, background: t.key === "paidDays" ? token.colorPrimaryBg : token.colorFillQuaternary }}>
                {t.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {muster.rows.map((row, r) => (
            <tr key={row.employeeId}>
              <th scope="row" style={{ ...td, ...sticky(0, 200), textAlign: "left", padding: "2px 8px", fontWeight: 400 }}>
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{row.name}</div>
                <div style={{ color: token.colorTextTertiary, fontSize: 11 }}>
                  {row.employeeCode}
                  {row.branch ? ` · ${row.branch}` : ""}
                </div>
              </th>
              {row.cells.map((cell, c) => {
                const key = cellKey(row.employeeId, cell.date);
                const edited = pending[key];
                const error = errors[key] ?? (edited !== undefined && edited !== "" ? (() => { const p = parseMusterCell(edited); return p.ok ? null : p.error; })() : null);
                const tone = tones(cell.code);
                const base: CSSProperties = {
                  ...td,
                  background: edited !== undefined ? token.colorWarningBgHover : tone.background,
                  color: tone.color,
                  boxShadow: error ? `inset 0 0 0 2px ${token.colorError}` : cell.statusOnly ? `inset 0 0 0 1px ${token.colorTextQuaternary}` : marks(cell) ? `inset 0 -3px 0 ${token.colorPrimary}` : undefined,
                  position: "relative",
                  fontWeight: 500,
                };
                const title = error ? `${describe(row, cell)}\n⚠ ${error}` : edited === "" ? `${describe(row, cell)}\nWill be cleared (back to not marked) when you save.` : describe(row, cell);
                const corner = cell.missingPunch ? <span aria-hidden style={{ position: "absolute", top: 0, right: 0, borderTop: `7px solid ${token.colorError}`, borderLeft: "7px solid transparent" }} /> : null;
                const worked = cell.workedOnOffDay ? <span aria-hidden style={{ position: "absolute", bottom: 2, right: 3, width: 5, height: 5, borderRadius: 5, background: token.colorSuccess }} /> : null;
                const mark = marks(cell) ? (
                  <span aria-hidden style={{ position: "absolute", top: 0, left: 2, fontSize: 11, lineHeight: "12px", color: token.colorPrimary, fontWeight: 700 }}>
                    {marks(cell)}
                  </span>
                ) : null;
                if (!cell.editable) {
                  const openable = !!onOpenDay && cell.capture === "DEVICE" && !!cell.code && !cell.locked;
                  return (
                    <td
                      key={cell.date}
                      title={openable ? `${title}\nClick to set this day (HR)` : title}
                      onClick={openable ? () => onOpenDay!(row, cell) : undefined}
                      style={{ ...base, cursor: openable ? "pointer" : "default", opacity: cell.capture === "DEVICE" || cell.locked ? 0.85 : 1, borderStyle: cell.statusOnly ? "dashed" : undefined }}
                    >
                      {mark}
                      {cell.code ?? ""}
                      {cell.locked && <span aria-label="finalised" style={{ fontSize: 9, marginLeft: 1 }}>🔒</span>}
                      {corner}
                      {worked}
                    </td>
                  );
                }
                const shown = edited ?? (focused === key ? (cell.entry?.text ?? "") : (cell.code ?? ""));
                return (
                  <td key={cell.date} title={title} style={base}>
                    {mark}
                    <input
                      data-r={r}
                      data-c={c}
                      aria-label={describe(row, cell)}
                      aria-invalid={error ? true : undefined}
                      value={shown}
                      placeholder={edited === "" ? "clear" : undefined}
                      onFocus={(e) => {
                        onFocus(key);
                        requestAnimationFrame(() => e.target.select());
                      }}
                      onBlur={() => {
                        onFocus(null);
                        if (edited !== undefined && edited === (cell.entry?.text ?? "")) onChange(key, null);
                      }}
                      onChange={(e) => onChange(key, e.target.value)}
                      onKeyDown={(e) => onKey(e, r, c, key)}
                      style={{
                        width: focused === key ? 110 : 44,
                        position: focused === key ? "relative" : undefined,
                        zIndex: focused === key ? 4 : undefined,
                        height: 28,
                        border: "none",
                        outline: focused === key ? `2px solid ${token.colorPrimary}` : "none",
                        background: focused === key ? token.colorBgElevated : "transparent",
                        color: "inherit",
                        font: "inherit",
                        textAlign: "center",
                        cursor: "text",
                        padding: 0,
                        textDecorationLine: cell.statusOnly && edited === undefined && focused !== key ? "underline" : undefined,
                        textDecorationStyle: "dotted",
                      }}
                    />
                    {corner}
                    {worked}
                  </td>
                );
              })}
              {TOTALS.map((t) => (
                <td key={t.key} style={{ ...td, padding: "0 4px", fontWeight: t.key === "paidDays" ? 600 : 400, background: t.key === "paidDays" ? token.colorPrimaryBg : undefined, color: t.key === "missingPunch" && row.totals.missingPunch ? token.colorErrorText : undefined }}>
                  {row.totals[t.key] || (t.key === "paidDays" ? 0 : "")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
