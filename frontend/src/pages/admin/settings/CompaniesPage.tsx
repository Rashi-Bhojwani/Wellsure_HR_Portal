import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select } from "antd";
import { PlusOutlined, SwapOutlined } from "@ant-design/icons";
import * as api from "../../../api/legalEntities";
import { apiErrorMessage } from "../../../lib/apiError";
import { DataTable, EmptyState, PageHeader, Panel, QueryState, SideDrawer, Stack, toast } from "../../../ui";

// M session block 2, AD-08: one company is the usual case; directors may add further legal entities and move employees to one. Payroll per company
// (registrations, statutory files, bank file) is not built yet.
export function CompaniesPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState(false);
  const [addForm] = Form.useForm<{ code: string; name: string; registeredAddress?: string }>();
  const [moveForm] = Form.useForm<{ codes: string; legalEntityId: string }>();
  const q = useQuery({ queryKey: ["legal-entities"], queryFn: api.listEntities });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["legal-entities"] });
  const add = useMutation({ mutationFn: api.createEntity, onSuccess: () => { toast.success("Added."); setAdding(false); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not add it.")) });
  const move = useMutation({
    mutationFn: (v: { codes: string; legalEntityId: string }) => api.assignEntity(v.codes.split(/[\s,]+/).map((c) => c.trim()).filter(Boolean), v.legalEntityId === "MAIN" ? null : v.legalEntityId),
    onSuccess: (r) => { toast.success(`${r.moved} employee(s) moved.`); setMoving(false); refresh(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not move them.")),
  });
  const rows = q.data ? [{ id: "MAIN", code: "—", name: `${q.data.main.name} (main company)`, registeredAddress: null, employees: q.data.main.activeEmployees }, ...q.data.entities] : [];
  return (
    <>
      <PageHeader title="Companies" subtitle="Every employee belongs to the main company unless moved to another legal entity. Payroll per company is not built yet." actions={<><Button icon={<SwapOutlined />} onClick={() => { moveForm.resetFields(); setMoving(true); }} disabled={!q.data?.entities.length}>Move employees</Button><Button type="primary" icon={<PlusOutlined />} onClick={() => { addForm.resetFields(); setAdding(true); }}>Add company</Button></>} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        <Stack>
          <Panel>
            <DataTable rowKey="id" dataSource={rows} pagination={false} empty={<EmptyState compact title="No company" description={null} />}
              columns={[{ title: "Code", dataIndex: "code", width: 110 }, { title: "Name", dataIndex: "name" }, { title: "Registered address", dataIndex: "registeredAddress", render: (x: string | null) => x ?? "—" }, { title: "Employees", dataIndex: "employees", width: 120 }]}
              mobile={{ title: (r) => r.name, subtitle: (r) => `${r.employees} employee(s)` }} />
          </Panel>
        </Stack>
      </QueryState>
      <SideDrawer open={adding} title="Add company" subtitle="A legal entity beside the main company. Audited." onClose={() => setAdding(false)} formId="entity-form" primaryLabel="Add" primaryLoading={add.isPending}>
        <Form id="entity-form" form={addForm} layout="vertical" requiredMark={false} onFinish={(v) => add.mutate(v)}>
          <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Za-z0-9_-]{1,20}$/, message: "Letters, digits, - or _" }]}><Input /></Form.Item>
          <Form.Item name="name" label="Legal name" rules={[{ required: true, min: 2 }]}><Input maxLength={120} /></Form.Item>
          <Form.Item name="registeredAddress" label="Registered address"><Input.TextArea rows={2} maxLength={300} /></Form.Item>
        </Form>
      </SideDrawer>
      <SideDrawer open={moving} title="Move employees" subtitle="To another company, or back to the main company. Audited." onClose={() => setMoving(false)} formId="move-form" primaryLabel="Move" primaryLoading={move.isPending}>
        <Form id="move-form" form={moveForm} layout="vertical" requiredMark={false} onFinish={(v) => move.mutate(v)}>
          <Form.Item name="legalEntityId" label="To" rules={[{ required: true }]}><Select options={rows.map((r) => ({ value: r.id, label: r.name }))} /></Form.Item>
          <Form.Item name="codes" label="Employee codes (separated by spaces, commas or lines)" rules={[{ required: true }]}><Input.TextArea rows={5} /></Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
