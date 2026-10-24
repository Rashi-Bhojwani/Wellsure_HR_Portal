import { Bar, BarChart, Cell, LabelList, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { ReportBreakdown } from "@shared/constants/reports";
import { CHART_HEIGHT, type ChartKind } from "./reportChartKinds";
import { useThemeMode } from "../../../theme/ThemeProvider";
import { useChartColors } from "../../../theme/chartPalette";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

// Charts for a report's breakdowns — only the aggregates the API already returns (label + count), never invented figures (DESIGN_SYSTEM.md
// §1.5 / §6.10): a donut with the total in the centre and a legend with values (≤ 6 slices, the palette has 6 fixed slots), a vertical bar chart
// on grey tracks for months (reports-05), and labelled horizontal bars for longer category lists. Colour is never the only signal: every
// chart shows its labels and values as text.

const fmt = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

function points(b: ReportBreakdown) {
  const [labelCol, valueCol] = b.columns;
  return b.rows.map((r) => ({ label: String(r[labelCol!.key] ?? "—"), value: Number(r[valueCol!.key] ?? 0) }));
}

function ChartTooltip({ active, payload, unit }: { active?: boolean; payload?: { payload: { label: string; value: number } }[]; unit: string }) {
  const p = active ? payload?.[0]?.payload : undefined;
  if (!p) return null;
  return (
    <div style={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, padding: `${space[2]}px ${space[3]}px`, fontSize: fs.sm, boxShadow: "0 8px 24px var(--ws-shadow-color)" }}>
      <div style={{ color: v.textSecondary }}>{p.label}</div>
      <div style={{ color: v.textPrimary, fontWeight: fw.semibold, fontVariantNumeric: "tabular-nums" }}>
        {fmt(p.value)} {unit.toLowerCase()}
      </div>
    </div>
  );
}

export function BreakdownChart({ breakdown, kind }: { breakdown: ReportBreakdown; kind: ChartKind }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  const data = points(breakdown);
  const unit = breakdown.columns[1]?.header ?? "";
  const summary = `${breakdown.title}: ${data.map((d) => `${d.label} ${fmt(d.value)}`).join(", ")}`;

  if (kind === "donut") {
    const total = data.reduce((s, d) => s + d.value, 0);
    return (
      <figure role="img" aria-label={summary} style={{ margin: 0 }}>
        <div style={{ position: "relative", height: CHART_HEIGHT - 72 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={data} dataKey="value" nameKey="label" innerRadius="62%" outerRadius="95%" paddingAngle={data.length > 1 ? 2 : 0} stroke="none" isAnimationActive={false}>
                {data.map((d, i) => (
                  <Cell key={d.label} fill={colors.categorical[i]!} />
                ))}
              </Pie>
              <Tooltip content={<ChartTooltip unit={unit} />} />
            </PieChart>
          </ResponsiveContainer>
          <div aria-hidden style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
            <span style={{ fontSize: fs.h2, fontWeight: fw.bold, color: v.textPrimary, fontVariantNumeric: "tabular-nums" }}>{fmt(total)}</span>
            <span style={{ fontSize: fs.xs, color: v.textSecondary }}>Total</span>
          </div>
        </div>
        <ul aria-hidden style={{ listStyle: "none", margin: `${space[4]}px 0 0`, padding: 0, display: "flex", flexWrap: "wrap", justifyContent: "center", gap: `${space[2]}px ${space[4]}px` }}>
          {data.map((d, i) => (
            <li key={d.label} style={{ display: "inline-flex", alignItems: "center", gap: space[2], fontSize: fs.sm, color: v.textSecondary }}>
              <span style={{ width: 8, height: 8, borderRadius: radius.pill, background: colors.categorical[i] }} />
              {d.label}
              <strong style={{ color: v.textPrimary, fontWeight: fw.semibold, fontVariantNumeric: "tabular-nums" }}>{fmt(d.value)}</strong>
            </li>
          ))}
        </ul>
      </figure>
    );
  }

  if (kind === "months") {
    return (
      <figure role="img" aria-label={summary} style={{ margin: 0, height: CHART_HEIGHT }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 24, right: 4, left: -16, bottom: 0 }}>
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: colors.ink.secondary, fontSize: fs.xs }} interval="preserveStartEnd" />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: colors.ink.secondary, fontSize: fs.xs }} width={40} />
            <Tooltip cursor={false} content={<ChartTooltip unit={unit} />} />
            <Bar dataKey="value" fill={colors.sequential} radius={[8, 8, 8, 8]} maxBarSize={40} background={{ fill: colors.track, radius: 8 }} isAnimationActive={false}>
              <LabelList dataKey="value" position="top" formatter={(n: unknown) => (Number(n) > 0 ? fmt(Number(n)) : "")} style={{ fill: colors.ink.primary, fontSize: fs.xs, fontWeight: fw.semibold }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </figure>
    );
  }

  // Longer category lists: labelled horizontal bars on tracks, scrolling inside the reserved height.
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul aria-label={summary} style={{ listStyle: "none", margin: 0, padding: `0 ${space[1]}px 0 0`, height: CHART_HEIGHT, overflowY: "auto", display: "flex", flexDirection: "column", gap: space[3] }}>
      {data.map((d) => (
        <li key={d.label}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: space[3], fontSize: fs.sm, marginBottom: space[1] }}>
            <span style={{ color: v.textBody, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{d.label}</span>
            <span style={{ color: v.textPrimary, fontWeight: fw.semibold, fontVariantNumeric: "tabular-nums" }}>{fmt(d.value)}</span>
          </div>
          <div style={{ height: 8, borderRadius: radius.pill, background: colors.track }}>
            <div style={{ width: `${(d.value / max) * 100}%`, height: "100%", borderRadius: radius.pill, background: colors.sequential }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
