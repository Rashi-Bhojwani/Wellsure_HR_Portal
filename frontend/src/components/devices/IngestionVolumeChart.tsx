import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Segmented, Select, Switch } from "antd";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as biometricApi from "../../api/biometric";
import type { VolumeBucket } from "../../api/biometric";
import { apiErrorMessage } from "../../lib/apiError";
import { useChartColors } from "../../theme/chartPalette";
import { useThemeMode } from "../../theme/ThemeProvider";
import { fs, radius, space, v } from "../../theme/tokens";
import { DataTable, EmptyState, Skel, useIsPhone } from "../../ui";

// Ingestion volume per route (spec §4.7, docs/plans/PHASE_2.md "P2-H build
// design"): punches stored, by hour for today or by day for the last 30, for
// one device or all. Three routes make three series, so the first three slots
// of the chart palette (theme/chartPalette, fixed order, stepped for dark).
// The series are named in a legend and every figure is also in the table view
// ("Show as table"): colour is never the only way to tell them apart.
const ROUTES = [
  { key: "AGENT", label: "Sync agent", slot: 0 },
  { key: "PUSH", label: "ADMS push", slot: 1 },
  { key: "IMPORT", label: "File upload", slot: 2 },
] as const;

type Row = { bucket: string; AGENT: number; PUSH: number; IMPORT: number; total: number };

function toRows(buckets: VolumeBucket[], scope: "today" | "30d"): Row[] {
  const byBucket = new Map<string, Row>();
  // Every hour so far today (or every one of the last 30 days) is on the axis, even when nothing arrived: a gap is information.
  const now = new Date(Date.now() + 330 * 60_000);
  if (scope === "today") {
    const day = now.toISOString().slice(0, 10);
    for (let h = 0; h <= now.getUTCHours(); h++) byBucket.set(`${day} ${String(h).padStart(2, "0")}:00`, { bucket: `${day} ${String(h).padStart(2, "0")}:00`, AGENT: 0, PUSH: 0, IMPORT: 0, total: 0 });
  } else {
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
      byBucket.set(d, { bucket: d, AGENT: 0, PUSH: 0, IMPORT: 0, total: 0 });
    }
  }
  for (const b of buckets) {
    const row = byBucket.get(b.bucket) ?? { bucket: b.bucket, AGENT: 0, PUSH: 0, IMPORT: 0, total: 0 };
    row[b.route] += b.punches;
    row.total += b.punches;
    byBucket.set(b.bucket, row);
  }
  return [...byBucket.values()].sort((a, b) => a.bucket.localeCompare(b.bucket));
}

export function IngestionVolumeChart({ devices }: { devices: Array<{ id: string; name: string }> }) {
  const { mode } = useThemeMode();
  const colors = useChartColors(mode);
  const phone = useIsPhone();
  const [scope, setScope] = useState<"today" | "30d">("today");
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [asTable, setAsTable] = useState(false);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "volume", scope, deviceId], queryFn: () => biometricApi.ingestionVolume(scope, deviceId), refetchInterval: 60_000 });
  const rows = toRows(data, scope);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const ink = colors.ink.secondary;
  const grid = colors.ink.grid;
  const label = (b: string) => (scope === "today" ? b.slice(11) : b.slice(5));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3], width: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center" }}>
        <Segmented<"today" | "30d">
          value={scope}
          onChange={setScope}
          block={phone}
          options={[
            { value: "today", label: "Today, by hour" },
            { value: "30d", label: "Last 30 days, by day" },
          ]}
        />
        <Select allowClear placeholder="All devices" aria-label="Device" style={{ width: phone ? "100%" : 240 }} value={deviceId} onChange={setDeviceId} options={devices.map((d) => ({ value: d.id, label: d.name }))} />
        <label style={{ display: "inline-flex", alignItems: "center", gap: space[2], minHeight: 44, color: v.textSecondary, cursor: "pointer" }}>
          <Switch checked={asTable} onChange={setAsTable} aria-label="Show as table" /> Show as table
        </label>
      </div>
      <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.md }}>
        {total.toLocaleString("en-IN")} new punches stored {scope === "today" ? "today" : "in the last 30 days"}, by the route they arrived on (duplicates and rejected lines are not counted).
      </p>
      {isLoading ? (
        <Skel h={280} />
      ) : error ? (
        <EmptyState kind="error" compact description={apiErrorMessage(error, "We couldn't load the volume. Try again.")} onRetry={() => void refetch()} />
      ) : total === 0 ? (
        <EmptyState compact illustration="chart" title="No punches have arrived in this period." description="Try the last 30 days, or another device." />
      ) : asTable ? (
        <DataTable<Row>
          density="compact"
          rowKey="bucket"
          pagination={false}
          dataSource={[...rows].reverse()}
          columns={[
            { title: scope === "today" ? "Hour (IST)" : "Day", dataIndex: "bucket" },
            ...ROUTES.map((r) => ({ title: r.label, dataIndex: r.key, align: "right" as const })),
            { title: "Total", dataIndex: "total", align: "right" as const },
          ]}
          mobile={{
            title: (r) => r.bucket,
            fields: [...ROUTES.map((rt) => ({ label: rt.label, render: (r: Row) => r[rt.key] })), { label: "Total", render: (r: Row) => r.total }],
          }}
        />
      ) : (
        <div role="img" aria-label={`Punches stored per ${scope === "today" ? "hour" : "day"}, by route. Use Show as table for the figures.`} style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={label} tick={{ fill: ink, fontSize: fs.sm }} tickLine={false} axisLine={{ stroke: grid }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fill: ink, fontSize: fs.sm }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ fill: colors.track, opacity: 0.6 }}
                labelFormatter={(b) => (scope === "today" ? `${String(b).slice(11)} IST` : String(b))}
                contentStyle={{ background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, fontSize: fs.sm, color: v.textPrimary }}
                itemStyle={{ color: v.textBody }}
              />
              <Legend wrapperStyle={{ color: ink, fontSize: fs.sm }} />
              {ROUTES.map((r) => (
                // A 2px surface gap between stacked fills, as the chart spec asks.
                <Bar key={r.key} dataKey={r.key} name={r.label} stackId="punches" fill={colors.categorical[r.slot]} stroke={v.bgSurface} strokeWidth={2} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
