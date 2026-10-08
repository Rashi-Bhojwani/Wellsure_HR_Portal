import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Typography, message } from "antd";
import { CheckOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import type { PolicyInput, PolicyRow } from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ActiveTag, PlaceholderTag } from "./common";
import { hoursLabel } from "./format";

const { Text } = Typography;

const NEW_POLICY: PolicyInput = {
  code: "",
  name: "",
  fullDayMinMinutes: 360,
  halfDayMinMinutes: 180,
  halfDayMinNotMetLopDays: 1,
  nearDuplicateSeconds: 120,
  inferBreakPairing: false,
  futureToleranceMinutes: 10,
  maxPunchAgeDays: 45,
};

// Hours are entered as hours (HR's unit), stored as minutes.
type FormValues = Omit<PolicyInput, "fullDayMinMinutes" | "halfDayMinMinutes"> & { fullDayHours: number; halfDayHours: number };
const toForm = (p: PolicyInput): FormValues => {
  const { fullDayMinMinutes, halfDayMinMinutes, ...rest } = p;
  return { ...rest, fullDayHours: fullDayMinMinutes / 60, halfDayHours: halfDayMinMinutes / 60 };
};
const fromForm = (v: FormValues): PolicyInput => {
  const { fullDayHours, halfDayHours, ...rest } = v;
  return { ...rest, fullDayMinMinutes: Math.round(fullDayHours * 60), halfDayMinMinutes: Math.round(halfDayHours * 60) };
};

function PolicyModal({ editing, open, onClose }: { editing: PolicyRow | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const placeholders = editing?.placeholderFields ?? [];
  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const input = fromForm(v);
      if (!editing) return attendanceApi.createPolicy(input);
      const changed = Object.fromEntries(Object.entries(input).filter(([k, val]) => k !== "code" && val !== editing[k as keyof PolicyRow]));
      return attendanceApi.updatePolicy(editing.id, changed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      void message.success("Policy saved. Days already computed keep the old rule until you run Process Attendance for them.");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this policy.")),
  });
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add Policy"}
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnHidden
      afterOpenChange={(o) => o && form.setFieldsValue(toForm(editing ?? NEW_POLICY))}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => save.mutate(v)}>
        <Space size={12} style={{ width: "100%" }}>
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: "Letters, digits, - or _" }]}>
            <Input disabled={!!editing} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Input />
          </Form.Item>
        </Space>
        <Typography.Title level={5}>Day thresholds</Typography.Title>
        <Space size={12} wrap>
          <Form.Item name="fullDayHours" label={<>Full-day minimum (hours)<PlaceholderTag field="fullDayMinMinutes" placeholders={placeholders} /></>} rules={[{ required: true }]}>
            <InputNumber min={0} max={24} step={0.25} />
          </Form.Item>
          <Form.Item name="halfDayHours" label={<>Half-day minimum (hours)<PlaceholderTag field="halfDayMinMinutes" placeholders={placeholders} /></>} rules={[{ required: true }]}>
            <InputNumber min={0} max={24} step={0.25} />
          </Form.Item>
          <Form.Item name="halfDayMinNotMetLopDays" label="Half-day minimum not met" tooltip="Spec §4.4: 1 day LOP by default.">
            <Select style={{ width: 160 }} options={[{ value: 1, label: "1 day LOP" }, { value: 0.5, label: "½ day LOP" }, { value: 0, label: "No LOP" }]} />
          </Form.Item>
        </Space>
        <Typography.Title level={5}>Punches</Typography.Title>
        <Space size={12} wrap>
          <Form.Item name="nearDuplicateSeconds" label="Near-duplicate window (seconds)" tooltip="Punches this close together count once.">
            <InputNumber min={0} max={3600} />
          </Form.Item>
          <Form.Item name="futureToleranceMinutes" label="Flag punches more than … min in the future">
            <InputNumber min={0} max={1440} />
          </Form.Item>
          <Form.Item name="maxPunchAgeDays" label="…or older than … days">
            <InputNumber min={1} max={400} />
          </Form.Item>
          <Form.Item name="inferBreakPairing" label="Infer breaks from extra punches" valuePropName="checked" tooltip="Off by default: our device sends no direction, so the scheduled break is deducted instead.">
            <Switch />
          </Form.Item>
        </Space>
        <Alert type="info" showIcon title="Late and early penalties: none" description="HR confirmed (8 Oct 2026) that lateness and early exits are recorded and visible, with no money and no half-day penalty." />
        <Form.Item style={{ marginTop: 12, marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function PoliciesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["attendance", "config", "policies"], queryFn: attendanceApi.listPolicies });
  const [editing, setEditing] = useState<PolicyRow | null>(null);
  const [open, setOpen] = useState(false);
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof attendanceApi.updatePolicy>[1] }) => attendanceApi.updatePolicy(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] }),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not update this policy.")),
  });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {canManage && (
        <Button type="primary" icon={<PlusOutlined />} style={{ alignSelf: "flex-end" }} onClick={() => { setEditing(null); setOpen(true); }}>
          Add Policy
        </Button>
      )}
      <Table<PolicyRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          {
            title: "Full day / half day",
            key: "thresholds",
            render: (_, p) => (
              <>
                {hoursLabel(p.fullDayMinMinutes)} / {hoursLabel(p.halfDayMinMinutes)}
                {p.placeholderFields.length > 0 && <PlaceholderTag field={p.placeholderFields[0]!} placeholders={p.placeholderFields} />}
              </>
            ),
          },
          { title: "Half-day minimum not met", dataIndex: "halfDayMinNotMetLopDays", render: (v: number) => (v ? `${v} day LOP` : "No LOP") },
          { title: "Penalties", key: "penalties", render: (_, p) => <Text type="secondary">{p.penaltyRules.length ? `${p.penaltyRules.length} rules` : "None"}</Text> },
          { title: "People", dataIndex: "employeeCount" },
          { title: "Status", key: "status", render: (_, p) => <ActiveTag isActive={p.isActive} isDefault={p.isDefault} /> },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, p: PolicyRow) => (
                    <Space wrap>
                      <Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(p); setOpen(true); }}>
                        Edit
                      </Button>
                      {p.placeholderFields.length > 0 && (
                        <Popconfirm
                          title="Confirm thresholds as they are?"
                          description={`Full day ${hoursLabel(p.fullDayMinMinutes)}, half day ${hoursLabel(p.halfDayMinMinutes)} — only if HR has confirmed these values.`}
                          onConfirm={() => patch.mutate({ id: p.id, body: { confirmPlaceholders: p.placeholderFields } })}
                        >
                          <Button size="small" icon={<CheckOutlined />}>
                            Confirm values
                          </Button>
                        </Popconfirm>
                      )}
                      <Button size="small" onClick={() => patch.mutate({ id: p.id, body: { isActive: !p.isActive } })}>
                        {p.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <PolicyModal editing={editing} open={open} onClose={() => setOpen(false)} />
    </Space>
  );
}
