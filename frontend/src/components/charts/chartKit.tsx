import type { ReactNode } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useThemeMode } from "../../theme/ThemeProvider";
import { useChartColors } from "../../theme/chartPalette";
import { fs, fw, radius, shadow, space, v } from "../../theme/tokens";

// Chart building blocks in the board's style (DESIGN_SYSTEM.md §6.10, home-02 / reports-02 / reports-05): tooltips as cards, a legend that is always
// present (label · value, never colour alone), donuts with the total in the centre, columns with rounded tops on grey tracks, smooth lines.

export interface LegendItem {
  label: string;
  color: string;
  value?: ReactNode;
}

/** Dot · label · value. `layout="row"` for a series key above a chart, `"list"` for a donut's breakdown. */
export function ChartLegend({ items, layout = "row" }: { items: LegendItem[]; layout?: "row" | "list" }) {
  const list = layout === "list";
  return (
    <ul
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        display: "flex",
        flexDirection: list ? "column" : "row",
        flexWrap: list ? "nowrap" : "wrap",
        gap: list ? space[2] : `${space[1]}px ${space[4]}px`,
        fontSize: list ? fs.md : fs.sm,
        color: v.textBody,
      }}
    >
      {items.map((it) => (
        <li key={it.label} style={{ display: "flex", alignItems: "center", gap: space[2], minWidth: 0 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: radius.pill, background: it.color, flex: "none" }} />
          <span style={{ flex: list ? 1 : undefined, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.label}</span>
          {it.value !== undefined && (
            <span className="ws-num" style={{ fontWeight: fw.bold, color: v.textPrimary }}>
              {it.value}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

interface TooltipPayloadEntry {
  name?: string | number;
  value?: string | number;
  color?: string;
  payload?: { fill?: string } & Record<string, unknown>;
}

/** recharts `content` for a tooltip that looks like the board's small card (reports-05). */
export function ChartTooltipCard({ active, payload, label }: { active?: boolean; payload?: TooltipPayloadEntry[]; label?: string | number }) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, boxShadow: shadow.popover, padding: `${space[2]}px ${space[3]}px`, fontSize: fs.sm, minWidth: 120 }}>
      {label !== undefined && label !== "" && <div style={{ fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[1] }}>{label}</div>}
      {payload.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: space[2], color: v.textBody }}>
          <span aria-hidden style={{ width: 8, height: 8, borderRadius: radius.pill, background: p.color ?? p.payload?.fill, flex: "none" }} />
          <span>{p.name}</span>
          <span className="ws-num" style={{ marginLeft: "auto", fontWeight: fw.semibold, color: v.textPrimary }}>
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function useColors() {
  const { mode } = useThemeMode();
  return useChartColors(mode);
}

const LEGEND_ROW = 28;

/** Donut with the total in the centre and a legend list (label · value) beside it, or below it on narrow cards. */
export function DonutChart({ data, totalLabel, height }: { data: { name: string; value: number }[]; totalLabel: string; height: number }) {
  const colors = useColors();
  const total = data.reduce((s, d) => s + d.value, 0);
  const color = (i: number) => colors.categorical[i % colors.categorical.length]!;
  const size = Math.min(200, height - space[4]);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: space[6], height: "100%", overflow: "hidden" }}>
      <div style={{ position: "relative", width: size, height: size, flex: "none" }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={2} cornerRadius={4} stroke="none" isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={d.name} fill={color(i)} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltipCard />} />
          </PieChart>
        </ResponsiveContainer>
        <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <span className="ws-num" style={{ fontSize: fs.h1, fontWeight: fw.bold, color: v.textPrimary, lineHeight: 1.2 }}>
            {total}
          </span>
          <span style={{ fontSize: fs.sm, color: v.textSecondary }}>{totalLabel}</span>
        </div>
      </div>
      <div style={{ flex: "1 1 160px", minWidth: 140, maxWidth: 260 }}>
        <ChartLegend layout="list" items={data.map((d, i) => ({ label: d.name, color: color(i), value: d.value }))} />
      </div>
    </div>
  );
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Columns with rounded tops on full-height grey tracks and the value above each bar (reports-05). */
export function ColumnChart({ data, seriesLabel, height }: { data: { name: string; count: number }[]; seriesLabel: string; height: number }) {
  const colors = useColors();
  const many = data.length > 6;
  return (
    <div style={{ height }}>
      <div style={{ height: LEGEND_ROW }}>
        <ChartLegend items={[{ label: seriesLabel, color: colors.sequential }]} />
      </div>
      <div style={{ height: height - LEGEND_ROW }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 20, right: 4, left: 0, bottom: 0 }} barCategoryGap={many ? "18%" : "28%"}>
            <CartesianGrid stroke={colors.ink.grid} vertical={false} strokeDasharray="3 3" />
            <XAxis
              dataKey="name"
              interval={0}
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: fs.xs, fill: colors.ink.muted }}
              tickFormatter={(s: string) => truncate(s, many ? 8 : 14)}
            />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: fs.xs, fill: colors.ink.muted }} width={32} />
            <Tooltip content={<ChartTooltipCard />} cursor={false} />
            <Bar dataKey="count" name={seriesLabel} fill={colors.sequential} radius={[6, 6, 0, 0]} maxBarSize={48} background={{ fill: colors.track, radius: 6 }} isAnimationActive={false}>
              <LabelList dataKey="count" position="top" style={{ fontSize: fs.xs, fontWeight: fw.semibold, fill: colors.ink.primary }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Smooth lines (home-02) with a series key above. */
export function SmoothLineChart<T extends Record<string, unknown>>({
  data,
  xKey,
  series,
  height,
  showValues,
}: {
  data: T[];
  xKey: keyof T & string;
  series: { key: keyof T & string; label: string; color?: string }[];
  height: number;
  showValues?: boolean;
}) {
  const colors = useColors();
  const withColor = series.map((s, i) => ({ ...s, color: s.color ?? colors.categorical[i % colors.categorical.length]! }));
  return (
    <div style={{ height }}>
      <div style={{ height: LEGEND_ROW }}>
        <ChartLegend items={withColor.map((s) => ({ label: s.label, color: s.color }))} />
      </div>
      <div style={{ height: height - LEGEND_ROW }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={colors.ink.grid} horizontal={false} strokeDasharray="3 3" />
            <XAxis dataKey={xKey} tickLine={false} axisLine={false} tick={{ fontSize: fs.xs, fill: colors.ink.muted }} />
            <YAxis tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: fs.xs, fill: colors.ink.muted }} width={32} />
            <Tooltip content={<ChartTooltipCard />} cursor={{ stroke: colors.ink.grid, strokeWidth: 24, strokeOpacity: 0.5 }} />
            {withColor.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2.5} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: v.bgSurface }} isAnimationActive={false}>
                {showValues && <LabelList dataKey={s.key} position="top" style={{ fontSize: fs.xs, fill: colors.ink.secondary }} />}
              </Line>
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
