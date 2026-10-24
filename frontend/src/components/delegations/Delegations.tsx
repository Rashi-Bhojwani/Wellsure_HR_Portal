import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select, Tooltip } from "antd";
import { WarningOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import type { DelegateOption, DelegationPerson, DelegationRow, DelegationStatus } from "../../api/delegations";
import { fs, fw, space, v } from "../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, InitialsAvatar, SideDrawer, StatusChip, useIsPhone, type ChipTone } from "../../ui";

// Shared by Workflow Delegates (employee portal: a manager's own) and
// Admin Tools → Workflow Delegates (HR: anyone's) — Phase 5 commit E3.

const STATUS_CHIP: Record<DelegationStatus, { tone: ChipTone; label: string }> = {
  ACTIVE: { tone: "success", label: "Active" },
  SCHEDULED: { tone: "info", label: "Scheduled" },
  ENDED: { tone: "neutral", label: "Ended" },
  REVOKED: { tone: "danger", label: "Revoked" },
};

const fmt = (d: string) => dayjs(d).format("DD MMM YYYY");
const dates = (r: DelegationRow) => (r.startDate === r.endDate ? fmt(r.startDate) : `${fmt(r.startDate)} → ${fmt(r.endDate)}`);
const meta = (p: DelegationPerson) => [p.designation, p.department].filter(Boolean).join(" · ");

function Who({ p }: { p: DelegationPerson }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
      <InitialsAvatar name={p.name} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>
          {p.name} <span style={{ fontWeight: fw.regular, color: v.textSecondary }}>({p.employeeCode})</span>
        </div>
        {meta(p) && <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{meta(p)}</div>}
      </div>
    </div>
  );
}

const cantApprove = (r: DelegationRow) => !r.delegateCanApprove && (r.status === "ACTIVE" || r.status === "SCHEDULED");

function CantApprove({ r }: { r: DelegationRow }) {
  if (!cantApprove(r)) return null;
  return (
    <Tooltip title="They no longer hold Approve leave (or aren't active), so they can't act on this delegation.">
      <span tabIndex={0}>
        <StatusChip tone="warning" icon={<WarningOutlined />}>
          Can't approve
        </StatusChip>
      </span>
    </Tooltip>
  );
}

function History({ r }: { r: DelegationRow }) {
  return (
    <div style={{ fontSize: fs.sm, color: v.textSecondary }}>
      <div>
        Set up {r.createdBy ? `by ${r.createdBy} ` : ""}on {fmt(r.createdAt)}
      </div>
      {r.revokedAt && (
        <div>
          Revoked {r.revokedBy ? `by ${r.revokedBy} ` : ""}on {fmt(r.revokedAt)}
          {r.revokeReason ? ` — ${r.revokeReason}` : ""}
        </div>
      )}
    </div>
  );
}

export function DelegationsTable({ rows, loading, showDelegator, showDelegate = true, onRevoke, emptyText }: {
  rows: DelegationRow[];
  loading?: boolean;
  showDelegator?: boolean;
  showDelegate?: boolean;
  onRevoke?: (row: DelegationRow) => void;
  emptyText: string;
}) {
  const phone = useIsPhone();
  const canRevoke = (r: DelegationRow) => onRevoke && (r.status === "ACTIVE" || r.status === "SCHEDULED");
  const revokeButton = (r: DelegationRow) =>
    canRevoke(r) ? (
      <Button size={phone ? "middle" : "small"} danger onClick={() => onRevoke!(r)}>
        Revoke
      </Button>
    ) : null;
  const primary = (r: DelegationRow) => (showDelegator ? r.delegator : r.delegate);

  return (
    <DataTable<DelegationRow>
      rowKey="id"
      loading={loading}
      dataSource={rows}
      pagination={rows.length > 20 ? { pageSize: 20 } : false}
      empty={emptyText ? <EmptyState compact illustration="people" title={emptyText} description={null} /> : <span />}
      mobile={{
        avatar: (r) => <InitialsAvatar name={primary(r).name} size={40} />,
        title: (r) => `${primary(r).name} (${primary(r).employeeCode})`,
        subtitle: (r) => (showDelegator && showDelegate ? `Covered by ${r.delegate.name}` : meta(primary(r)) || undefined),
        status: (r) => <StatusChip tone={STATUS_CHIP[r.status].tone}>{STATUS_CHIP[r.status].label}</StatusChip>,
        fields: [
          { label: "Dates", render: dates },
          { label: "Decided on their behalf", render: (r) => (r.status === "SCHEDULED" ? "—" : r.actionsOnBehalf) },
          { label: "Reason", render: (r) => r.reason ?? "—" },
          ...(showDelegate ? [{ label: "Delegate", render: (r: DelegationRow) => (cantApprove(r) ? <CantApprove r={r} /> : "—") }] : []),
        ],
        actions: onRevoke ? (r) => revokeButton(r) : undefined,
      }}
      columns={[
        ...(showDelegator ? [{ title: "Manager", key: "delegator", render: (_: unknown, r: DelegationRow) => <Who p={r.delegator} /> }] : []),
        ...(showDelegate
          ? [
              {
                title: "Covered by",
                key: "delegate",
                render: (_: unknown, r: DelegationRow) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: space[1], alignItems: "flex-start" }}>
                    <Who p={r.delegate} />
                    <CantApprove r={r} />
                  </div>
                ),
              },
            ]
          : []),
        { title: "Dates", key: "dates", render: (_, r) => <span className="ws-num">{dates(r)}</span> },
        { title: "Status", key: "status", render: (_, r) => <StatusChip tone={STATUS_CHIP[r.status].tone}>{STATUS_CHIP[r.status].label}</StatusChip> },
        { title: "Reason", dataIndex: "reason", render: (val: string | null) => val ?? <span style={{ color: v.textSecondary }}>—</span> },
        {
          title: "Decided on their behalf",
          key: "actions",
          align: "right",
          render: (_, r) => (r.status === "SCHEDULED" ? <span style={{ color: v.textSecondary }}>—</span> : <span className="ws-num">{r.actionsOnBehalf}</span>),
        },
        { title: "History", key: "history", render: (_, r) => <History r={r} /> },
        ...(onRevoke ? [{ title: "", key: "revoke", align: "right" as const, render: (_: unknown, r: DelegationRow) => revokeButton(r) }] : []),
      ]}
    />
  );
}

export function RevokeDelegationModal({ row, onClose, onRevoke, loading }: { row: DelegationRow | null; onClose: () => void; onRevoke: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("");
  // A fresh, empty reason for each delegation opened (state adjusted during render, not in an effect).
  const rowId = row?.id;
  const [shownFor, setShownFor] = useState(rowId);
  if (rowId !== shownFor) {
    setShownFor(rowId);
    setReason("");
  }
  const close = onClose;
  return (
    <ConfirmModal
      open={row !== null}
      onCancel={close}
      onConfirm={() => onRevoke(reason)}
      title="Revoke this delegation?"
      description={row ? `${row.delegate.name} stops covering ${row.delegator.name}'s approvals ${row.status === "ACTIVE" ? "immediately" : "— it won't start"}. Nothing they already decided changes.` : undefined}
      confirmLabel="Revoke"
      danger
      loading={loading}
    >
      <label htmlFor="revoke-reason" className="ws-sr-only">
        Reason (optional)
      </label>
      <Input.TextArea id="revoke-reason" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional)" />
    </ConfirmModal>
  );
}

export interface NewDelegationValues {
  delegatorUserId?: string;
  delegateUserId: string;
  startDate: string;
  endDate: string;
  reason?: string;
}

const NEW_DELEGATION_FORM = "new-delegation-form";

// The create form, in a side drawer. With `managers`, HR first picks whose approvals to
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
    <SideDrawer
      open={open}
      onClose={onClose}
      title={needsManager ? "Set up a delegation" : "Delegate my approvals"}
      subtitle="Hand leave approvals to someone who can already approve leave, for a date range."
      formId={NEW_DELEGATION_FORM}
      primaryLabel="Delegate"
      primaryLoading={loading}
    >
      <Form
        id={NEW_DELEGATION_FORM}
        form={form}
        layout="vertical"
        size="large"
        preserve={false}
        onFinish={(val: { delegatorUserId?: string; delegateUserId: string; range: [Dayjs, Dayjs]; reason?: string }) =>
          onSubmit({ delegatorUserId: val.delegatorUserId, delegateUserId: val.delegateUserId, startDate: val.range[0].format("YYYY-MM-DD"), endDate: val.range[1].format("YYYY-MM-DD"), reason: val.reason })
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
    </SideDrawer>
  );
}
