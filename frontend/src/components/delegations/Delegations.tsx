import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import type { DelegateOption, DelegationPerson, DelegationRow, DelegationStatus } from "../../api/delegations";
import { fs } from "../../theme/tokens";

const { Text } = Typography;

// Shared by Workflow Delegates (employee portal: a manager's own) and
// Admin Tools → Workflow Delegates (HR: anyone's) — Phase 5 commit E3.

const STATUS_TAG: Record<DelegationStatus, { color: string; label: string }> = {
  ACTIVE: { color: "green", label: "Active" },
  SCHEDULED: { color: "blue", label: "Scheduled" },
  ENDED: { color: "default", label: "Ended" },
  REVOKED: { color: "red", label: "Revoked" },
};

const fmt = (d: string) => dayjs(d).format("DD MMM YYYY");
const who = (p: DelegationPerson) => (
  <Space orientation="vertical" size={0}>
    <span>
      {p.name} <Text type="secondary">({p.employeeCode})</Text>
    </span>
    {(p.designation || p.department) && <Text type="secondary" style={{ fontSize: fs.sm }}>{[p.designation, p.department].filter(Boolean).join(" · ")}</Text>}
  </Space>
);

export function DelegationsTable({ rows, loading, showDelegator, showDelegate = true, onRevoke, emptyText }: {
  rows: DelegationRow[];
  loading?: boolean;
  showDelegator?: boolean;
  showDelegate?: boolean;
  onRevoke?: (row: DelegationRow) => void;
  emptyText: string;
}) {
  return (
    <Table<DelegationRow>
      rowKey="id"
      size="middle"
      loading={loading}
      dataSource={rows}
      pagination={rows.length > 20 ? { pageSize: 20 } : false}
      locale={{ emptyText }}
      scroll={{ x: true }}
      columns={[
        ...(showDelegator ? [{ title: "Manager", key: "delegator", render: (_: unknown, r: DelegationRow) => who(r.delegator) }] : []),
        ...(showDelegate
          ? [
              {
                title: "Covered by",
                key: "delegate",
                render: (_: unknown, r: DelegationRow) => (
                  <Space size={6} align="start">
                    {who(r.delegate)}
                    {!r.delegateCanApprove && (r.status === "ACTIVE" || r.status === "SCHEDULED") && (
                      <Tooltip title="They no longer hold Approve leave (or aren't active), so they can't act on this delegation.">
                        <Tag color="warning" icon={<WarningOutlined />}>Can't approve</Tag>
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
            ]
          : []),
        { title: "Dates", key: "dates", render: (_, r) => (r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} → ${fmt(r.endDate)}`) },
        { title: "Status", key: "status", render: (_, r) => <Tag color={STATUS_TAG[r.status].color}>{STATUS_TAG[r.status].label}</Tag> },
        { title: "Reason", dataIndex: "reason", render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
        {
          title: "Decided on their behalf",
          key: "actions",
          render: (_, r) => (r.status === "SCHEDULED" ? <Text type="secondary">—</Text> : r.actionsOnBehalf),
        },
        {
          title: "History",
          key: "history",
          render: (_, r) => (
            <Space orientation="vertical" size={0}>
              <Text type="secondary" style={{ fontSize: fs.sm }}>Set up {r.createdBy ? `by ${r.createdBy} ` : ""}on {fmt(r.createdAt)}</Text>
              {r.revokedAt && (
                <Text type="secondary" style={{ fontSize: fs.sm }}>
                  Revoked {r.revokedBy ? `by ${r.revokedBy} ` : ""}on {fmt(r.revokedAt)}
                  {r.revokeReason ? ` — ${r.revokeReason}` : ""}
                </Text>
              )}
            </Space>
          ),
        },
        ...(onRevoke
          ? [
              {
                title: "",
                key: "revoke",
                render: (_: unknown, r: DelegationRow) =>
                  r.status === "ACTIVE" || r.status === "SCHEDULED" ? (
                    <Button size="small" danger onClick={() => onRevoke(r)}>
                      Revoke
                    </Button>
                  ) : null,
              },
            ]
          : []),
      ]}
    />
  );
}

export function RevokeDelegationModal({ row, onClose, onRevoke, loading }: { row: DelegationRow | null; onClose: () => void; onRevoke: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Modal
      title="Revoke this delegation?"
      open={row !== null}
      onCancel={onClose}
      onOk={() => onRevoke(reason)}
      okText="Revoke"
      okButtonProps={{ danger: true }}
      confirmLoading={loading}
      afterClose={() => setReason("")}
      destroyOnHidden
    >
      {row && (
        <Space orientation="vertical" style={{ width: "100%" }}>
          <Text>
            {row.delegate.name} stops covering {row.delegator.name}'s approvals {row.status === "ACTIVE" ? "immediately" : "— it won't start"}. Nothing they already decided changes.
          </Text>
          <Input.TextArea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
        </Space>
      )}
    </Modal>
  );
}

export interface NewDelegationValues {
  delegatorUserId?: string;
  delegateUserId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

// The create dialog. With `managers`, HR first picks whose approvals to
// delegate; the delegate list then comes from loadDelegates(that manager).
export function NewDelegationModal({ open, onClose, onSubmit, loading, managers, loadDelegates }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (v: NewDelegationValues) => void;
  loading: boolean;
  managers?: DelegationPerson[];
  loadDelegates: (delegatorUserId: string | undefined) => Promise<DelegateOption[]>;
}) {
  const [form] = Form.useForm();
  const delegatorUserId = Form.useWatch("delegatorUserId", form) as string | undefined;
  const needsManager = managers !== undefined;
  const { data: options = [], isLoading } = useQuery({
    queryKey: ["delegations", "delegate-options", delegatorUserId ?? "mine"],
    queryFn: () => loadDelegates(delegatorUserId),
    enabled: open && (!needsManager || !!delegatorUserId),
  });
  return (
    <Modal
      title={needsManager ? "Set up a delegation" : "Delegate my approvals"}
      open={open}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText="Delegate"
      confirmLoading={loading}
      afterClose={() => form.resetFields()}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={(v: { delegatorUserId?: string; delegateUserId: string; range: [Dayjs, Dayjs]; reason?: string }) =>
          onSubmit({ delegatorUserId: v.delegatorUserId, delegateUserId: v.delegateUserId, startDate: v.range[0].format("YYYY-MM-DD"), endDate: v.range[1].format("YYYY-MM-DD"), reason: v.reason })
        }
      >
        {needsManager && (
          <Form.Item name="delegatorUserId" label="Manager" rules={[{ required: true, message: "Pick the manager who'll be away." }]}>
            <Select
              showSearch
              optionFilterProp="label"
              placeholder="Whose approvals?"
              options={managers.map((m) => ({ value: m.userId, label: `${m.name} (${m.employeeCode})` }))}
              onChange={() => form.setFieldValue("delegateUserId", undefined)}
            />
          </Form.Item>
        )}
        <Form.Item
          name="delegateUserId"
          label="Covered by"
          extra="Only people who can already approve leave are listed — delegating never gives anyone a new permission."
          rules={[{ required: true, message: "Pick who covers the approvals." }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            loading={isLoading}
            disabled={needsManager && !delegatorUserId}
            placeholder={needsManager && !delegatorUserId ? "Pick the manager first" : "Who covers?"}
            options={options.map((o) => ({
              value: o.userId,
              label: `${o.name} (${o.employeeCode})${o.roles.length ? ` · ${o.roles.join(", ")}` : ""}`,
            }))}
          />
        </Form.Item>
        <Form.Item name="range" label="Dates (inclusive)" rules={[{ required: true, message: "Pick the dates." }]}>
          <DatePicker.RangePicker style={{ width: "100%" }} format="DD MMM YYYY" disabledDate={(d) => d.isBefore(dayjs(), "day")} />
        </Form.Item>
        <Form.Item name="reason" label="Reason">
          <Input maxLength={500} placeholder="e.g. On leave" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
