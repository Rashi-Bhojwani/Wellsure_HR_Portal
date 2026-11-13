import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select } from "antd";
import * as api from "../../../api/policySettings";
import type { PolicySetting } from "../../../api/policySettings";
import type { PolicyField } from "@shared/constants/policySettings";
import { apiErrorMessage } from "../../../lib/apiError";
import { PageHeader, Panel, QueryState, SideDrawer, StatusChip, toast } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";

// M session block 2: System Settings → Policy settings (directors). Each setting is drawn from its description (shared/constants/policySettings.ts).
// Plain settings start with a conventional default ("Default, change in settings"); a setting that changes pay or leave has no effect until one
// director turns it on and a different director confirms; a value only the owners can choose stays Not set.

function fieldText(f: PolicyField, value: unknown): string {
  if (value === null || value === undefined || (Array.isArray(value) && value.length === 0)) return f.type === "codes" ? "none" : "not set";
  if (f.type === "boolean") return value ? "yes" : "no";
  if (f.type === "int") return `${String(value)}${f.unit ? ` ${f.unit}` : ""}`;
  if (f.type === "choice") return f.options.find((o) => o.value === value)?.label ?? String(value);
  if (f.type === "codes") return (value as string[]).join(", ");
  return `${(value as string[]).length} line(s)`;
}

function Summary({ s, value }: { s: PolicySetting; value: Record<string, unknown> | null }) {
  if (!value) return <span>{s.kind === "notSet" ? "Not set" : "Off"}</span>;
  return (
    <ul style={{ margin: 0, paddingLeft: space[5] }}>
      {s.kind === "activation" && <li>On: {value.active ? "yes" : "no"}</li>}
      {s.fields.map((f) => (
        <li key={f.name}>
          {f.label}: {fieldText(f, value[f.name])}
          {f.type === "lines" && Array.isArray(value[f.name]) && (
            <ul style={{ paddingLeft: space[5], color: v.textSecondary, fontSize: fs.sm }}>
              {(value[f.name] as string[]).map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function FieldInput({ f }: { f: PolicyField }) {
  if (f.type === "boolean") return <Form.Item name={f.name} label={f.label} rules={[{ required: true }]}><Select options={[{ value: true, label: "Yes" }, { value: false, label: "No" }]} /></Form.Item>;
  if (f.type === "int") return <Form.Item name={f.name} label={`${f.label}${f.unit ? ` (${f.unit})` : ""}`} rules={f.optional ? [] : [{ required: true }]} extra={f.optional ? "Leave empty for Not set" : undefined}><InputNumber min={f.min} max={f.max} style={{ width: "100%" }} /></Form.Item>;
  if (f.type === "choice") return <Form.Item name={f.name} label={f.label} rules={[{ required: true }]}><Select options={f.options.map((o) => ({ value: o.value, label: o.label }))} /></Form.Item>;
  if (f.type === "codes") return <Form.Item name={f.name} label={f.label} extra={f.help}><Select mode="tags" tokenSeparators={[",", " "]} aria-label={f.label} /></Form.Item>;
  return <Form.Item name={f.name} label={f.label} extra={f.help ?? "One per line"}><Input.TextArea rows={6} /></Form.Item>;
}

export function PolicySettingsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<PolicySetting | null>(null);
  const [form] = Form.useForm<Record<string, unknown>>();
  const q = useQuery({ queryKey: ["policy-settings"], queryFn: api.listPolicySettings });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["policy-settings"] });
  const propose = useMutation({
    mutationFn: (vals: Record<string, unknown>) => {
      const s = editing!;
      const value: Record<string, unknown> = {};
      if (s.kind === "activation") value.active = vals.active === true;
      for (const f of s.fields) {
        const raw = vals[f.name];
        value[f.name] = f.type === "lines" ? String(raw ?? "").split("\n").map((l) => l.trim()).filter(Boolean) : f.type === "codes" ? ((raw as string[] | undefined) ?? []).map((c) => c.trim()) : f.type === "int" && f.optional && (raw === undefined || raw === "") ? null : raw;
      }
      return api.proposePolicy(s.key, value, String(vals.reason ?? ""));
    },
    onSuccess: () => { toast.success("Proposed. A different director confirms it before it takes effect."); setEditing(null); refresh(); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not propose the change.")),
  });
  const confirm = useMutation({ mutationFn: api.confirmPolicy, onSuccess: () => { toast.success("Confirmed. It is in effect now."); refresh(); }, onError: (err) => toast.error(apiErrorMessage(err, "Could not confirm it.")) });
  const open = (s: PolicySetting) => {
    const start = s.value ?? s.suggestion ?? {};
    form.resetFields();
    const init: Record<string, unknown> = { reason: "" };
    if (s.kind === "activation") init.active = s.active ?? false;
    for (const f of s.fields) init[f.name] = f.type === "lines" ? ((start[f.name] as string[] | undefined) ?? []).join("\n") : start[f.name] ?? (f.type === "codes" ? [] : f.type === "choice" ? f.options[0]!.value : undefined);
    form.setFieldsValue(init);
    setEditing(s);
  };
  const areas = [...new Set((q.data ?? []).map((s) => s.area))];

  return (
    <>
      <PageHeader title="Policy settings" subtitle="One director proposes a change with a reason; it takes effect only when a different director confirms it. Settings that change pay or leave stay off until then." />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
          {areas.map((area) => (
            <section key={area} aria-label={area} style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
              <h2 style={{ margin: 0, fontSize: fs.lg }}>{area}</h2>
              {(q.data ?? []).filter((s) => s.area === area).map((s) => (
                <Panel key={s.key} title={s.title} subtitle={s.what} extra={<StatusChip tone={s.state === "CONFIRMED" ? "success" : s.state === "DEFAULT" ? "info" : "warning"}>{s.label ?? "Changed and confirmed"}</StatusChip>}>
                  <div style={{ marginBottom: space[2] }}>In effect: <Summary s={s} value={s.kind === "activation" && !s.active ? null : s.value} /></div>
                  {s.kind === "activation" && !s.active && s.suggestion && (
                    <div style={{ color: v.textSecondary, fontSize: fs.sm, marginBottom: space[2] }}>Suggested when turned on: <Summary s={s} value={{ ...s.suggestion, active: true }} /></div>
                  )}
                  {s.confirmed && <p style={{ color: v.textSecondary, fontSize: fs.sm }}>Proposed by {s.confirmed.proposedBy}, confirmed by {s.confirmed.confirmedBy}. Reason: {s.confirmed.reason}</p>}
                  {s.pending.slice(0, 1).map((p) => (
                    <div key={p.id} style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center", marginBottom: space[2] }}>
                      <StatusChip tone="warning">Waiting for a different director</StatusChip>
                      <span>Proposed by {p.proposedBy}: {p.reason}</span>
                      <Summary s={s} value={p.value} />
                      {!p.mine && <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(p.id)}>Confirm</Button>}
                    </div>
                  ))}
                  <Button onClick={() => open(s)}>{s.kind === "activation" && !s.active ? "Propose turning it on" : "Propose a change"}</Button>
                </Panel>
              ))}
            </section>
          ))}
        </div>
      </QueryState>
      <SideDrawer open={!!editing} title={editing?.title ?? ""} subtitle="Takes effect only when a different director confirms it. Every change is audited." onClose={() => setEditing(null)} formId="policy-form" primaryLabel="Propose" primaryLoading={propose.isPending}>
        <Form id="policy-form" form={form} layout="vertical" requiredMark={false} onFinish={(vals) => propose.mutate(vals)}>
          {editing?.kind === "activation" && (
            <Form.Item name="active" label="On" rules={[{ required: true }]}>
              <Select options={[{ value: false, label: "Off (no effect)" }, { value: true, label: "On" }]} />
            </Form.Item>
          )}
          {editing?.fields.map((f) => <FieldInput key={f.name} f={f} />)}
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "A reason of a few words" }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
