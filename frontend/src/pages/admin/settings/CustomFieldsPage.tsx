import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select, Switch } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/customFields";
import { apiErrorMessage } from "../../../lib/apiError";
import { space } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, SideDrawer, StatusChip, toast } from "../../../ui";

// M session block 2, ER-28: directors define custom fields on the employee record (none by default). A sensitive field's value is stored
// encrypted and shown masked; only a director reveals it. A field's type and sensitivity are fixed once created; it can be switched off.
type FormVals = { key: string; label: string; type: api.FieldType; options?: string[]; visibleToEmployee: boolean; sensitive: boolean; active?: boolean };

export function CustomFieldsPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<api.FieldDef | "new" | null>(null);
  const [form] = Form.useForm<FormVals>();
  const type = Form.useWatch("type", form);
  const q = useQuery({ queryKey: ["custom-fields", "definitions", "all"], queryFn: () => api.listDefinitions(true) });
  const save = useMutation({
    mutationFn: (v: FormVals) =>
      editing === "new"
        ? api.createDefinition({ key: v.key, label: v.label, type: v.type, options: v.type === "CHOICE" ? v.options ?? [] : [], visibleToEmployee: v.visibleToEmployee, sensitive: v.sensitive })
        : api.updateDefinition((editing as api.FieldDef).id, { label: v.label, ...((editing as api.FieldDef).type === "CHOICE" ? { options: v.options ?? [] } : {}), visibleToEmployee: v.visibleToEmployee, active: v.active }),
    onSuccess: () => { toast.success("Saved."); setEditing(null); void queryClient.invalidateQueries({ queryKey: ["custom-fields"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save the field.")),
  });
  const open = (d: api.FieldDef | "new") => {
    form.resetFields();
    form.setFieldsValue(d === "new" ? { type: "TEXT", visibleToEmployee: false, sensitive: false } : { key: d.key, label: d.label, type: d.type, options: d.options, visibleToEmployee: d.visibleToEmployee, sensitive: d.sensitive, active: d.active });
    setEditing(d);
  };
  const isNew = editing === "new";
  const chips = (d: api.FieldDef) => (
    <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap" }}>
      {d.sensitive && <StatusChip tone="warning">Sensitive</StatusChip>}
      {d.visibleToEmployee && <StatusChip tone="info">Employee sees it</StatusChip>}
      {!d.active && <StatusChip tone="neutral">Off</StatusChip>}
    </span>
  );
  return (
    <>
      <PageHeader title="Custom fields" subtitle="Extra details kept on each employee record. HR fills them; a sensitive one is encrypted and shown masked." actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => open("new")}>Add field</Button>} />
      <Panel>
        <DataTable<api.FieldDef>
          rowKey="id"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data ?? []}
          pagination={false}
          empty={<EmptyState compact title="No custom fields" description="Add one if the company keeps a detail the standard record has no place for." />}
          columns={[
            { title: "Label", dataIndex: "label" },
            { title: "Type", key: "t", render: (_, d) => `${api.TYPE_LABEL[d.type]}${d.type === "CHOICE" ? `: ${d.options.join(", ")}` : ""}` },
            { title: "", key: "c", render: (_, d) => chips(d) },
            { title: "", key: "a", align: "right", render: (_, d) => <Button icon={<EditOutlined />} onClick={() => open(d)} aria-label={`Edit ${d.label}`}>Edit</Button> },
          ]}
          mobile={{ title: (d) => d.label, subtitle: (d) => api.TYPE_LABEL[d.type], status: chips, actions: (d) => <Button block icon={<EditOutlined />} onClick={() => open(d)}>Edit</Button> }}
        />
      </Panel>
      <SideDrawer open={!!editing} title={isNew ? "Add field" : "Edit field"} subtitle="Every change is audited." onClose={() => setEditing(null)} formId="custom-field-form" primaryLabel="Save" primaryLoading={save.isPending}>
        <Form id="custom-field-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => save.mutate(v)}>
          <Form.Item name="label" label="Label" rules={[{ required: true, min: 2 }]}><Input maxLength={60} /></Form.Item>
          <Form.Item name="key" label="Key (fixed once created)" rules={[{ required: true, pattern: /^[a-z][a-z0-9_]{1,39}$/, message: "lower-case letters, digits and _" }]}><Input disabled={!isNew} /></Form.Item>
          <Form.Item name="type" label="Type (fixed once created)" rules={[{ required: true }]}><Select disabled={!isNew} options={Object.entries(api.TYPE_LABEL).map(([value, label]) => ({ value, label }))} /></Form.Item>
          {(isNew ? type : (editing as api.FieldDef | null)?.type) === "CHOICE" && (
            <Form.Item name="options" label="Options" rules={[{ required: true, message: "At least one option" }]}><Select mode="tags" aria-label="Options" /></Form.Item>
          )}
          <Form.Item name="visibleToEmployee" label="The employee sees their own value" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="sensitive" label="Sensitive (encrypted, masked, revealed only by a director; fixed once created)" valuePropName="checked"><Switch disabled={!isNew} /></Form.Item>
          {!isNew && <Form.Item name="active" label="In use" valuePropName="checked"><Switch /></Form.Item>}
        </Form>
      </SideDrawer>
    </>
  );
}
