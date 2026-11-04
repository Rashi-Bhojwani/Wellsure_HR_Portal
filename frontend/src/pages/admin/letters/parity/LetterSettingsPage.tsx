import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select, Space } from "antd";
import { DeleteOutlined, DownloadOutlined } from "@ant-design/icons";
import * as accessApi from "../../../../api/access";
import * as lettersApi from "../../../../api/letters";
import * as parityApi from "../../../../api/parity";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { CardGrid, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, QueryState, SkeletonCard, StatusChip, toast } from "../../../../ui";
import { fs, fw, radius, space, v } from "../../../../theme/tokens";

// A-9 G3 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, items 11 and 12) — the directors' letter settings: the starter gallery (original placeholder wording,
// loaded one at a time and switched off until a director rewrites and enables it), who besides the directors may prepare or issue each letter, and the serial.

function Starters() {
  const queryClient = useQueryClient();
  const starters = useQuery({ queryKey: ["letters", "starters"], queryFn: parityApi.listStarters });
  const [loading, setLoading] = useState<parityApi.LetterStarterView | null>(null);
  const load = useMutation({
    mutationFn: (code: string) => parityApi.loadStarter(code),
    onSuccess: () => {
      toast.success("Loaded, switched off. Rewrite it in Email & Letter Templates, then switch it on.");
      setLoading(null);
      void queryClient.invalidateQueries({ queryKey: ["letters"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not load it.")),
  });
  return (
    <Panel title="Starter letters" subtitle="Placeholder wording to start from. Nothing is loaded until you choose it.">
      <QueryState isLoading={starters.isLoading} error={starters.error} onRetry={() => void starters.refetch()} skeleton={<SkeletonCard lines={4} />}>
        <CardGrid min={260} gap={space[4]}>
          {(starters.data ?? []).map((s) => (
            <div key={s.code} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4], display: "flex", flexDirection: "column", gap: space[2] }}>
              <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{s.name}</div>
              <div style={{ fontSize: fs.sm, color: v.textSecondary, flex: 1 }}>{s.description}</div>
              <Space wrap>
                {s.directorOnly ? <StatusChip tone="purple">Directors only</StatusChip> : <StatusChip tone="neutral">No pay figures</StatusChip>}
                {s.loaded && <StatusChip tone="success">Loaded</StatusChip>}
              </Space>
              <Button icon={<DownloadOutlined />} disabled={s.loaded} onClick={() => setLoading(s)} aria-label={`Load ${s.name}`}>
                {s.loaded ? "Already loaded" : "Load"}
              </Button>
            </div>
          ))}
        </CardGrid>
      </QueryState>
      <ConfirmModal
        open={!!loading}
        title={`Load "${loading?.name ?? ""}"?`}
        description="It becomes a template, switched off. Its wording is a placeholder: rewrite it before switching it on. This is recorded in the audit log."
        confirmLabel="Load"
        loading={load.isPending}
        onCancel={() => setLoading(null)}
        onConfirm={() => loading && load.mutate(loading.code)}
      />
    </Panel>
  );
}

function Grants() {
  const queryClient = useQueryClient();
  const grants = useQuery({ queryKey: ["letters", "grants"], queryFn: parityApi.listLetterGrants });
  const templates = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates });
  const roles = useQuery({ queryKey: ["access", "roles"], queryFn: accessApi.listRoles });
  const [form] = Form.useForm<{ templateId: string; action: "PREPARE" | "ISSUE"; roleCode: string }>();
  const add = useMutation({
    mutationFn: parityApi.createLetterGrant,
    onSuccess: (r) => {
      toast.success(r.created ? "Allowed." : "That was already allowed.");
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey: ["letters", "grants"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not allow it.")),
  });
  const revoke = useMutation({
    mutationFn: parityApi.revokeLetterGrant,
    onSuccess: () => {
      toast.success("Withdrawn. It takes effect on their next action.");
      void queryClient.invalidateQueries({ queryKey: ["letters", "grants"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not withdraw it.")),
  });
  const payFree = (templates.data ?? []).filter((t) => (t as lettersApi.LetterTemplateSummary & { payFree?: { ok: boolean } }).payFree?.ok);
  return (
    <Panel title="Who may prepare or issue letters" subtitle="Directors always may. A letter that can carry pay stays with the directors and cannot be granted.">
      <Form form={form} layout="inline" onFinish={(values) => add.mutate(values)} style={{ rowGap: space[3], marginBottom: space[4] }}>
        <Form.Item name="templateId" rules={[{ required: true, message: "Choose a letter" }]}>
          <Select aria-label="Letter" placeholder="Letter" style={{ minWidth: 220 }} options={payFree.map((t) => ({ value: t.id, label: t.name }))} />
        </Form.Item>
        <Form.Item name="action" rules={[{ required: true, message: "Choose what" }]}>
          <Select aria-label="What" placeholder="What" style={{ minWidth: 140 }} options={[{ value: "PREPARE", label: "Prepare" }, { value: "ISSUE", label: "Issue" }]} />
        </Form.Item>
        <Form.Item name="roleCode" rules={[{ required: true, message: "Choose a role" }]}>
          <Select aria-label="Role" placeholder="Role" style={{ minWidth: 180 }} options={(roles.data ?? []).filter((r) => r.code !== "SUPER_ADMIN").map((r) => ({ value: r.code, label: r.name }))} />
        </Form.Item>
        <Button htmlType="submit" type="primary" loading={add.isPending}>
          Allow
        </Button>
      </Form>
      <DataTable<parityApi.LetterGrant>
        rowKey="id"
        loading={grants.isLoading}
        error={grants.error}
        onRetry={() => void grants.refetch()}
        dataSource={grants.data ?? []}
        empty={<EmptyState compact title="Only the directors prepare and issue letters." description={null} />}
        pagination={false}
        columns={[
          { title: "Letter", key: "t", render: (_: unknown, g) => g.template.name },
          { title: "May", key: "a", render: (_: unknown, g) => (g.action === "PREPARE" ? "Prepare" : "Issue") },
          { title: "Who", key: "w", render: (_: unknown, g) => g.roleCode ?? "One person" },
          { title: "", key: "x", render: (_: unknown, g) => <Button danger icon={<DeleteOutlined />} aria-label="Withdraw" onClick={() => revoke.mutate(g.id)} /> },
        ]}
        mobile={{ title: (g) => g.template.name, subtitle: (g) => `${g.action === "PREPARE" ? "Prepare" : "Issue"} · ${g.roleCode ?? "One person"}`, actions: (g) => <Button danger onClick={() => revoke.mutate(g.id)}>Withdraw</Button> }}
      />
    </Panel>
  );
}

function Serial() {
  const queryClient = useQueryClient();
  const serial = useQuery({ queryKey: ["letters", "serial"], queryFn: parityApi.getLetterSerial });
  const save = useMutation({
    mutationFn: parityApi.setLetterSerial,
    onSuccess: () => {
      toast.success("Serial saved.");
      void queryClient.invalidateQueries({ queryKey: ["letters", "serial"] });
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save it.")),
  });
  return (
    <Panel title="Letter serial" subtitle="Each issued letter takes the next number. Until you set it, letters carry only their LTR reference.">
      <QueryState isLoading={serial.isLoading} error={serial.error} onRetry={() => void serial.refetch()} skeleton={<SkeletonCard lines={2} />}>
        <p style={{ marginTop: 0, color: v.textSecondary }}>{serial.data ? `Next: ${serial.data.prefix}${serial.data.nextNumber}` : "Not set"}</p>
        <Form layout="inline" key={serial.dataUpdatedAt} initialValues={serial.data ?? { prefix: "", nextNumber: undefined }} onFinish={(values: { prefix: string; nextNumber: number }) => save.mutate({ prefix: values.prefix ?? "", nextNumber: values.nextNumber })} style={{ rowGap: space[3] }}>
          <Form.Item name="prefix" label="Prefix">
            <Input maxLength={20} style={{ width: 140 }} />
          </Form.Item>
          <Form.Item name="nextNumber" label="Next number" rules={[{ required: true, message: "Enter a number" }]}>
            <InputNumber min={1} precision={0} style={{ width: 140 }} />
          </Form.Item>
          <Button htmlType="submit" type="primary" loading={save.isPending}>
            Save
          </Button>
        </Form>
      </QueryState>
    </Panel>
  );
}

export function LetterSettingsPage() {
  return (
    <>
      <PageHeader title="Letter Settings" subtitle="Starter letters, who may prepare or issue them, and the serial" />
      <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
        <Starters />
        <Grants />
        <Serial />
      </div>
    </>
  );
}
