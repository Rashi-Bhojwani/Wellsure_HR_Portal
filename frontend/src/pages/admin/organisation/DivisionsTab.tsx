import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/divisions";
import * as orgApi from "../../../api/org";
import { apiErrorMessage } from "../../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, Panel, SideDrawer, toast, useIsPhone } from "../../../ui";
import { space } from "../../../theme/tokens";

// M session block 2, ER-27: divisions are an optional grouping of departments. Nothing changes for anyone until a division is created.
export function DivisionsTab({ canManage }: { canManage: boolean }) {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<api.Division | "new" | null>(null);
  const [removing, setRemoving] = useState<api.Division | null>(null);
  const [form] = Form.useForm<{ code: string; name: string; departmentIds: string[] }>();
  const q = useQuery({ queryKey: ["divisions"], queryFn: api.listDivisions });
  const departments = useQuery({ queryKey: ["departments"], queryFn: orgApi.departments.list, enabled: canManage });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["divisions"] });
  const save = useMutation({
    mutationFn: async (vals: { code: string; name: string; departmentIds: string[] }) => {
      const id = editing === "new" ? (await api.createDivision({ code: vals.code, name: vals.name })).id : (await api.updateDivision(editing!.id, { code: vals.code, name: vals.name }), editing!.id);
      await api.setDivisionDepartments(id, vals.departmentIds ?? []);
    },
    onSuccess: () => { toast.success("Saved."); setEditing(null); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not save the division.")),
  });
  const remove = useMutation({ mutationFn: (id: string) => api.deleteDivision(id), onSuccess: () => { toast.success("Deleted."); setRemoving(null); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not delete it.")) });
  const open = (d: api.Division | "new") => {
    form.resetFields();
    if (d !== "new") form.setFieldsValue({ code: d.code, name: d.name, departmentIds: d.departments.map((x) => x.id) });
    setEditing(d);
  };
  const actions = (d: api.Division) => canManage && (
    <div style={{ display: "flex", gap: space[2], justifyContent: phone ? "stretch" : "flex-end", flexWrap: "wrap" }}>
      <Button icon={<EditOutlined />} onClick={() => open(d)} block={phone} aria-label={`Edit ${d.name}`}>Edit</Button>
      <Button danger icon={<DeleteOutlined />} disabled={d.departments.length > 0} onClick={() => setRemoving(d)} block={phone} aria-label={`Delete ${d.name}`}>Delete</Button>
    </div>
  );

  return (
    <Panel title="Divisions" subtitle="An optional grouping of departments. An employee's division is their department's, so it follows their job history." extra={canManage ? <Button type="primary" icon={<PlusOutlined />} onClick={() => open("new")}>Add division</Button> : undefined}>
      <DataTable<api.Division>
        rowKey="id"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        pagination={false}
        empty={<EmptyState compact title="No divisions" description="Divisions are optional. Add one only if the company groups departments this way." />}
        columns={[
          { title: "Code", dataIndex: "code", width: 120 },
          { title: "Name", dataIndex: "name" },
          { title: "Departments", key: "deps", render: (_, d) => (d.departments.length ? d.departments.map((x) => x.name).join(", ") : "—") },
          { title: "", key: "a", align: "right", render: (_, d) => actions(d) },
        ]}
        mobile={{ title: (d) => d.name, subtitle: (d) => d.code, fields: [{ label: "Departments", render: (d) => (d.departments.length ? d.departments.map((x) => x.name).join(", ") : "—") }], actions: (d) => actions(d) || null }}
      />
      <SideDrawer open={!!editing} title={editing === "new" ? "Add division" : "Edit division"} subtitle="A department moved here leaves its previous division. Every change is audited." onClose={() => setEditing(null)} formId="division-form" primaryLabel="Save" primaryLoading={save.isPending}>
        <Form id="division-form" form={form} layout="vertical" requiredMark={false} onFinish={(vals) => save.mutate(vals)}>
          <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,20}$/, message: "Letters, digits, - or _ (up to 20)" }]}><Input /></Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true, min: 2 }]}><Input /></Form.Item>
          <Form.Item name="departmentIds" label="Departments"><Select mode="multiple" aria-label="Departments" options={(departments.data ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.code})` }))} optionFilterProp="label" /></Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!removing} danger title="Delete this division?" description={removing?.name} confirmLabel="Delete" loading={remove.isPending} onCancel={() => setRemoving(null)} onConfirm={() => removing && remove.mutate(removing.id)} />
    </Panel>
  );
}
