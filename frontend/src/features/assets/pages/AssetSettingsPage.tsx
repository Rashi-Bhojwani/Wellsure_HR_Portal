import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Space } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { ASSET_CODE_PATTERN, MAX_ASSET_SETTING_ITEMS, type AssetSettingItem, type AssetSettingKind } from "@shared/constants/assets";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, StatusChip, toast } from "../../../ui";
import * as assetsApi from "../api";
import type { SettingKind, SettingVersion } from "../api";

const FORM_ID = "asset-setting-form";

function ItemsTable({ kind, items }: { kind: AssetSettingKind; items: AssetSettingItem[] }) {
  return (
    <DataTable<AssetSettingItem>
      rowKey="code"
      dataSource={items}
      pagination={false}
      density="compact"
      columns={[
        { title: "Label", dataIndex: "label" },
        { title: "Code", dataIndex: "code", render: (c: string) => <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{c}</span> },
        ...(kind === "STATUSES" ? [{ title: "Can be issued", key: "issuable", render: (_: unknown, i: AssetSettingItem) => (i.issuable ? "Yes" : "No") }] : []),
      ]}
      mobile={{ title: (i) => i.label, subtitle: (i) => (kind === "STATUSES" ? `${i.code} · ${i.issuable ? "can be issued" : "cannot be issued"}` : i.code) }}
    />
  );
}

const versionLine = (ver: SettingVersion) =>
  `Version ${ver.version} · entered by ${ver.enteredByName ?? "someone"} on ${formatDateTime(ver.enteredAt)}${ver.confirmedAt ? ` · confirmed by ${ver.confirmedByName ?? "a director"} on ${formatDateTime(ver.confirmedAt)}` : ""}`;

// Assets → Asset Settings (Peeps module 1). Categories, statuses and conditions are Not set until chosen: HR Admin (or a director) enters a list, and a
// director who did not enter it confirms it. Only a confirmed list is used; the register refuses to add or issue anything until all three are.
export function AssetSettingsPage() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const isDirector = hasRole("SUPER_ADMIN");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["assets", "settings"], queryFn: assetsApi.getSettings });
  const [editing, setEditing] = useState<SettingKind | null>(null);
  const [confirming, setConfirming] = useState<SettingKind | null>(null);
  const [form] = Form.useForm<{ items: AssetSettingItem[]; note?: string }>();

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["assets"] });
  const propose = useMutation({
    mutationFn: ({ kind, items, note }: { kind: AssetSettingKind; items: AssetSettingItem[]; note?: string }) => assetsApi.proposeSetting(kind, { items, ...(note ? { note } : {}) }),
    onSuccess: () => {
      refresh();
      setEditing(null);
      toast.success("Saved. A director who did not enter it must confirm it before it is used.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't save the list.")),
  });
  const confirm = useMutation({
    mutationFn: (k: SettingKind) => assetsApi.confirmSetting(k.kind, { version: k.pending!.version }),
    onSuccess: () => {
      refresh();
      setConfirming(null);
      toast.success("Confirmed. The register now uses this list.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't confirm the list.")),
  });

  const startEdit = (k: SettingKind) => {
    const base = k.pending?.items ?? k.inForce?.items ?? [];
    form.setFieldsValue({ items: base.length ? base.map((i) => ({ ...i })) : [{ code: "", label: "", issuable: k.kind === "STATUSES" ? true : undefined }], note: "" });
    setEditing(k);
  };

  return (
    <>
      <PageHeader title="Asset Settings" subtitle="The categories, statuses and conditions the register uses" />
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={6} />}>
        {data && (
          <Stack>
            <ApprovalBanner
              tone={data.ready ? "success" : "warning"}
              title={data.ready ? "The register is set up" : "Not set up yet"}
              description={
                data.ready
                  ? "All three lists are confirmed. A change is a new version: it is used only after a director who did not enter it confirms it."
                  : "Nothing is preloaded. Enter each list below; a director who did not enter it confirms it. No asset can be added or issued until all three are confirmed."
              }
            />
            {data.kinds.map((k) => (
              <Panel
                key={k.kind}
                title={k.label}
                subtitle={k.what}
                extra={
                  <Button icon={<EditOutlined />} onClick={() => startEdit(k)} aria-label={`Change ${k.label.toLowerCase()}`}>
                    {k.inForce || k.pending ? "Change" : "Enter"}
                  </Button>
                }
              >
                <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
                  {k.inForce ? (
                    <div>
                      <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap", marginBottom: space[2] }}>
                        <StatusChip tone="success">Confirmed</StatusChip>
                        <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{versionLine(k.inForce)}</span>
                      </div>
                      <ItemsTable kind={k.kind} items={k.inForce.items} />
                    </div>
                  ) : (
                    <EmptyState title="Not set" description="No confirmed list yet." illustration={false} compact />
                  )}
                  {k.pending && (
                    <div>
                      <div style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap", marginBottom: space[2] }}>
                        <StatusChip tone="warning">Waiting for a director</StatusChip>
                        <span style={{ color: v.textSecondary, fontSize: fs.sm }}>{versionLine(k.pending)}</span>
                      </div>
                      {k.pending.note && <div style={{ color: v.textBody, fontSize: fs.sm, marginBottom: space[2] }}>{k.pending.note}</div>}
                      <ItemsTable kind={k.kind} items={k.pending.items} />
                      <div style={{ marginTop: space[3] }}>
                        {isDirector && !k.pending.enteredByMe ? (
                          <Button type="primary" onClick={() => setConfirming(k)}>
                            Confirm version {k.pending.version}
                          </Button>
                        ) : (
                          <span style={{ color: v.textSecondary, fontSize: fs.sm }}>
                            {k.pending.enteredByMe ? "You entered this version, so another director must confirm it." : "A director confirms this version."}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            ))}
          </Stack>
        )}
      </QueryState>

      <SideDrawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing ? `${editing.inForce || editing.pending ? "Change" : "Enter"} ${editing.label.toLowerCase()}` : ""}
        subtitle="Saved as a new version. It is used only after a director who did not enter it confirms it."
        formId={FORM_ID}
        primaryLabel="Save for confirmation"
        primaryLoading={propose.isPending}
        size="wide"
      >
        {editing && (
          <Form id={FORM_ID} form={form} layout="vertical" requiredMark onFinish={(values) => propose.mutate({ kind: editing.kind, items: values.items, note: values.note })}>
            <Form.List name="items">
              {(fields, { add, remove }) => (
                <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>
                  {fields.map((field, i) => (
                    <Space key={field.key} align="start" wrap style={{ width: "100%" }}>
                      <Form.Item name={[field.name, "label"]} label={i === 0 ? "Label" : undefined} rules={[{ required: true, max: 80, message: "A label (up to 80 characters)." }]}>
                        <Input aria-label={`Label ${i + 1}`} placeholder="As people should see it" />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, "code"]}
                        label={i === 0 ? "Code" : undefined}
                        rules={[{ required: true, pattern: ASSET_CODE_PATTERN, message: "Capital letters, digits and underscores." }]}
                        extra={i === 0 ? "Stays the same when the label changes. A code in use cannot be removed." : undefined}
                      >
                        <Input aria-label={`Code ${i + 1}`} />
                      </Form.Item>
                      {editing.kind === "STATUSES" && (
                        <Form.Item name={[field.name, "issuable"]} label={i === 0 ? "Can be issued" : undefined} valuePropName="checked">
                          <Checkbox aria-label={`Can be issued ${i + 1}`}>Can be issued</Checkbox>
                        </Form.Item>
                      )}
                      <Form.Item label={i === 0 ? " " : undefined}>
                        <Button icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label={`Remove row ${i + 1}`} disabled={fields.length === 1} />
                      </Form.Item>
                    </Space>
                  ))}
                  <Button icon={<PlusOutlined />} onClick={() => add({ code: "", label: "", issuable: editing.kind === "STATUSES" ? false : undefined })} disabled={fields.length >= MAX_ASSET_SETTING_ITEMS}>
                    Add a row
                  </Button>
                </div>
              )}
            </Form.List>
            <Form.Item name="note" label="Note for the confirming director" rules={[{ max: 1000 }]} style={{ marginTop: space[4] }}>
              <Input.TextArea rows={2} />
            </Form.Item>
          </Form>
        )}
      </SideDrawer>

      <ConfirmModal
        open={confirming !== null}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && confirm.mutate(confirming)}
        loading={confirm.isPending}
        title={confirming ? `Confirm ${confirming.label.toLowerCase()}, version ${confirming.pending?.version}?` : ""}
        description="From now on the register uses this list. You are confirming a list somebody else entered."
        confirmLabel="Confirm"
      />
    </>
  );
}
