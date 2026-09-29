import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import { EditOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { LeavePolicy, LeaveTypeAdminRow } from "../../../api/leave";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { useAuth } from "../../../hooks/useAuth";

const { Title } = Typography;

function TypeModal({ open, editing, onClose }: { open: boolean; editing: LeaveTypeAdminRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: { code: string; name: string; isPaid: boolean; allowHalfDay: boolean; isActive?: boolean }) =>
      editing ? leaveApi.updateLeaveType(editing.id, values) : leaveApi.createLeaveType(values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "types"] });
      void message.success(editing ? "Leave type updated." : "Leave type created.");
      onClose();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save this leave type.")),
  });

  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add Leave Type"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      afterOpenChange={(isOpen) => isOpen && form.setFieldsValue(editing ?? { isPaid: true, allowHalfDay: true, isActive: true })}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => saveMutation.mutate(v)}>
        <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Z0-9_]+$/, message: "Upper-case letters, digits or underscore" }]}>
          <Input disabled={!!editing} placeholder="e.g. SICK" />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true }]}>
          <Input />
        </Form.Item>
        <Form.Item name="isPaid" label="Paid" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item name="allowHalfDay" label="Allow half-day" valuePropName="checked">
          <Switch />
        </Form.Item>
        {editing && (
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

// Every leave_policies field is shown here, uniformly, regardless of which
// leave type conventionally uses it — the standing rule that every
// configurable value gets an admin screen, and a future 6th leave type
// might use a field only PL/COF/WFH/RH use today.
function PolicyModal({ open, leaveType, onClose }: { open: boolean; leaveType: LeaveTypeAdminRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();

  const saveMutation = useMutation({
    mutationFn: (values: Partial<Omit<LeavePolicy, "id" | "leaveTypeId">>) => leaveApi.upsertLeavePolicy(leaveType!.id, values),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "types", "all"] });
      void message.success("Policy updated.");
      onClose();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save this policy.")),
  });

  return (
    <Modal
      title={`${leaveType?.name} — Policy`}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={640}
      afterOpenChange={(isOpen) => isOpen && form.setFieldsValue(leaveType?.policy ?? {})}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => saveMutation.mutate(v)}>
        <Title level={5}>Accrual</Title>
        <Space size={16} style={{ width: "100%" }}>
          <Form.Item name="accrualEnabled" label="Accrual enabled" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
          <Form.Item name="accrualDaysPerMonth" label="Days per month" style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} min={0} max={31} step={0.5} />
          </Form.Item>
        </Space>
        <Space size={16} style={{ width: "100%" }}>
          <Form.Item name="eligibilityMode" label="Eligibility mode" style={{ flex: 1 }}>
            <Select
              allowClear
              options={[
                { value: "DAYS", label: "Calendar days from DOJ" },
                { value: "CALENDAR_MONTHS", label: "Calendar months from DOJ" },
              ]}
            />
          </Form.Item>
          <Form.Item name="eligibilityValue" label="Eligibility value" style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Space>
        <Form.Item name="carryForwardCapDays" label="Carry-forward cap (days) — leave blank for uncapped">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>

        <Title level={5}>Balance rules</Title>
        <Space size={16} style={{ width: "100%" }}>
          <Form.Item name="negativeBalanceAllowed" label="Negative balance allowed" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
          <Form.Item name="skipBalanceCheck" label="Skip balance check entirely" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
          <Form.Item name="yearEndEncashment" label="Year-end encashment" valuePropName="checked" style={{ flex: 1 }}>
            <Switch />
          </Form.Item>
        </Space>

        <Title level={5}>Comp-off (COF only)</Title>
        <Space size={16} style={{ width: "100%" }}>
          <Form.Item name="compOffMinHoursWorked" label="Min hours worked to earn a credit" style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} min={0} max={24} step={0.5} />
          </Form.Item>
          <Form.Item name="compOffExpiryDays" label="Expiry (days from earning)" style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Space>

        <Title level={5}>WFH (WFH only)</Title>
        <Space size={16} style={{ width: "100%" }}>
          <Form.Item name="wfhMonthlyLimit" label="Monthly limit — blank for unlimited" style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
          <Form.Item name="wfhYearlyLimit" label="Yearly limit — blank for unlimited" style={{ flex: 1 }}>
            <InputNumber style={{ width: "100%" }} min={0} />
          </Form.Item>
        </Space>

        <Title level={5}>Restricted Holiday (RH only)</Title>
        <Form.Item name="rhYearlyQuota" label="Yearly quota — blank for unlimited">
          <InputNumber style={{ width: "100%" }} min={0} />
        </Form.Item>

        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save Policy
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function LeaveTypesPoliciesPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("leave.policy.manage");
  const { data: leaveTypes = [], isLoading } = useQuery({ queryKey: ["leave", "types", "all"], queryFn: leaveApi.listAllLeaveTypes });
  const [typeModalOpen, setTypeModalOpen] = useState(false);
  const [editingType, setEditingType] = useState<LeaveTypeAdminRow | null>(null);
  const [policyModalOpen, setPolicyModalOpen] = useState(false);
  const [editingPolicyFor, setEditingPolicyFor] = useState<LeaveTypeAdminRow | null>(null);

  function openCreate() {
    setEditingType(null);
    setTypeModalOpen(true);
  }
  function openEditType(t: LeaveTypeAdminRow) {
    setEditingType(t);
    setTypeModalOpen(true);
  }
  function openEditPolicy(t: LeaveTypeAdminRow) {
    setEditingPolicyFor(t);
    setPolicyModalOpen(true);
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Leave Types & Policies
      </Title>
      <HelpStrip storageKey="leave-types-policies-help">
        Every leave type's policy is configurable here — accrual, eligibility, carry-forward, balance rules, comp-off, WFH and Restricted Holiday
        limits. Several defaults below are still pending HR/CA confirmation (see docs/PROGRESS.md's Open Questions) — change them here once confirmed.
      </HelpStrip>
      {canManage && (
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ alignSelf: "flex-end" }}>
          Add Leave Type
        </Button>
      )}
      <Table<LeaveTypeAdminRow>
        rowKey="id"
        loading={isLoading}
        dataSource={leaveTypes}
        pagination={false}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          { title: "Paid", dataIndex: "isPaid", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Paid" : "Unpaid"}</Tag> },
          { title: "Half-day", dataIndex: "allowHalfDay", render: (v: boolean) => (v ? "Yes" : "No") },
          { title: "Status", dataIndex: "isActive", render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Inactive"}</Tag> },
          {
            title: "Policy summary",
            key: "policy",
            render: (_, t) =>
              t.policy ? (
                <Space size={4} wrap>
                  {t.policy.accrualEnabled && <Tag>Accrual {t.policy.accrualDaysPerMonth}/mo</Tag>}
                  {t.policy.eligibilityMode && <Tag>{t.policy.eligibilityValue} {t.policy.eligibilityMode === "DAYS" ? "days" : "months"} wait</Tag>}
                  {t.policy.skipBalanceCheck && <Tag>No balance check</Tag>}
                  {t.policy.negativeBalanceAllowed && <Tag>Negative allowed</Tag>}
                  {t.policy.yearEndEncashment && <Tag color="blue">Year-end encashment</Tag>}
                </Space>
              ) : (
                <Alert type="warning" showIcon message="No policy set" banner style={{ padding: "2px 8px" }} />
              ),
          },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, t: LeaveTypeAdminRow) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEditType(t)}>
                        Edit
                      </Button>
                      <Button size="small" icon={<SettingOutlined />} onClick={() => openEditPolicy(t)}>
                        Policy
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <TypeModal open={typeModalOpen} editing={editingType} onClose={() => setTypeModalOpen(false)} />
      <PolicyModal open={policyModalOpen} leaveType={editingPolicyFor} onClose={() => setPolicyModalOpen(false)} />
    </Space>
  );
}
