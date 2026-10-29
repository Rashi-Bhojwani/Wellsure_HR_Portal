import { useMemo, type ReactNode } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { Button, DatePicker, Popover, Tooltip } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import type { LeaveCalendarEntry } from "../../api/leave";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { EmptyState, InitialsAvatar, QueryState, Skel, useIsPhone, type ChipTone } from "../../ui";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TONES: ChipTone[] = ["info", "purple", "success", "warning", "danger", "neutral"];
const CHIP: Record<ChipTone, { bg: string; fg: string }> = {
  info: { bg: v.chipInfoBg, fg: v.chipInfoText },
  purple: { bg: v.chipPurpleBg, fg: v.chipPurpleText },
  success: { bg: v.chipSuccessBg, fg: v.chipSuccessText },
  warning: { bg: v.chipWarningBg, fg: v.chipWarningText },
  danger: { bg: v.chipDangerBg, fg: v.chipDangerText },
  neutral: { bg: v.chipNeutralBg, fg: v.chipNeutralText },
};
const MAX_CHIPS = 3;

interface DayEntry {
  entry: LeaveCalendarEntry;
  half: boolean;
}

/** Spreads each leave over the days of the month it covers, skipping days HR released because the person worked them (Phase 3). */
function entriesByDay(entries: LeaveCalendarEntry[], monthStart: Dayjs): Map<number, DayEntry[]> {
  const map = new Map<number, DayEntry[]>();
  for (const entry of entries) {
    let cursor = dayjs(entry.fromDate);
    const end = dayjs(entry.toDate);
    while (cursor.isBefore(end) || cursor.isSame(end, "day")) {
      const iso = cursor.format("YYYY-MM-DD");
      if (cursor.isSame(monthStart, "month") && !entry.releasedDates.includes(iso)) {
        const half = (iso === entry.fromDate && entry.fromDayPart !== "FULL") || (iso === entry.toDate && entry.toDayPart !== "FULL");
        const list = map.get(cursor.date()) ?? [];
        list.push({ entry, half });
        map.set(cursor.date(), list);
      }
      cursor = cursor.add(1, "day");
    }
  }
  return map;
}

function LeaveChip({ item, tone }: { item: DayEntry; tone: ChipTone }) {
  const c = CHIP[tone];
  const text = `${item.entry.employeeName} · ${item.entry.leaveTypeCode}${item.half ? " · ½" : ""}`;
  return (
    <Tooltip title={`${item.entry.employeeName} (${item.entry.employeeCode}) · ${item.entry.leaveTypeCode}${item.half ? " · half day" : ""} · ${item.entry.fromDate === item.entry.toDate ? item.entry.fromDate : `${item.entry.fromDate} → ${item.entry.toDate}`}`}>
      <div
        tabIndex={0}
        style={{
          background: c.bg,
          color: c.fg,
          borderRadius: radius.xs,
          padding: `2px ${space[2]}px`,
          fontSize: fs.xs,
          fontWeight: fw.semibold,
          lineHeight: "18px",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {text}
      </div>
    </Tooltip>
  );
}

export interface LeaveMonthCalendarProps {
  entries: LeaveCalendarEntry[];
  monthStart: Dayjs;
  onMonthChange: (monthStart: Dayjs) => void;
  loading?: boolean;
  error?: unknown;
  onRetry?: () => void;
  /** Shown when nobody is on leave in the month. */
  emptyText: string;
  /** Filters next to the month picker (admin: branch / department). */
  toolbar?: ReactNode;
}

// The board's month calendar (time-off-06): weekday header band, date numbers top-right, out-of-month days faded, one chip per person on leave.
// Phones get an agenda list (one block per day with people) instead of a cramped 7-column grid. Chip colour follows the leave type, and every
// chip carries the code as a word, so colour is never the only signal.
export function LeaveMonthCalendar({ entries, monthStart, onMonthChange, loading, error, onRetry, emptyText, toolbar }: LeaveMonthCalendarProps) {
  const phone = useIsPhone();
  const byDay = useMemo(() => entriesByDay(entries, monthStart), [entries, monthStart]);
  const codes = useMemo(() => [...new Set(entries.map((e) => e.leaveTypeCode))].sort(), [entries]);
  const toneOf = (code: string): ChipTone => TONES[Math.max(0, codes.indexOf(code)) % TONES.length]!;
  const today = dayjs();
  const isCurrentMonth = monthStart.isSame(today, "month");
  const hasHalf = useMemo(() => [...byDay.values()].some((l) => l.some((d) => d.half)), [byDay]);

  // Leading/trailing days from the neighbouring months, faded (the board shows them).
  const cells = useMemo(() => {
    const first = monthStart.startOf("month");
    const start = first.subtract(first.day(), "day");
    const weeks = Math.ceil((first.day() + first.daysInMonth()) / 7);
    return Array.from({ length: weeks * 7 }, (_, i) => start.add(i, "day"));
  }, [monthStart]);

  const toolbarRow = (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[3], marginBottom: space[5] }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[2], flex: phone ? "1 1 100%" : "0 1 auto" }}>
        <Tooltip title="Previous month">
          <Button aria-label="Previous month" icon={<LeftOutlined />} onClick={() => onMonthChange(monthStart.subtract(1, "month"))} />
        </Tooltip>
        <DatePicker
          picker="month"
          allowClear={false}
          value={monthStart}
          format="MMMM YYYY"
          onChange={(d) => d && onMonthChange(d.startOf("month"))}
          aria-label="Month"
          style={{ flex: phone ? 1 : undefined, width: phone ? undefined : 200 }}
        />
        <Tooltip title="Next month">
          <Button aria-label="Next month" icon={<RightOutlined />} onClick={() => onMonthChange(monthStart.add(1, "month"))} />
        </Tooltip>
        {!isCurrentMonth && <Button onClick={() => onMonthChange(today.startOf("month"))}>Today</Button>}
      </div>
      {toolbar && <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], marginLeft: phone ? 0 : "auto", flex: phone ? "1 1 100%" : undefined }}>{toolbar}</div>}
    </div>
  );

  const legend = (
    <div aria-label="Legend" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: `${space[2]}px ${space[4]}px`, marginTop: space[4], fontSize: fs.sm, color: v.textSecondary }}>
      {codes.length > 0 && <span>Leave type:</span>}
      {codes.map((code) => (
        <span key={code} style={{ display: "inline-flex", alignItems: "center", gap: space[1] }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: CHIP[toneOf(code)].fg }} />
          {code}
        </span>
      ))}
      {hasHalf && <span>½ = half day</span>}
      {!phone && (
        <span style={{ display: "inline-flex", alignItems: "center", gap: space[1] }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: radius.pill, background: v.accent }} />
          Today
        </span>
      )}
      {!phone && <span>Faded dates are outside this month</span>}
    </div>
  );

  if (error && entries.length === 0) {
    return (
      <>
        {toolbarRow}
        <QueryState isLoading={false} error={error} onRetry={onRetry}>
          {null}
        </QueryState>
      </>
    );
  }

  if (phone) {
    const days = [...byDay.keys()].sort((a, b) => a - b);
    return (
      <div>
        {toolbarRow}
        {loading && entries.length === 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
            {[0, 1, 2].map((i) => (
              <Skel key={i} h={72} r={radius.md} />
            ))}
          </div>
        ) : days.length === 0 ? (
          <EmptyState compact illustration="calendar" title={emptyText} description={null} />
        ) : (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3], opacity: loading ? 0.6 : 1 }}>
            {days.map((d) => {
              const date = monthStart.date(d);
              const isToday = date.isSame(today, "day");
              return (
                <li key={d} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4], background: v.bgSurface }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: space[2], marginBottom: space[3] }}>
                    <span style={{ fontSize: fs.h2, fontWeight: fw.bold, color: isToday ? v.accentText : v.textPrimary }}>{date.format("DD")}</span>
                    <span style={{ fontSize: fs.md, color: v.textSecondary }}>
                      {date.format("dddd")}
                      {isToday ? " · Today" : ""}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                    {(byDay.get(d) ?? []).map((item, i) => {
                      const c = CHIP[toneOf(item.entry.leaveTypeCode)];
                      return (
                        <div key={`${item.entry.employeeId}-${i}`} style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                          <InitialsAvatar name={item.entry.employeeName} size={32} />
                          <span style={{ flex: 1, minWidth: 0, fontSize: fs.md, color: v.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.entry.employeeName}</span>
                          <span style={{ background: c.bg, color: c.fg, borderRadius: radius.xs, padding: `2px ${space[2]}px`, fontSize: fs.xs, fontWeight: fw.semibold }}>
                            {item.entry.leaveTypeCode}
                            {item.half ? " · ½" : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {legend}
      </div>
    );
  }

  return (
    <div>
      {toolbarRow}
      <div style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, overflow: "hidden", opacity: loading && entries.length > 0 ? 0.6 : 1, transition: "opacity 0.15s" }} aria-busy={loading}>
        <div role="row" style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", background: v.bgTableHeader }}>
          {WEEKDAYS.map((w, i) => (
            <div
              key={w}
              role="columnheader"
              style={{ textAlign: "center", padding: `${space[3]}px 0`, fontSize: fs.table, fontWeight: fw.semibold, color: v.textOnRaised, borderLeft: i === 0 ? "none" : `1px solid ${v.borderDefault}` }}
            >
              {w}
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
          {cells.map((date, i) => {
            const inMonth = date.isSame(monthStart, "month");
            const items = inMonth ? (byDay.get(date.date()) ?? []) : [];
            const isToday = date.isSame(today, "day");
            const extra = items.length - MAX_CHIPS;
            return (
              <div
                key={date.format("YYYY-MM-DD")}
                aria-label={`${date.format("D MMMM")}${items.length ? `: ${items.length} on leave` : ""}`}
                style={{
                  minHeight: 112,
                  padding: space[2],
                  borderTop: `1px solid ${v.borderDefault}`,
                  borderLeft: i % 7 === 0 ? "none" : `1px solid ${v.borderDefault}`,
                  background: inMonth ? v.bgSurface : v.bgSubtle,
                  display: "flex",
                  flexDirection: "column",
                  gap: space[1],
                  minWidth: 0,
                }}
              >
                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <span
                    style={{
                      minWidth: 26,
                      height: 26,
                      padding: "0 6px",
                      borderRadius: radius.pill,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: fs.table,
                      fontWeight: isToday ? fw.bold : fw.medium,
                      background: isToday ? v.accent : "transparent",
                      color: isToday ? v.navActiveText : inMonth ? v.textBody : v.textPlaceholder,
                      opacity: inMonth ? 1 : 0.7,
                    }}
                  >
                    {date.date()}
                  </span>
                </div>
                {items.slice(0, MAX_CHIPS).map((item, k) => (
                  <LeaveChip key={`${item.entry.employeeId}-${k}`} item={item} tone={toneOf(item.entry.leaveTypeCode)} />
                ))}
                {extra > 0 && (
                  <Popover
                    trigger="click"
                    title={date.format("dddd, D MMMM")}
                    content={
                      <div style={{ display: "flex", flexDirection: "column", gap: space[1], maxWidth: 260 }}>
                        {items.map((item, k) => (
                          <LeaveChip key={`${item.entry.employeeId}-all-${k}`} item={item} tone={toneOf(item.entry.leaveTypeCode)} />
                        ))}
                      </div>
                    }
                  >
                    <Button type="link" size="small" style={{ padding: 0, height: "auto", alignSelf: "flex-start", fontSize: fs.xs }}>
                      +{extra} more
                    </Button>
                  </Popover>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {legend}
      {!loading && entries.length === 0 && <div style={{ marginTop: space[2], fontSize: fs.md, color: v.textSecondary }}>{emptyText}</div>}
    </div>
  );
}
