import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, DatePicker, Form, Input, Select, Tooltip } from "antd";
import type { Dayjs } from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as adminHomeApi from "../../../api/adminHome";
import * as leaveApi from "../../../api/leave";
import type { LeaveRequestRow, LeaveRequestStatus } from "../../../api/leave";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { LeaveLedgerTable } from "../../../components/leave/LeaveLedgerTable";
import { useAuth } from "../../../hooks/useAuth";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../ui";

const { RangePicker } = DatePicker;

const STATUS_OPTIONS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => ({ value: s, label: s }));
const DAY_PART_OPTIONS = [
  { value: "FULL", label: "Full Day" },
  { value: "FIRST_HALF", label: "First Half" },
  { value: "SECOND_HALF", label: "Second Half" },
];
const ON_BEHALF_FORM = "leave-on-behalf-form";

interface OnBehalfFormValues {
  employeeId: string;
  leaveTypeId: string;
  dateRange: [Dayjs, Dayjs];
  fromDayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  toDayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  reason?: string;
}

function OnBehalfDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<OnBehalfFormValues>();
  const queryClient = useQueryClient();
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes, enabled: open, staleTime: 30_000 });

  const applyMutation = useMutation({
    mutationFn: (values: OnBehalfFormValues) =>
      leaveApi.applyForLeave({
        employeeId: values.employeeId,
        leaveTypeId: values.leaveTypeId,
        fromDate: values.dateRange[0].format("YYYY-MM-DD"),
        toDate: values.dateRange[1].format("YYYY-MM-DD"),
        fromDayPart: values.fromDayPart,
        toDayPart: values.toDayPart,
        reason: values.reason,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "requests"] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
      toast.success(`Applied for ${result.totalDays} day(s) on their behalf — pending approval.`);
      form.resetFields();
      onClose();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not submit this request.")),
  });

  return (
    <SideDrawer open={open} onClose={onClose} title="Apply for Leave on Behalf" formId={ON_BEHALF_FORM} primaryLabel="Submit" primaryLoading={applyMutation.isPending}>
      <Form id={ON_BEHALF_FORM} form={form} layout="vertical" requiredMark={false} size="large" onFinish={(val) => applyMutation.mutate(val)}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <EmployeePicker />
        </Form.Item>
        <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true }]}>
          <Select options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Select a leave type" />
        </Form.Item>
        <Form.Item name="dateRange" label="Dates" rules={[{ required: true }]}>
          <RangePicker style={{ width: "100%" }} format="DD MMM YYYY" />
        </Form.Item>
        <div style={{ display: "flex", gap: space[4] }}>
          <Form.Item name="fromDayPart" label="First Day" initialValue="FULL" style={{ flex: 1, minWidth: 0 }}>
            <Select options={DAY_PART_OPTIONS} />
          </Form.Item>
          <Form.Item name="toDayPart" label="Last Day" initialValue="FULL" style={{ flex: 1, minWidth: 0 }}>
            <Select options={DAY_PART_OPTIONS} />
          </Form.Item>
        </div>
        <Form.Item name="reason" label="Reason">
          <Input.TextArea rows={3} placeholder="Optional" />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

const fmtDates = (r: LeaveRequestRow) => (r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`);

function NoManagerChip({ r }: { r: LeaveRequestRow }) {
  if (!r.noTeamApprover) return null;
  return (
    <Tooltip title={r.noTeamApprover === "NO_MANAGER" ? "No reporting manager — HR decides." : "Their manager hasn't been given leave approval and nobody is covering — HR decides."}>
      <span tabIndex={0}>
        <StatusChip tone="warning">No manager can approve</StatusChip>
      </span>
    </Tooltip>
  );
}

export function EmployeeLeavePage() {
  const { hasPermission } = useAuth();
  const phone = useIsPhone();
  const canApprove = hasPermission("leave.approve");
  const canApplyOnBehalf = hasPermission("leave.apply.onBehalf");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveRequestStatus | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [onBehalfOpen, setOnBehalfOpen] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [rejectComments, setRejectComments] = useState("");
  const [cancelling, setCancelling] = useState<LeaveRequestRow | null>(null);
  const [ledgerFor, setLedgerFor] = useState<LeaveRequestRow | null>(null);

  // Requests nobody on the team side can decide (no manager with leave
  // approval, no delegate, or no manager at all) — HR's to decide. Linked
  // from the notification and Admin Home as ?noTeamApprover=1.
  const [params, setParams] = useSearchParams();
  const onlyNoTeamApprover = params.get("noTeamApprover") === "1";
  const setOnlyNoTeamApprover = (on: boolean) => setParams(on ? { noTeamApprover: "1" } : {}, { replace: true });
  const { data: taskCounts } = useQuery({ queryKey: ["admin", "tasks", "counts"], queryFn: adminHomeApi.getTaskCounts });
  const noTeamApproverCount = taskCounts?.leaveNoTeamApprover ?? 0;

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["leave", "requests", "admin", status, onlyNoTeamApprover],
    queryFn: () => leaveApi.listLeaveRequests({ status, noTeamApprover: onlyNoTeamApprover || undefined, pageSize: 100 }),
    placeholderData: keepPreviousData,
  });
  // The search narrows the loaded page in the browser (by name or employee code); the status filter is the server's.
  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((r) => r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)) : all;
  }, [data, search]);

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["leave", "requests"] });
    void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => leaveApi.approveLeaveRequest(id),
    onSuccess: () => {
      toast.success("Approved.");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not approve this request.")),
  });
  const rejectMutation = useMutation({
    mutationFn: () => leaveApi.rejectLeaveRequest(rejecting!.id, rejectComments),
    onSuccess: () => {
      toast.success("Rejected.");
      setRejecting(null);
      setRejectComments("");
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not reject this request.")),
  });
  const cancelMutation = useMutation({
    mutationFn: (id: string) => leaveApi.cancelLeaveRequest(id, "Cancelled by HR"),
    onSuccess: () => {
      toast.success("Cancelled.");
      setCancelling(null);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, "Could not cancel this request.")),
  });

  const rowActions = (r: LeaveRequestRow) => (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "flex-start" : "flex-end" }}>
      <Button size={phone ? "middle" : "small"} onClick={() => setLedgerFor(r)}>
        History
      </Button>
      {canApprove && r.status === "PENDING" && (
        <>
          <Button
            size={phone ? "middle" : "small"}
            type="primary"
            loading={approveMutation.isPending && approveMutation.variables === r.id}
            disabled={approveMutation.isPending && approveMutation.variables !== r.id}
            onClick={() => approveMutation.mutate(r.id)}
          >
            Approve
          </Button>
          <Button size={phone ? "middle" : "small"} danger onClick={() => setRejecting(r)}>
            Reject
          </Button>
        </>
      )}
      {canApprove && (r.status === "PENDING" || r.status === "APPROVED") && (
        <Button size={phone ? "middle" : "small"} onClick={() => setCancelling(r)}>
          Cancel
        </Button>
      )}
    </div>
  );

  const person = (r: LeaveRequestRow) => (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
      <InitialsAvatar name={r.employeeName} size={36} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.employeeName}</div>
        <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{r.employeeCode}</div>
        {r.noTeamApprover && (
          <div style={{ marginTop: 2 }}>
            <NoManagerChip r={r} />
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Employee Leave"
        subtitle="Every leave request in your scope — approve, reject or cancel"
        actions={
          canApplyOnBehalf && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setOnBehalfOpen(true)} block={phone}>
              Apply on Behalf
            </Button>
          )
        }
      />

      {(noTeamApproverCount > 0 || onlyNoTeamApprover) && (
        <ApprovalBanner
          tone={noTeamApproverCount > 0 ? "warning" : "success"}
          style={{ marginBottom: space[6] }}
          title={
            noTeamApproverCount > 0
              ? `${noTeamApproverCount} pending ${noTeamApproverCount === 1 ? "request has" : "requests have"} no manager who can approve ${noTeamApproverCount === 1 ? "it" : "them"}`
              : "Every pending request has a manager or delegate who can approve it"
          }
          description={noTeamApproverCount > 0 ? "Their manager hasn't been given leave approval (and nobody is covering), or they have no reporting manager — so these wait on HR." : undefined}
          actions={<Button onClick={() => setOnlyNoTeamApprover(!onlyNoTeamApprover)}>{onlyNoTeamApprover ? "Show all requests" : "Show only these"}</Button>}
        />
      )}

      <Panel title="Leave requests" subtitle={data ? `${data.total} request(s)` : undefined}>
        <FilterBar
          onSearch={setSearch}
          searchValue={search}
          searchPlaceholder="Search employee"
          activeCount={status ? 1 : 0}
          onClear={() => setStatus(undefined)}
          filters={
            <Select
              allowClear
              placeholder="All statuses"
              aria-label="Filter by status"
              style={{ width: phone ? "100%" : 200 }}
              options={STATUS_OPTIONS}
              value={status}
              onChange={(val) => setStatus(val as LeaveRequestStatus | undefined)}
            />
          }
        />
        <DataTable<LeaveRequestRow>
          rowKey="id"
          loading={isLoading || isFetching}
          error={error}
          onRetry={() => void refetch()}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          empty={<EmptyState compact kind={search || status || onlyNoTeamApprover ? "no-results" : "empty"} illustration="inbox" title="No leave requests found" description={null} />}
          mobile={{
            avatar: (r) => <InitialsAvatar name={r.employeeName} size={40} />,
            title: (r) => r.employeeName,
            subtitle: (r) => `${r.employeeCode} · ${r.leaveTypeName}`,
            status: (r) => <StatusChip status={r.status} />,
            fields: [
              { label: "Dates", render: fmtDates },
              { label: "Days", render: (r) => r.totalDays },
              { label: "Reason", render: (r) => r.reason ?? "—" },
              { label: "Approver", render: (r) => (r.noTeamApprover ? <NoManagerChip r={r} /> : "—") },
            ],
            actions: rowActions,
          }}
          columns={[
            { title: "Employee", key: "employee", render: (_, r) => person(r) },
            { title: "Type", dataIndex: "leaveTypeName" },
            { title: "Dates", key: "dates", render: (_, r) => <span className="ws-num">{fmtDates(r)}</span> },
            { title: "Days", dataIndex: "totalDays", align: "right", render: (d: number) => <span className="ws-num">{d}</span> },
            { title: "Status", dataIndex: "status", render: (s: string) => <StatusChip status={s} /> },
            { title: "Reason", dataIndex: "reason", render: (val: string | null) => val ?? <span style={{ color: v.textSecondary }}>—</span> },
            { title: "Decision Comments", dataIndex: "decisionComments", render: (val: string | null) => val ?? <span style={{ color: v.textSecondary }}>—</span> },
            // Pinned right so the decision buttons never sit behind the horizontal scroll on a laptop.
            { title: "Actions", key: "actions", align: "right", fixed: "right", render: (_, r) => rowActions(r) },
          ]}
        />
      </Panel>

      <SideDrawer open={ledgerFor !== null} onClose={() => setLedgerFor(null)} title="Leave balance history" subtitle={ledgerFor ? `${ledgerFor.employeeName} (${ledgerFor.employeeCode})` : undefined} size="wide" footer={null}>
        {ledgerFor && <LeaveLedgerTable employeeId={ledgerFor.employeeId} />}
      </SideDrawer>

      <ConfirmModal
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onConfirm={() => rejectMutation.mutate()}
        title={`Reject ${rejecting?.employeeName}'s request`}
        description={rejecting ? `${rejecting.leaveTypeName} · ${fmtDates(rejecting)} · ${rejecting.totalDays} day(s)` : undefined}
        confirmLabel="Reject"
        danger
        loading={rejectMutation.isPending}
        confirmDisabled={rejectComments.trim().length === 0}
      >
        <label htmlFor="reject-comments" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>
          Comments are required for a rejection.
        </label>
        <Input.TextArea id="reject-comments" rows={3} value={rejectComments} onChange={(e) => setRejectComments(e.target.value)} placeholder="Why is this being rejected?" />
      </ConfirmModal>

      <ConfirmModal
        open={cancelling !== null}
        onCancel={() => setCancelling(null)}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
        title={`Cancel ${cancelling?.employeeName}'s leave?`}
        description={cancelling ? `${cancelling.leaveTypeName} · ${fmtDates(cancelling)} · ${cancelling.totalDays} day(s). The reason recorded is “Cancelled by HR”.` : undefined}
        confirmLabel="Cancel leave"
        cancelLabel="Keep it"
        danger
        loading={cancelMutation.isPending}
      />

      <OnBehalfDrawer open={onBehalfOpen} onClose={() => setOnBehalfOpen(false)} />
    </>
  );
}
