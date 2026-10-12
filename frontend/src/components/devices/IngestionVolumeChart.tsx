import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Empty, Segmented, Select, Space, Switch, Table, Typography } from "antd";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import * as biometricApi from "../../api/biometric";
import type { VolumeBucket } from "../../api/biometric";
import { useThemeMode } from "../../theme/ThemeProvider";

const { Text } = Typography;

// Ingestion volume per route (spec §4.7, docs/plans/PHASE_2.md "P2-H build
// design"): punches stored, by hour for today or by day for the last 30, for
// one device or all. Three routes make three series, so the first three slots
// of the reference categorical palette, which validate for every pair in both
// modes (agent blue, ADMS push orange, file upload aqua). The aqua is below 3:1
// on the light surface, so the series are named in a legend and every figure is
// also in the table view ("Show as table"): colour is never the only way to
// tell them apart.
const ROUTES = [
  { key: "AGENT", label: "Sync agent", light: "#2a78d6", dark: "#3987e5" },
  { key: "PUSH", label: "ADMS push", light: "#eb6834", dark: "#d95926" },
  { key: "IMPORT", label: "File upload", light: "#1baf7a", dark: "#199e70" },
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
  const [scope, setScope] = useState<"today" | "30d">("today");
  const [deviceId, setDeviceId] = useState<string | undefined>();
  const [asTable, setAsTable] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey: ["biometric", "volume", scope, deviceId], queryFn: () => biometricApi.ingestionVolume(scope, deviceId), refetchInterval: 60_000 });
  const rows = toRows(data, scope);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const dark = mode === "dark";
  const ink = dark ? "#c3c2b7" : "#52514e";
  const grid = dark ? "#333331" : "#e6e5e1";
  const surface = dark ? "#1a1a19" : "#fcfcfb";
  const colour = (r: (typeof ROUTES)[number]) => (dark ? r.dark : r.light);
  const label = (b: string) => (scope === "today" ? b.slice(11) : b.slice(5));

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Segmented<"today" | "30d"> value={scope} onChange={setScope} options={[{ value: "today", label: "Today, by hour" }, { value: "30d", label: "Last 30 days, by day" }]} />
        <Select allowClear placeholder="All devices" aria-label="Device" style={{ width: 240 }} value={deviceId} onChange={setDeviceId} options={devices.map((d) => ({ value: d.id, label: d.name }))} />
        <Switch checked={asTable} onChange={setAsTable} aria-label="Show as table" /> <Text type="secondary">Show as table</Text>
      </Space>
      <Text type="secondary">
        {total.toLocaleString("en-IN")} new punches stored {scope === "today" ? "today" : "in the last 30 days"}, by the route they arrived on (duplicates and rejected lines are not counted).
      </Text>
      {total === 0 && !isLoading ? (
        <Empty description="No punches have arrived in this period." image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : asTable ? (
        <Table<Row>
          size="small"
          rowKey="bucket"
          pagination={false}
          dataSource={[...rows].reverse()}
          columns={[
            { title: scope === "today" ? "Hour (IST)" : "Day", dataIndex: "bucket" },
            ...ROUTES.map((r) => ({ title: r.label, dataIndex: r.key })),
            { title: "Total", dataIndex: "total" },
          ]}
        />
      ) : (
        <div role="img" aria-label={`Punches stored per ${scope === "today" ? "hour" : "day"}, by route. Use Show as table for the figures.`} style={{ width: "100%", height: 280 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={grid} vertical={false} />
              <XAxis dataKey="bucket" tickFormatter={label} tick={{ fill: ink, fontSize: 12 }} tickLine={false} axisLine={{ stroke: grid }} interval="preserveStartEnd" />
              <YAxis allowDecimals={false} tick={{ fill: ink, fontSize: 12 }} tickLine={false} axisLine={false} width={40} />
              <Tooltip
                cursor={{ fill: grid, opacity: 0.4 }}
                labelFormatter={(b) => (scope === "today" ? `${String(b).slice(11)} IST` : String(b))}
                contentStyle={{ background: surface, border: `1px solid ${grid}`, color: ink }}
                itemStyle={{ color: ink }}
              />
              <Legend wrapperStyle={{ color: ink }} />
              {ROUTES.map((r) => (
                // A 2px surface gap between stacked fills, as the chart spec asks.
                <Bar key={r.key} dataKey={r.key} name={r.label} stackId="punches" fill={colour(r)} stroke={surface} strokeWidth={2} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Space>
  );
}
