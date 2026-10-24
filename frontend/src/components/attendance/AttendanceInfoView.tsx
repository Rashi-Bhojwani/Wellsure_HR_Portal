import { memo, useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, Tooltip } from "antd";
import { ClockCircleOutlined, EditOutlined, LeftOutlined, RightOutlined } from "@ant-design/icons";
import * as infoApi from "../../api/attendanceInfo";
import type { MonthDay } from "../../api/attendanceInfo";
import { hoursLabel } from "../../pages/admin/attendance/settings/format";
import { ApprovalBanner, CardGrid, Panel, Skel, StatCard, Stack, useIsPhone } from "../../ui";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { DayPanel } from "./DayPanel";
import { STATUS_LEGEND, statusTone } from "./statusTone";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const KIND_TEXT: Record<string, string> = { MISSING_PUNCH: "missing punch", HALF_DAY_MIN_NOT_MET: "under the half-day minimum", SHORTFALL: "shortfall", NO_SHIFT: "no shift", CLOCK_FLAGGED: "punch time to check" };

/**
 * Attendance Info (Phase 2 P2-E, UI_REFERENCE §1.5): the month calendar,
 * stats cards, exception banner and the day panel. `employeeId` unset = the
 * signed-in employee's own view (with the forgot-to-punch request). Callers
 * key it by `initialDate` so a new ?date= link opens that day.
 *
 * Live: punches and decisions invalidate ["attendance"] (sockets/useAttendanceRealtime). The refetch keeps the old data on
 * screen (no skeleton), and TanStack's structural sharing keeps unchanged days referentially equal, so the memoised
 * cells below re-render only the day that changed.
 */
export function AttendanceInfoView({ employeeId, initialDate }: { employeeId?: string; initialDate?: string | null }) {
  const self = !employeeId;
  const phone = useIsPhone();
  const [month, setMonth] = useState(() => (initialDate ? initialDate.slice(0, 7) : dayjs().format("YYYY-MM")));
  const [selected, setSelected] = useState<string | null>(initialDate ?? null);
  const { data, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["attendance", "info", "month", employeeId ?? "me", month],
    queryFn: () => (self ? infoApi.myMonth(month) : infoApi.employeeMonth(employeeId!, month)),
    placeholderData: keepPreviousData,
  });
  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const first = dayjs(`${month}-01`);
  const cells: Array<string | null> = [...Array(first.day()).fill(null), ...Array.from({ length: first.daysInMonth() }, (_, i) => first.add(i, "day").format("YYYY-MM-DD"))];
  while (cells.length % 7) cells.push(null);
  const go = (n: number) => {
    setMonth(first.add(n, "month").format("YYYY-MM"));
    setSelected(null);
  };
  const exceptionDays = (data?.days ?? []).filter((d) => d.flags.some((f) => f in KIND_TEXT));
  const stale = isPlaceholderData && data?.month !== month;

  // On phones the day panel sits below the calendar: bring it into view when a day is picked.
  const dayRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (phone && selected) dayRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [phone, selected]);

  const stats = data?.stats;
  return (
    <Stack>
      <CardGrid min={200}>
        <StatCard variant="compact" label="Avg. work hrs" info="First in to last out" loading={isLoading} value={stats?.avgWorkMinutes ? hoursLabel(stats.avgWorkMinutes) : "—"} hint="first in to last out" />
        <StatCard variant="compact" label="Avg. actual work hrs" info="Less scheduled breaks" loading={isLoading} value={stats?.avgActualMinutes ? hoursLabel(stats.avgActualMinutes) : "—"} hint="less scheduled breaks" />
        <StatCard variant="compact" label="Late days" info="Recorded only, no penalty" loading={isLoading} value={stats?.lateDays ?? "—"} hint="recorded only, no penalty" />
        <StatCard variant="compact" label="LOP days" info="Loss of pay this month" loading={isLoading} value={stats?.lopDays ?? "—"} hint="loss of pay this month" />
      </CardGrid>
      {exceptionDays.length > 0 && (
        <ApprovalBanner
          tone="warning"
          title={`${exceptionDays.length} exception ${exceptionDays.length === 1 ? "day" : "days"} this month`}
          description={Object.entries(data!.stats.exceptionKinds)
            .map(([k, n]) => `${n} ${KIND_TEXT[k] ?? k}`)
            .join(" · ")}
          actions={
            <Button onClick={() => setSelected(exceptionDays[0]!.date)}>
              {self ? "Regularize" : `Show ${exceptionDays.length === 1 ? "it" : "the first"}`}
            </Button>
          }
        />
      )}
      <div style={{ display: "grid", gridTemplateColumns: !phone && selected ? "minmax(0, 7fr) minmax(360px, 5fr)" : "minmax(0, 1fr)", gap: phone ? space[4] : space[6], alignItems: "start" }}>
        <Panel
          title={first.format("MMMM YYYY")}
          extra={
            <div style={{ display: "flex", gap: space[2] }}>
              <Tooltip title="Previous month">
                <Button icon={<LeftOutlined />} aria-label="Previous month" onClick={() => go(-1)} />
              </Tooltip>
              <Tooltip title="Next month">
                <Button icon={<RightOutlined />} aria-label="Next month" onClick={() => go(1)} disabled={month >= dayjs().format("YYYY-MM")} />
              </Tooltip>
            </div>
          }
        >
          {isLoading ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: space[2] }} aria-busy>
              {Array.from({ length: 35 }, (_, i) => (
                <Skel key={i} h={phone ? 52 : 76} r={radius.sm} />
              ))}
            </div>
          ) : (
            <div
              role="grid"
              aria-label={`Attendance, ${first.format("MMMM YYYY")}`}
              aria-busy={stale}
              style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: phone ? space[1] : space[2], opacity: stale ? 0.55 : 1, transition: "opacity 0.15s" }}
            >
              {WEEKDAYS.map((w) => (
                <div key={w} role="columnheader" style={{ textAlign: "center", fontSize: fs.sm, fontWeight: fw.semibold, color: v.textSecondary, padding: `${space[1]}px 0 ${space[2]}px` }}>
                  {phone ? w.slice(0, 1) : w}
                </div>
              ))}
              {cells.map((date, i) =>
                date ? (
                  <DayCell key={date} date={date} day={stale ? undefined : byDate.get(date)} selected={selected === date} today={date === data?.today} compact={phone} onSelect={setSelected} />
                ) : (
                  <div key={`blank-${i}`} aria-hidden />
                ),
              )}
            </div>
          )}
          <Legend />
        </Panel>
        {selected && (
          <div ref={dayRef} style={{ scrollMarginTop: space[4] }}>
            <DayPanel employeeId={employeeId} date={selected} self={self} onClose={() => setSelected(null)} />
          </div>
        )}
      </div>
    </Stack>
  );
}

const DayCell = memo(function DayCell({ date, day: d, selected, today, compact, onSelect }: { date: string; day: MonthDay | undefined; selected: boolean; today: boolean; compact: boolean; onSelect: (date: string) => void }) {
  const tone = statusTone(d?.code);
  const label = `${dayjs(date).format("ddd D MMM")}: ${d ? `${tone.label} (${d.code})` : "no record"}${d?.shiftCode ? `, shift ${d.shiftCode}` : ""}${d?.missingPunch ? ", one punch only" : ""}${d?.corrected ? ", corrected" : ""}${d?.request?.status === "PENDING" ? ", request waiting" : ""}${today ? ", today" : ""}`;
  return (
    <button
      type="button"
      role="gridcell"
      aria-selected={selected}
      aria-label={label}
      onClick={() => onSelect(date)}
      className="ws-att-cell"
      style={{
        position: "relative",
        minHeight: compact ? 52 : 76,
        minWidth: 0,
        border: `1px solid ${d && tone.bg !== "transparent" ? "transparent" : v.borderDefault}`,
        borderStyle: d?.statusOnly ? "dashed" : "solid",
        borderColor: d?.statusOnly ? tone.fg : undefined,
        outline: selected ? `2px solid ${v.focusRing}` : undefined,
        outlineOffset: 1,
        borderRadius: radius.sm,
        background: d ? tone.bg : v.bgSurface,
        color: d ? tone.fg : v.textSecondary,
        cursor: "pointer",
        padding: compact ? 3 : space[2],
        textAlign: "left",
        font: "inherit",
        display: "flex",
        flexDirection: "column",
        transition: "background-color 0.2s",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: compact ? 18 : 22, height: compact ? 18 : 22, padding: "0 4px", borderRadius: radius.pill, fontSize: compact ? fs.xs : fs.sm, fontWeight: today ? fw.bold : fw.medium, background: today ? v.primary : undefined, color: today ? v.primaryText : undefined, alignSelf: "flex-start" }}>
        {Number(date.slice(8))}
      </span>
      <span className="ws-num" style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: fw.bold, fontSize: compact ? fs.sm : fs.md, letterSpacing: 0.2, wordBreak: "break-all", lineHeight: 1.1 }}>
        {d?.code ?? ""}
      </span>
      {!compact && d?.shiftCode && <span style={{ position: "absolute", bottom: space[1], right: space[2], fontSize: fs.chip, fontWeight: fw.semibold, color: v.textSecondary }}>{d.shiftCode}</span>}
      <span style={{ position: "absolute", top: compact ? 2 : space[1], right: compact ? 2 : space[2], fontSize: fs.chip, display: "flex", gap: 2, alignItems: "center" }}>
        {d?.missingPunch && <span title="One punch only" style={{ width: 7, height: 7, borderRadius: 7, background: v.danger, display: "inline-block" }} />}
        {d?.corrected && <EditOutlined title={d.overrideKind === "MANUAL_OVERRIDE" ? "Overridden by HR (not from the device)" : "Corrected: an approved request (not from the device)"} />}
        {d?.request?.status === "PENDING" && <ClockCircleOutlined title="Request waiting for approval" />}
        {d?.capture === "MANUAL" && d.source === "MANUAL" && <span title={d.statusOnly ? "Marked by hand, status only" : "Marked by hand"}>{d.statusOnly ? "S" : "M"}</span>}
      </span>
    </button>
  );
});

function Legend() {
  const item = (node: React.ReactNode, text: string) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: space[1] + 2, color: v.textSecondary }}>
      {node}
      {text}
    </span>
  );
  return (
    <div style={{ marginTop: space[4], paddingTop: space[4], borderTop: `1px solid ${v.borderDefault}`, display: "flex", flexDirection: "column", gap: space[2], fontSize: fs.sm }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${space[2]}px ${space[4]}px` }}>
        {STATUS_LEGEND.map((s) => {
          const t = statusTone(s.code);
          return item(
            <span key={s.code} style={{ background: t.bg, color: t.fg, borderRadius: radius.xs, padding: "1px 6px", fontWeight: fw.bold, fontSize: fs.xs }}>
              {s.code}
            </span>,
            s.label,
          );
        })}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: `${space[2]}px ${space[4]}px` }}>
        {item(<span style={{ width: 7, height: 7, borderRadius: 7, background: v.danger, display: "inline-block" }} />, "one punch only")}
        {item(<EditOutlined />, "corrected by hand (a request or an HR override)")}
        {item(<ClockCircleOutlined />, "request waiting")}
        {item(<span style={{ fontWeight: fw.bold }}>M</span>, "marked by hand · S status only")}
      </div>
    </div>
  );
}
