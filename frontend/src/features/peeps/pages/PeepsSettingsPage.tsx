import { useState } from "react";
import { OfficeGate } from "../OfficeGate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Space } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { PeepsSettingKey } from "@shared/constants/peeps";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, StatusChip, toast } from "../../../ui";
import * as peepsApi from "../api";
import type { SettingView } from "../api";
import { SettingFields } from "../settingEditors";
import { describeValue } from "../settingValues";
import { usePeepsMe } from "../usePeepsMe";

const FORM_ID = "peeps-setting-form";
const MODULES: Array<{ id: string; title: string }> = [
  { id: "office", title: "Workspace" },
  { id: "assets", title: "Assets" },
  { id: "unmute", title: "Unmute" },
  { id: "badges", title: "Badges" },
  { id: "nudges", title: "Private nudges" },
  { id: "directory", title: "Directory" },
];

// Wellsure Office → Settings (D-29). Every Peeps setting starts Not set; a module whose required settings are missing refuses to activate. A director (or,
// for working values, a member allowed to prepare settings) enters a value; a director who did not enter it confirms it before it is used.
export function PeepsSettingsPage() {
  return (
    <OfficeGate title="Peeps settings" need="member">
      <PeepsSettingsPageInner />
    </OfficeGate>
  );
}

function PeepsSettingsPageInner() {
  const queryClient = useQueryClient();
  const me = usePeepsMe();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["peeps", "settings"], queryFn: peepsApi.listSettings });
  const [editing, setEditing] = useState<SettingView | null>(null);
  const [form] = Form.useForm<{ value: unknown; note?: string }>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["peeps"] });
  const enter = useMutation({
    mutationFn: ({ key, value, note }: { key: PeepsSettingKey; value: unknown; note?: string }) => peepsApi.enterSetting(key, value, note),
    onSuccess: () => {
      setEditing(null);
      refresh();
      toast.success("Saved. A director who did not enter it confirms it before it is used.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save the setting.")),
  });
  const confirm = useMutation({
    mutationFn: (s: SettingView) => peepsApi.confirmSetting(s.key, s.pending!.version),
    onSuccess: () => {
      refresh();
      toast.success("Confirmed and in use.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't confirm the setting.")),
  });

  const isDirector = me.data?.isDirector ?? false;
  const mayEnter = (s: SettingView) => isDirector || (s.enteredBy === "OFFICE" && (me.data?.capabilities ?? []).includes("PREPARE_SETTINGS"));
  const open = (s: SettingView) => {
    form.resetFields();
    form.setFieldsValue({ value: (s.pending?.value ?? s.inForce?.value) as never, note: "" });
    setEditing(s);
  };
  const current = (s: SettingView) => (s.inForce ? <span style={{ color: v.textBody }}>{describeValue(s.key, s.inForce.value)}</span> : <StatusChip tone="warning">Not set</StatusChip>);
  const pending = (s: SettingView) =>
    s.pending ? (
      <div>
        <div style={{ color: v.textBody }}>{describeValue(s.key, s.pending.value)}</div>
        <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
          Entered by {s.pending.enteredByName ?? "someone"} · {formatDateTime(s.pending.enteredAt)}
        </div>
      </div>
    ) : (
      "—"
    );
  const actions = (s: SettingView) => (
    <Space wrap size={space[2]}>
      {s.pending && isDirector && !s.pending.enteredByMe && (
        <Button type="primary" loading={confirm.isPending && confirm.variables?.key === s.key} onClick={() => confirm.mutate(s)}>
          Confirm
        </Button>
      )}
      {mayEnter(s) && (
        <Button icon={<EditOutlined />} onClick={() => open(s)} aria-label={`Change ${s.label}`}>
          {s.inForce || s.pending ? "Change" : "Enter"}
        </Button>
      )}
    </Space>
  );

  return (
    <>
      <PageHeader title="Peeps settings" subtitle="Nothing is preset. Each value is used only after a director who did not enter it confirms it." />
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={8} />}>
        <Stack>
          <ApprovalBanner tone="info" title="Who enters what" description="The directors enter audiences, the workspace name and revocation rules. Working values (Unmute times, the badge catalogue and limits) may also be prepared by a member the directors allow. Every value is confirmed by a director who did not enter it." />
          {MODULES.map((m) => (
            <Panel key={m.id} title={m.title}>
              <DataTable<SettingView>
                rowKey="key"
                dataSource={(data ?? []).filter((s) => s.module === m.id)}
                pagination={false}
                columns={[
                  { title: "Setting", key: "label", render: (_: unknown, s) => <div><div style={{ color: v.textPrimary }}>{s.label}</div><div style={{ color: v.textSecondary, fontSize: fs.sm }}>{s.what}</div></div> },
                  { title: "In use", key: "current", render: (_: unknown, s) => current(s) },
                  { title: "Waiting for confirmation", key: "pending", render: (_: unknown, s) => pending(s) },
                  { title: "", key: "act", align: "right", render: (_: unknown, s) => actions(s) },
                ]}
                mobile={{ title: (s) => s.label, subtitle: (s) => (s.inForce ? describeValue(s.key, s.inForce.value) : "Not set"), fields: [{ label: "Waiting", render: (s) => pending(s) }], actions }}
              />
            </Panel>
          ))}
        </Stack>
      </QueryState>
      <SideDrawer open={editing !== null} onClose={() => setEditing(null)} title={editing ? editing.label : ""} subtitle={editing?.what} formId={FORM_ID} primaryLabel="Save for confirmation" primaryLoading={enter.isPending} size="wide">
        {editing && (
          <Form id={FORM_ID} form={form} layout="vertical" requiredMark onFinish={(values) => enter.mutate({ key: editing.key, value: values.value, note: values.note })}>
            <SettingFields settingKey={editing.key} />
            <Form.Item name="note" label="Note for the confirming director" rules={[{ max: 500 }]}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        )}
      </SideDrawer>
    </>
  );
}
