import { useState } from "react";
import { Button, Form, Input, InputNumber, Select, Tabs } from "antd";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiErrorMessage } from "../../lib/apiError";
import { DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../ui";
import * as api from "./api";

// Insights (Peeps stage 2): aggregate figures for the directors and Wellsure Office members with the Insights capability. Every
// definition, the window, the early-attrition threshold and the minimum group size are director settings, Not set until chosen;
// small groups show no figure. No individual, no exit interview, no pay.

const METRICS: Array<{ key: api.Metric; label: string }> = [{ key: "turnover", label: "Turnover" }, { key: "tenure", label: "Tenure" }, { key: "exit-reasons", label: "Exit reasons" }, { key: "hiring-funnel", label: "Hiring funnel" }];
const SETTING_LABELS: Record<string, string> = { minimumGroupSize: "Minimum group size", window: "Date window", earlyAttrition: "Early-attrition threshold", turnover: "Turnover definition", tenure: "Tenure definition", exitReasons: "Exit-reason source", hiringFunnel: "Hiring-funnel definition" };
const VALUE_LABELS: Record<string, string> = { leavers: "Leavers", earlyLeavers: "Early leavers", headcount: "Headcount", turnoverPercent: "Turnover %", medianTenureMonths: "Median tenure (months)", applications: "Applications" };
const required = [{ required: true, message: "This field is required." }];

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

function SettingEditor({ setting, onDone }: { setting: api.Setting; onDone: () => void }) {
  const [form] = Form.useForm();
  const client = useQueryClient();
  const work = useMutation({ mutationFn: (v: { value: unknown; reason: string }) => api.saveSetting(setting, v.value, v.reason), onSuccess: () => { void client.invalidateQueries({ queryKey: ["insights"] }); toast.success("Insights setting confirmed."); onDone(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not save this setting.")) });
  const k = setting.key;
  return (
    <Form form={form} layout="vertical" initialValues={{ value: setting.value }} onFinish={(v: { value: unknown; reason: string }) => work.mutate(v)}>
      {k === "minimumGroupSize" && <Form.Item name={["value", "n"]} label="Hide any group with fewer people than" rules={required}><InputNumber min={2} max={1000} precision={0} /></Form.Item>}
      {(k === "window" || k === "earlyAttrition") && <Form.Item name={["value", "months"]} label={k === "window" ? "Months, ending today" : "A leaver counts as early if they left within (months)"} rules={required}><InputNumber min={1} max={120} precision={0} /></Form.Item>}
      {k === "turnover" && <Form.Item name={["value", "denominator"]} label="Divide leavers by" rules={required}><Select placeholder="Choose" options={[{ value: "AVERAGE_HEADCOUNT", label: "Average of opening and closing headcount" }, { value: "OPENING_HEADCOUNT", label: "Opening headcount" }]} /></Form.Item>}
      {k === "tenure" && <Form.Item name={["value", "basis"]} label="Measure tenure of" rules={required}><Select placeholder="Choose" options={[{ value: "ACTIVE_AT_END", label: "People employed at the end of the window" }, { value: "LEAVERS_IN_WINDOW", label: "People who left during the window" }]} /></Form.Item>}
      {k === "exitReasons" && <Form.Item name={["value", "source"]} label="Group exits by" rules={required}><Select placeholder="Choose" options={[{ value: "SEPARATION_MODE", label: "Separation mode" }, { value: "RESIGNATION_REASON_CATEGORY", label: "Resignation reason category" }]} /></Form.Item>}
      {k === "hiringFunnel" && <Form.Item name={["value", "basis"]} label="Count each application at" rules={required}><Select placeholder="Choose" options={[{ value: "FURTHEST_STAGE", label: "The furthest stage it reached" }]} /></Form.Item>}
      <Form.Item name="reason" label="Reason for this setting change" rules={required}><Input.TextArea rows={2} maxLength={2000} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={work.isPending}>Confirm setting</Button>
    </Form>
  );
}

function SettingsPanel() {
  const q = useQuery({ queryKey: ["insights", "settings"], queryFn: api.settings });
  const [editing, setEditing] = useState<string | null>(null);
  const row = q.data?.settings.find((s) => s.key === editing);
  return (
    <Panel title="Insights settings" subtitle="Every value starts Not set; a director chooses each one.">
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {q.data && (
          <Stack>
            <DataTable<api.Setting> rowKey="key" dataSource={q.data.settings} pagination={false}
              columns={[
                { title: "Setting", dataIndex: "key", render: (key: string) => SETTING_LABELS[key] ?? key },
                { title: "State", dataIndex: "state", render: (s: string) => <StatusChip>{s === "NOT_SET" ? "Not set" : "Confirmed"}</StatusChip> },
                ...(q.data.canEdit ? [{ title: "", key: "edit", render: (_: unknown, r: api.Setting) => <Button onClick={() => setEditing(r.key)}>Choose</Button> }] : []),
              ]}
              mobile={{ title: (r) => SETTING_LABELS[r.key] ?? r.key, status: (r) => <StatusChip>{r.state === "NOT_SET" ? "Not set" : "Confirmed"}</StatusChip>, ...(q.data.canEdit ? { actions: (r: api.Setting) => <Button onClick={() => setEditing(r.key)}>Choose</Button> } : {}) }} />
            {row && <Panel title={SETTING_LABELS[row.key] ?? row.key}><SettingEditor key={`${row.key}-${row.version}`} setting={row} onDone={() => setEditing(null)} /></Panel>}
          </Stack>
        )}
      </QueryState>
    </Panel>
  );
}

function MetricView({ metric, missing }: { metric: api.Metric; missing: string[] }) {
  const q = useQuery({ queryKey: ["insights", "metric", metric], queryFn: () => api.metric(metric), enabled: missing.length === 0, retry: false });
  const download = useMutation({ mutationFn: () => api.exportCsv(metric).then((b) => save(b, `insights-${metric}.csv`)), onError: (e) => toast.error(apiErrorMessage(e, "Could not export.")) });
  if (missing.length) return <EmptyState title="Not set" description={`A director must choose: ${missing.map((m) => SETTING_LABELS[m] ?? m).join(", ")}.`} />;
  const keys = [...new Set((q.data?.table.cells ?? []).flatMap((c) => Object.keys(c.value ?? {})).concat(Object.keys(q.data?.table.total.value ?? {})))];
  const show = (c: { suppressed: boolean; value: Record<string, string | number | null> | null }, k: string) => (c.suppressed ? "Hidden (small group)" : String(c.value?.[k] ?? "—"));
  return (
    <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
      {q.data && (
        <Stack>
          <KeyValueGrid items={[{ label: "Window", value: `${q.data.window.from} to ${q.data.window.to}` }, { label: "Groups smaller than", value: `${q.data.minimumGroupSize} people are hidden` }, { label: "Total", value: q.data.table.total.suppressed ? "Hidden (small group)" : keys.map((k) => `${VALUE_LABELS[k] ?? k}: ${q.data!.table.total.value?.[k] ?? "—"}`).join(" · ") }]} />
          <DataTable<api.Cell> rowKey="key" dataSource={q.data.table.cells} pagination={false} empty={<EmptyState title="No data in this window" compact />}
            columns={[{ title: metric === "exit-reasons" ? "Reason" : metric === "hiring-funnel" ? "Furthest stage" : "Department", dataIndex: "label" }, { title: "People", key: "n", render: (_: unknown, c: api.Cell) => (c.suppressed ? "—" : c.n) }, ...keys.map((k) => ({ title: VALUE_LABELS[k] ?? k, key: k, render: (_: unknown, c: api.Cell) => show(c, k) }))]}
            mobile={{ title: (c) => c.label, status: (c) => (c.suppressed ? <StatusChip>Hidden</StatusChip> : null), fields: keys.slice(0, 3).map((k) => ({ label: VALUE_LABELS[k] ?? k, render: (c: api.Cell) => show(c, k) })) }} />
          <Button onClick={() => download.mutate()} loading={download.isPending}>Export CSV</Button>
        </Stack>
      )}
    </QueryState>
  );
}

export function InsightsPage() {
  const s = useQuery({ queryKey: ["insights", "status"], queryFn: api.status });
  return (
    <>
      <PageHeader title="Insights" subtitle="Aggregate figures only. Small groups are hidden; no individual, exit interview or pay appears." />
      <QueryState isLoading={s.isLoading} error={s.error} onRetry={() => void s.refetch()}>
        {s.data && (s.data.allowed ? (
          <Stack>
            <Tabs items={METRICS.map((m) => ({ key: m.key, label: m.label, children: <MetricView metric={m.key} missing={s.data!.missing[m.key] ?? []} /> }))} />
            <SettingsPanel />
          </Stack>
        ) : <EmptyState kind="forbidden" title="No access" description="Insights are for the directors and Wellsure Office members with the Insights capability." />)}
      </QueryState>
    </>
  );
}
