import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select, Switch } from "antd";
import { CheckOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import type { PolicyInput, PolicyRow } from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FormGroupTitle, Panel, SideDrawer, toast, useIsPhone } from "../../../../ui";
import { space, v } from "../../../../theme/tokens";
import { ActiveTag, CodeName, FieldGrid, PlaceholderTag } from "./common";
import { hoursLabel } from "./format";

const FORM_ID = "attendance-policy-form";

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
const fromForm = (val: FormValues): PolicyInput => {
  const { fullDayHours, halfDayHours, ...rest } = val;
  return { ...rest, fullDayMinMinutes: Math.round(fullDayHours * 60), halfDayMinMinutes: Math.round(halfDayHours * 60) };
};

function PolicyDrawer({ editing, open, onClose }: { editing: PolicyRow | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const placeholders = editing?.placeholderFields ?? [];

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(toForm(editing ?? NEW_POLICY));
  }, [open, editing, form]);

  const save = useMutation({
    mutationFn: (val: FormValues) => {
      const input = fromForm(val);
      if (!editing) return attendanceApi.createPolicy(input);
      const changed = Object.fromEntries(Object.entries(input).filter(([k, x]) => k !== "code" && x !== editing[k as keyof PolicyRow]));
      return attendanceApi.updatePolicy(editing.id, changed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success("Policy saved. Days already computed keep the old rule until you run Process Attendance for them.");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this policy.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="wide"
      title={editing ? `Edit ${editing.name}` : "Add Policy"}
      subtitle="How worked hours turn into a full day, a half day or LOP, and how punches are cleaned."
      formId={FORM_ID}
      primaryLabel="Save"
      primaryLoading={save.isPending}
    >
      <Form id={FORM_ID} form={form} layout="vertical" requiredMark={false} onFinish={(val) => save.mutate(val)}>
        <FieldGrid min={160}>
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: "Letters, digits, - or _" }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </FieldGrid>
        <FormGroupTitle>Day thresholds</FormGroupTitle>
        <FieldGrid min={200}>
          <Form.Item name="fullDayHours" label={<>Full-day minimum (hours)<PlaceholderTag field="fullDayMinMinutes" placeholders={placeholders} /></>} rules={[{ required: true }]}>
            <InputNumber min={0} max={24} step={0.25} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="halfDayHours" label={<>Half-day minimum (hours)<PlaceholderTag field="halfDayMinMinutes" placeholders={placeholders} /></>} rules={[{ required: true }]}>
            <InputNumber min={0} max={24} step={0.25} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="halfDayMinNotMetLopDays" label="Half-day minimum not met" tooltip="Spec §4.4: 1 day LOP by default.">
            <Select options={[{ value: 1, label: "1 day LOP" }, { value: 0.5, label: "½ day LOP" }, { value: 0, label: "No LOP" }]} />
          </Form.Item>
        </FieldGrid>
        <FormGroupTitle>Punches</FormGroupTitle>
        <FieldGrid min={200}>
          <Form.Item name="nearDuplicateSeconds" label="Near-duplicate window (seconds)" tooltip="Punches this close together count once.">
            <InputNumber min={0} max={3600} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="futureToleranceMinutes" label="Flag punches more than … min in the future">
            <InputNumber min={0} max={1440} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="maxPunchAgeDays" label="…or older than … days">
            <InputNumber min={1} max={400} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="inferBreakPairing" label="Infer breaks from extra punches" valuePropName="checked" tooltip="Off by default: our device sends no direction, so the scheduled break is deducted instead.">
            <Switch />
          </Form.Item>
        </FieldGrid>
        <ApprovalBanner
          tone="info"
          title="Late and early penalties: none"
          description="HR confirmed (8 Oct 2026) that lateness and early exits are recorded and visible, with no money and no half-day penalty."
        />
      </Form>
    </SideDrawer>
  );
}

function ThresholdsCell({ p }: { p: PolicyRow }) {
  return (
    <span>
      {hoursLabel(p.fullDayMinMinutes)} / {hoursLabel(p.halfDayMinMinutes)}
      {p.placeholderFields.length > 0 && <PlaceholderTag field={p.placeholderFields[0]!} placeholders={p.placeholderFields} />}
    </span>
  );
}

const lopLabel = (n: number) => (n ? `${n} day LOP` : "No LOP");
const penaltiesLabel = (p: PolicyRow) => <span style={{ color: v.textSecondary }}>{p.penaltyRules.length ? `${p.penaltyRules.length} rules` : "None"}</span>;

export function PoliciesTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "config", "policies"], queryFn: attendanceApi.listPolicies });
  const [editing, setEditing] = useState<PolicyRow | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<PolicyRow | null>(null);
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof attendanceApi.updatePolicy>[1] }) => attendanceApi.updatePolicy(id, body),
    onSuccess: (_r, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      if (vars.body.confirmPlaceholders) {
        toast.success("Values confirmed.");
        setConfirming(null);
      } else toast.success(vars.body.isActive ? "Policy reactivated." : "Policy deactivated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update this policy.")),
  });
  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (p: PolicyRow) => {
    setEditing(p);
    setOpen(true);
  };
  const size = phone ? "middle" : "small";
  const actions = (p: PolicyRow) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
      <Button size={size} icon={<EditOutlined />} onClick={() => openEdit(p)}>
        Edit
      </Button>
      {p.placeholderFields.length > 0 && (
        <Button size={size} icon={<CheckOutlined />} onClick={() => setConfirming(p)}>
          Confirm values
        </Button>
      )}
      <Button
        size={size}
        loading={patch.isPending && patch.variables?.id === p.id && patch.variables.body.isActive !== undefined}
        onClick={() => patch.mutate({ id: p.id, body: { isActive: !p.isActive } })}
      >
        {p.isActive ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  );

  return (
    <>
      <Panel
        title="Policies"
        subtitle="Full-day and half-day thresholds, LOP and punch cleaning"
        extra={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
              Add Policy
            </Button>
          )
        }
      >
        <DataTable<PolicyRow>
          rowKey="id"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={false}
          onRowOpen={canManage ? openEdit : undefined}
          empty={
            <EmptyState
              compact
              title="No policies yet"
              description={canManage ? "Add a policy so hours worked can be turned into days." : "HR hasn't set up any policies yet."}
              action={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Add Policy</Button>}
            />
          }
          columns={[
            { title: "Policy", key: "policy", render: (_, p) => <CodeName code={p.code} name={p.name} /> },
            { title: "Full day / half day", key: "thresholds", render: (_, p) => <ThresholdsCell p={p} /> },
            { title: "Half-day minimum not met", dataIndex: "halfDayMinNotMetLopDays", render: (n: number) => lopLabel(n) },
            { title: "Penalties", key: "penalties", render: (_, p) => penaltiesLabel(p) },
            { title: "People", dataIndex: "employeeCount", align: "right" },
            { title: "Status", key: "status", render: (_, p) => <ActiveTag isActive={p.isActive} isDefault={p.isDefault} /> },
            ...(canManage ? [{ title: "", key: "actions", render: (_: unknown, p: PolicyRow) => actions(p) }] : []),
          ]}
          mobile={{
            title: (p) => p.name,
            subtitle: (p) => p.code,
            status: (p) => <ActiveTag isActive={p.isActive} isDefault={p.isDefault} />,
            fields: [
              { label: "Full day / half day", render: (p) => <ThresholdsCell p={p} /> },
              { label: "Half-day minimum not met", render: (p) => lopLabel(p.halfDayMinNotMetLopDays) },
              { label: "Penalties", render: penaltiesLabel },
              { label: "People", render: (p) => p.employeeCount },
            ],
            actions: canManage ? actions : undefined,
          }}
        />
      </Panel>
      <PolicyDrawer editing={editing} open={open} onClose={() => setOpen(false)} />
      <ConfirmModal
        open={!!confirming}
        onCancel={() => setConfirming(null)}
        title="Confirm thresholds as they are?"
        description={confirming ? `Full day ${hoursLabel(confirming.fullDayMinMinutes)}, half day ${hoursLabel(confirming.halfDayMinMinutes)} — only if HR has confirmed these values.` : undefined}
        confirmLabel="Confirm values"
        loading={patch.isPending}
        onConfirm={() => confirming && patch.mutate({ id: confirming.id, body: { confirmPlaceholders: confirming.placeholderFields } })}
      />
    </>
  );
}
