import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select, Switch } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as parityApi from "../../../../api/parity";
import { apiErrorMessage as errorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, SideDrawer, toast } from "../../../../ui";
import { space } from "../../../../theme/tokens";

// A-9 G7 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md, item 10): how a person left is chosen from the company's own list. Nothing is seeded: until the company
// makes its list, every separation's mode is Not set. A mode is switched off, never deleted.

export function ModesDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const modes = useQuery({ queryKey: ["separation-modes", "all"], queryFn: () => parityApi.listSeparationModes(true), enabled: open });
  const [form] = Form.useForm<{ code: string; label: string }>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["separation-modes"] });
  const add = useMutation({
    mutationFn: parityApi.createSeparationMode,
    onSuccess: () => {
      toast.success("Mode added.");
      form.resetFields();
      refresh();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not add it.")),
  });
  const toggle = useMutation({ mutationFn: (m: parityApi.SeparationMode) => parityApi.updateSeparationMode(m.id, { isActive: !m.isActive }), onSuccess: refresh, onError: (err) => toast.error(errorMessage(err, "Could not change it.")) });
  return (
    <SideDrawer open={open} title="Modes of leaving" subtitle="The company's own list. Switched off, never deleted." onClose={onClose} footer={null}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(values) => add.mutate(values)}>
        <Form.Item name="label" label="Name" rules={[{ required: true, whitespace: true, message: "Give it a name." }]}>
          <Input maxLength={80} placeholder="For example: Resignation" />
        </Form.Item>
        <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Z0-9_]+$/, message: "Capital letters, digits and underscores." }]}>
          <Input maxLength={40} placeholder="RESIGNATION" />
        </Form.Item>
        <Button htmlType="submit" type="primary" icon={<PlusOutlined />} loading={add.isPending} style={{ marginBottom: space[4] }}>
          Add mode
        </Button>
      </Form>
      <DataTable<parityApi.SeparationMode>
        rowKey="id"
        loading={modes.isLoading}
        error={modes.error}
        onRetry={() => void modes.refetch()}
        dataSource={modes.data ?? []}
        pagination={false}
        empty={<EmptyState compact title="Not set: the company has no modes yet." description={null} />}
        columns={[
          { title: "Name", dataIndex: "label", key: "l" },
          { title: "Code", dataIndex: "code", key: "c" },
          { title: "In use", key: "a", render: (_: unknown, m) => <Switch checked={m.isActive} aria-label={`${m.label} in use`} onChange={() => toggle.mutate(m)} /> },
        ]}
        mobile={{ title: (m) => m.label, subtitle: (m) => m.code, actions: (m) => <Switch checked={m.isActive} aria-label={`${m.label} in use`} onChange={() => toggle.mutate(m)} /> }}
      />
    </SideDrawer>
  );
}

export function SetModeModal({ separation, current, onClose }: { separation: { id: string; employeeName: string } | null; current: string | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const modes = useQuery({ queryKey: ["separation-modes", "active"], queryFn: () => parityApi.listSeparationModes(false), enabled: Boolean(separation) });
  const [modeId, setModeId] = useState<string | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const chosen = modeId === undefined ? current : modeId;
  const save = useMutation({
    mutationFn: () => parityApi.setSeparationMode(separation!.id, chosen ?? null, reason.trim()),
    onSuccess: () => {
      toast.success("Mode saved.");
      void queryClient.invalidateQueries({ queryKey: ["separation-modes"] });
      setReason("");
      setModeId(undefined);
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save it.")),
  });
  return (
    <ConfirmModal open={Boolean(separation)} title={`How ${separation?.employeeName ?? ""} is leaving`} confirmLabel="Save" confirmDisabled={reason.trim().length < 3} loading={save.isPending} onCancel={onClose} onConfirm={() => save.mutate()}>
      <div style={{ display: "flex", flexDirection: "column", gap: space[3], marginTop: space[2] }}>
        <Select aria-label="Mode" allowClear placeholder="Not set" value={chosen ?? undefined} onChange={(v2) => setModeId(v2 ?? null)} options={(modes.data ?? []).map((m) => ({ value: m.id, label: m.label }))} notFoundContent="Not set: add modes first" />
        <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
    </ConfirmModal>
  );
}
