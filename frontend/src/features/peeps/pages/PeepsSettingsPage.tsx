import { useState } from "react";
import { OfficeGate } from "../OfficeGate";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Space } from "antd";
import { EditOutlined } from "@ant-design/icons";
import type { PeepsSettingKey } from "@shared/constants/peeps";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, StatusChip, toast } from "../../../ui";
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
  { id: "nudges", title: "Nudges" },
  { id: "directory", title: "Directory" },
  { id: "leave", title: "Leave" },
];

// Wellsure Office → Settings (D-29, Peeps Stage 3). Lists and workflow settings ship with a conventional default ("Default, change in settings"); the
// rest start Not set, and a module whose required settings are missing refuses to activate. A director (or, for working values, a member allowed to
// prepare settings) enters a value; a director who did not enter it confirms it before it is used. A pending value can be withdrawn by the person who
// entered it or by a director, before it is confirmed.
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
  const [withdrawing, setWithdrawing] = useState<SettingView | null>(null);
  const [reason, setReason] = useState("");
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

  const withdraw = useMutation({
    mutationFn: (s: SettingView) => peepsApi.withdrawSetting(s.key, s.pending!.version, reason.trim()),
    onSuccess: () => {
      setWithdrawing(null);
      setReason("");
      refresh();
      toast.success("Withdrawn. The value in use is unchanged.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't withdraw it.")),
  });

  const isDirector = me.data?.isDirector ?? false;
  const mayEnter = (s: SettingView) => isDirector || (s.enteredBy === "OFFICE" && (me.data?.capabilities ?? []).includes("PREPARE_SETTINGS"));
  const open = (s: SettingView) => {
    form.resetFields();
    form.setFieldsValue({ value: (s.pending?.value ?? s.inForce?.value ?? s.defaultValue ?? undefined) as never, note: "" });
    setEditing(s);
  };
  const current = (s: SettingView) =>
    s.inForce ? (
      <span style={{ color: v.textBody }}>{describeValue(s.key, s.inForce.value)}</span>
    ) : s.state === "DEFAULT" ? (
      <div>
        <StatusChip tone="info">Default, change in settings</StatusChip>
        <div style={{ color: v.textBody, marginTop: space[1] }}>{describeValue(s.key, s.defaultValue)}</div>
      </div>
    ) : (
      <StatusChip tone="warning">Not set</StatusChip>
    );
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
      {s.pending && (isDirector || s.pending.enteredByMe) && (
        <Button onClick={() => setWithdrawing(s)} aria-label={`Withdraw the pending ${s.label}`}>
          Withdraw
        </Button>
      )}
      {mayEnter(s) && (
        <Button icon={<EditOutlined />} onClick={() => open(s)} aria-label={`Change ${s.label}`}>
          {s.inForce || s.pending || s.state === "DEFAULT" ? "Change" : "Enter"}
        </Button>
      )}
    </Space>
  );

  return (
    <>
      <PageHeader title="Peeps settings" subtitle="Lists start from a default you can change; values about pay, retention and the like stay Not set. Each change is used only after a director who did not enter it confirms it." />
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={8} />}>
        <Stack>
          <ApprovalBanner tone="info" title="Who enters what" description="The directors enter audiences, the workspace name and the badge and nudge settings. Working values (Unmute times) may also be prepared by a member the directors allow. Every value is confirmed by a director who did not enter it, and every change is in the audit log." />
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
                mobile={{ title: (s) => s.label, subtitle: (s) => (s.inForce ? describeValue(s.key, s.inForce.value) : s.state === "DEFAULT" ? `Default, change in settings: ${describeValue(s.key, s.defaultValue)}` : "Not set"), fields: [{ label: "Waiting", render: (s) => pending(s) }], actions }}
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
      <ConfirmModal
        open={withdrawing !== null}
        onCancel={() => setWithdrawing(null)}
        onConfirm={() => withdrawing && withdraw.mutate(withdrawing)}
        title="Withdraw the value waiting for confirmation?"
        info="The value in use does not change. Your reason is kept in the audit log."
        confirmLabel="Withdraw"
        loading={withdraw.isPending}
        confirmDisabled={reason.trim().length < 3}
      >
        <label htmlFor="setting-withdraw-reason" style={{ display: "block", marginBottom: space[2], color: v.textBody }}>
          Why?
        </label>
        <Input.TextArea id="setting-withdraw-reason" rows={2} maxLength={500} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
