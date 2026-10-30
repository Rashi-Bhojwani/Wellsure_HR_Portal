import { useMemo, useState, type ReactNode } from "react";
import { RequireAccess } from "../../../components/common/RequireAccess";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, LabelList } from "recharts";
import * as leaveApi from "../../../api/leave";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, CardGrid, EmptyState, PageHeader, Panel, Skel, Stack, useIsPhone } from "../../../ui";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_HEIGHT = 260;

const tooltipStyle = {
  contentStyle: { background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, fontSize: fs.sm, color: v.textPrimary },
  itemStyle: { color: v.textBody },
  labelStyle: { color: v.textSecondary },
  cursor: false as const,
};

function ChartPanel({ title, subtitle, filter, children }: { title: string; subtitle?: string; filter?: { value: string; options: string[]; onChange?: (val: string) => void; label: string }; children: ReactNode }) {
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      extra={
        filter && (
          <Select
            aria-label={filter.label}
            size="small"
            value={filter.value}
            style={{ width: 130 }}
            onChange={filter.onChange}
            disabled={!filter.onChange}
            options={filter.options.map((o) => ({ value: o, label: o === "All" ? "All types" : o }))}
          />
        )
      }
      style={{ height: "100%" }}
    >
      <div style={{ minHeight: CHART_HEIGHT }}>{children}</div>
    </Panel>
  );
}

const noData = (title: string) => <EmptyState compact illustration="chart" title={title} description={null} />;

// Workforce Overview (docs/UI_REFERENCE.md §2.3) — real data from
// GET /api/leave/dashboard (leave.view; company-wide for ALL scope, the
// viewer's team otherwise — E1.1). One fetch per selected
// year drives both the month-strip donut and the two "Category: All"
// filters client-side, since the whole year's (month, leaveTypeCode)
// matrix is small enough to slice locally without extra round trips.
// The overview is leave usage across the organisation: when a director has switched off "See leave counts" for the person, they see the forbidden state, not an error.
export function WorkforceOverviewPage() {
  return (
    <RequireAccess needs={{ any: ["leave.view"] }}>
      <WorkforceOverviewBody />
    </RequireAccess>
  );
}

function WorkforceOverviewBody() {
  const year = new Date().getFullYear();
  const phone = useIsPhone();
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [pieFilter, setPieFilter] = useState("All");
  const [barFilter, setBarFilter] = useState("All");
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);

  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["leave", "dashboard", year], queryFn: () => leaveApi.getWorkforceDashboard(year) });
  const leaveTypes = useMemo(() => data?.leaveTypes ?? [], [data]);
  const byMonthAndType = useMemo(() => data?.byMonthAndType ?? [], [data]);
  const rhBreakdown = data?.rhBreakdown ?? [];

  const leaveTypeBreakdown = useMemo(() => {
    const types = pieFilter === "All" ? leaveTypes : [pieFilter];
    return types.map((type) => ({
      type,
      colour: colors.categorical[Math.max(0, leaveTypes.indexOf(type)) % colors.categorical.length]!,
      value: byMonthAndType.filter((e) => e.month === selectedMonth + 1 && e.leaveTypeCode === type).reduce((sum, e) => sum + e.days, 0),
    }));
  }, [leaveTypes, byMonthAndType, selectedMonth, pieFilter, colors.categorical]);
  const total = leaveTypeBreakdown.reduce((sum, l) => sum + l.value, 0);

  const monthlyLeaves = useMemo(() => {
    const types = barFilter === "All" ? leaveTypes : [barFilter];
    return MONTHS.map((m, i) => ({
      month: m,
      total: byMonthAndType.filter((e) => e.month === i + 1 && types.includes(e.leaveTypeCode)).reduce((sum, e) => sum + e.days, 0),
    }));
  }, [leaveTypes, byMonthAndType, barFilter]);
  const yearTotal = monthlyLeaves.reduce((s, m) => s + m.total, 0);

  const typeFilterOptions = ["All", ...leaveTypes];
  const axisTick = { fontSize: fs.xs, fill: colors.ink.muted };
  const valuePill = { fontSize: fs.xs, fill: colors.ink.primary, fontWeight: fw.semibold };

  return (
    <>
      <PageHeader title="Workforce Overview" subtitle={`Leave usage · Jan ${year} – Dec ${year}`} />
      <Stack>
        <HelpStrip storageKey="workforce-overview">This page summarises leave usage patterns across the organisation for the selected month.</HelpStrip>
        {data?.scope === "team" && <ApprovalBanner tone="info" title="Showing your team only — you and the people who report to you." />}

        {/* Month strip: pill tiles, scrolls sideways on phones. */}
        <div role="radiogroup" aria-label="Month" style={{ display: "flex", gap: space[2], overflowX: "auto", paddingBottom: 2, scrollbarWidth: "none" }}>
          {MONTHS.map((m, i) => {
            const active = i === selectedMonth;
            return (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setSelectedMonth(i)}
                style={{
                  flex: phone ? "0 0 auto" : "1 1 0",
                  minWidth: 56,
                  height: phone ? 44 : 40,
                  borderRadius: radius.pill,
                  border: `1px solid ${active ? v.primary : v.borderControl}`,
                  background: active ? v.primary : v.bgSurface,
                  color: active ? v.primaryText : v.textBody,
                  fontSize: fs.md,
                  fontWeight: active ? fw.semibold : fw.medium,
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                {m}
              </button>
            );
          })}
        </div>

        {error ? (
          <Panel>
            <EmptyState kind="error" onRetry={() => void refetch()} compact />
          </Panel>
        ) : (
          <CardGrid min={320}>
            <ChartPanel title="Type of leaves taken" subtitle={`${MONTHS[selectedMonth]} ${year}`} filter={{ label: "Leave type (donut)", value: pieFilter, options: typeFilterOptions, onChange: setPieFilter }}>
              {isLoading ? (
                <Skel h={CHART_HEIGHT} r={radius.md} />
              ) : total === 0 ? (
                noData("No leave taken this month")
              ) : (
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[4] }}>
                  <div style={{ position: "relative", width: "100%", height: 180 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={leaveTypeBreakdown} dataKey="value" nameKey="type" innerRadius={56} outerRadius={84} paddingAngle={2} stroke="none" isAnimationActive={false}>
                          {leaveTypeBreakdown.map((entry) => (
                            <Cell key={entry.type} fill={entry.colour} />
                          ))}
                        </Pie>
                        <Tooltip {...tooltipStyle} />
                      </PieChart>
                    </ResponsiveContainer>
                    <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
                      <span className="ws-num" style={{ fontSize: fs.h1, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.1 }}>
                        {total}
                      </span>
                      <span style={{ fontSize: fs.xs, color: v.textSecondary }}>Leaves taken</span>
                    </div>
                  </div>
                  <ul aria-label="Legend" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${space[2]}px ${space[4]}px` }}>
                    {leaveTypeBreakdown.map((l) => (
                      <li key={l.type} style={{ display: "inline-flex", alignItems: "center", gap: space[2], fontSize: fs.sm, color: v.textSecondary }}>
                        <span aria-hidden style={{ width: 10, height: 10, borderRadius: radius.pill, background: l.colour }} />
                        {l.type}
                        <span className="ws-num" style={{ fontWeight: fw.bold, color: v.textPrimary }}>
                          {l.value}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </ChartPanel>

            <ChartPanel title="Total leaves taken this year" subtitle={`${yearTotal} day(s) in ${year}`} filter={{ label: "Leave type (year)", value: barFilter, options: typeFilterOptions, onChange: setBarFilter }}>
              {isLoading ? (
                <Skel h={CHART_HEIGHT} r={radius.md} />
              ) : yearTotal === 0 ? (
                noData("No leave taken this year")
              ) : (
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <BarChart data={monthlyLeaves} margin={{ top: 20, right: 4, left: 4, bottom: 0 }} barCategoryGap="20%">
                    <XAxis dataKey="month" tick={axisTick} axisLine={false} tickLine={false} interval={0} tickFormatter={(m: string) => m.slice(0, phone ? 1 : 3)} />
                    <YAxis hide />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="total" name="Leaves" fill={colors.sequential} radius={[6, 6, 6, 6]} background={{ fill: colors.track, radius: 6 }} isAnimationActive={false}>
                      {!phone && <LabelList dataKey="total" position="top" style={valuePill} formatter={(val: unknown) => (Number(val) > 0 ? String(val) : "")} />}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartPanel>

            <ChartPanel title="Employees on Leave for each RH" subtitle="Restricted holidays taken">
              {isLoading ? (
                <Skel h={CHART_HEIGHT} r={radius.md} />
              ) : rhBreakdown.length === 0 ? (
                noData("No records found")
              ) : (
                <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                  <BarChart data={rhBreakdown} margin={{ top: 20, right: 4, left: 4, bottom: 0 }} barCategoryGap="25%">
                    <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} />
                    <YAxis hide allowDecimals={false} />
                    <Tooltip {...tooltipStyle} />
                    <Bar dataKey="employeeCount" name="Employees" fill={colors.categorical[2]} radius={[6, 6, 6, 6]} background={{ fill: colors.track, radius: 6 }} isAnimationActive={false}>
                      <LabelList dataKey="employeeCount" position="top" style={valuePill} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartPanel>
          </CardGrid>
        )}
      </Stack>
    </>
  );
}
