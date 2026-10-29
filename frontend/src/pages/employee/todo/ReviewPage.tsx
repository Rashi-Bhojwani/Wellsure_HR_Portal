import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Space, Tabs, Typography } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { CheckOutlined, CloseOutlined } from '@ant-design/icons';
import { apiErrorMessage as errorMessage } from '../../../lib/apiError';
import * as leaveApi from '../../../api/leave';
import type { LeaveRequestRow } from '../../../api/leave';
import {
  ApprovalBanner,
  ConfirmModal,
  DataTable,
  EmptyState,
  InitialsAvatar,
  PageHeader,
  Panel,
  Stack,
  StatusChip,
  toast,
} from '../../../ui';
import { fs, fw, space, v } from '../../../theme/tokens';
import { useAuth } from '../../../hooks/useAuth';
import { RegularizationQueue } from '../../../components/attendance/RegularizationQueue';

const { Text } = Typography;

// One employee's balance for one leave type — fetched per row (react-query
// dedupes/caches by employeeId, so an employee with several pending
// requests only costs one balances call, not one per row).
function BalanceCell({ employeeId, leaveTypeId }: { employeeId: string; leaveTypeId: string }) {
  const { data } = useQuery({
    queryKey: ['leave', 'balances', employeeId],
    queryFn: () => leaveApi.getLeaveBalances(employeeId),
  });
  const balance = data?.find((b) => b.leaveTypeId === leaveTypeId)?.balance;
  return <>{balance ?? '—'}</>;
}

function LeaveReview() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('leave.approve');
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [rejectComments, setRejectComments] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['leave', 'requests', 'review-queue'],
    queryFn: () => leaveApi.listLeaveRequests({ status: 'PENDING', pageSize: 100 }),
    enabled: canApprove,
  });
  const rows = data?.rows ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ['leave', 'requests'] });
    void queryClient.invalidateQueries({ queryKey: ['leave', 'balances'] });
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => leaveApi.approveLeaveRequest(id),
    onSuccess: () => {
      toast.success('Approved.');
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not approve this request.')),
  });

  const rejectMutation = useMutation({
    mutationFn: () => leaveApi.rejectLeaveRequest(rejecting!.id, rejectComments),
    onSuccess: () => {
      toast.success('Rejected.');
      setRejecting(null);
      setRejectComments('');
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not reject this request.')),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => leaveApi.bulkApproveLeaveRequests(selectedIds),
    onSuccess: (r) => {
      const approved = r.results.filter((x) => x.status === 'approved').length;
      const failed = r.results.filter((x) => x.status === 'failed').length;
      if (failed === 0) toast.success(`Approved ${approved} request(s).`);
      else toast.warning(`Approved ${approved}, failed ${failed} — see details in the list.`);
      setSelectedIds([]);
      invalidate();
    },
    onError: (err) => toast.error(errorMessage(err, 'Could not bulk-approve.')),
  });

  if (!canApprove) return null;

  const approvingId = approveMutation.isPending ? approveMutation.variables : undefined;
  const dates = (r: LeaveRequestRow) =>
    r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`;
  const actions = (r: LeaveRequestRow, block = false) => (
    <>
      <Button
        type="primary"
        icon={<CheckOutlined />}
        loading={approvingId === r.id}
        disabled={approvingId !== undefined && approvingId !== r.id}
        onClick={() => approveMutation.mutate(r.id)}
        style={block ? { flex: 1 } : undefined}
      >
        Approve
      </Button>
      <Button
        danger
        icon={<CloseOutlined />}
        disabled={approvingId === r.id}
        onClick={() => setRejecting(r)}
        style={block ? { flex: 1 } : undefined}
      >
        Reject
      </Button>
    </>
  );

  return (
    <Panel
      title="Leave requests"
      subtitle="Pending leave requests from your team — and from the team of any manager whose approvals you're covering (Workflow Delegates)."
    >
      <Stack gap={space[4]}>
        {selectedIds.length > 0 && (
          <ApprovalBanner
            tone="info"
            title={`${selectedIds.length} selected`}
            actions={
              <Button
                type="primary"
                loading={bulkApproveMutation.isPending}
                onClick={() => bulkApproveMutation.mutate()}
              >
                Bulk Approve
              </Button>
            }
          />
        )}

        <DataTable<LeaveRequestRow>
          rowKey="id"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={rows}
          pagination={false}
          empty={
            <EmptyState
              illustration="success"
              title="You're all caught up"
              description="No pending requests from your team"
            />
          }
          rowSelection={{
            selectedRowKeys: selectedIds,
            onChange: (keys) => setSelectedIds(keys as string[]),
          }}
          columns={[
            {
              title: 'Employee',
              key: 'employee',
              render: (_, r) => (
                <span
                  style={{ display: 'flex', alignItems: 'center', gap: space[3], minWidth: 200 }}
                >
                  <InitialsAvatar name={r.employeeName} size={36} />
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{ display: 'block', fontWeight: fw.semibold, color: v.textPrimary }}
                    >
                      {r.employeeName}
                    </span>
                    <span style={{ display: 'block', fontSize: fs.sm, color: v.textSecondary }}>
                      {r.employeeCode}
                    </span>
                    {r.onBehalfOf && (
                      <span style={{ display: 'inline-block', marginTop: space[1] }}>
                        <StatusChip tone="purple">On behalf of {r.onBehalfOf.name}</StatusChip>
                      </span>
                    )}
                  </span>
                </span>
              ),
            },
            { title: 'Type', dataIndex: 'leaveTypeName' },
            {
              title: 'Dates',
              key: 'dates',
              render: (_, r) => <span className="ws-num">{dates(r)}</span>,
            },
            {
              title: 'Days',
              dataIndex: 'totalDays',
              render: (d: number) => <span className="ws-num">{d}</span>,
            },
            {
              title: 'Balance',
              key: 'balance',
              render: (_, r) => (
                <BalanceCell employeeId={r.employeeId} leaveTypeId={r.leaveTypeId} />
              ),
            },
            {
              title: 'Reason',
              dataIndex: 'reason',
              render: (x: string | null) => x ?? <Text type="secondary">—</Text>,
            },
            {
              title: 'Status',
              dataIndex: 'status',
              render: (s: string) => <StatusChip status={s} />,
            },
            // Pinned right: on a laptop with the sidebar open the row is wider than the panel, and the decision buttons must not hide behind a scroll.
            { title: 'Actions', key: 'actions', fixed: 'right', render: (_, r) => <Space>{actions(r)}</Space> },
          ]}
          mobile={{
            avatar: (r) => <InitialsAvatar name={r.employeeName} size={36} />,
            title: (r) => r.employeeName,
            subtitle: (r) =>
              r.onBehalfOf
                ? `${r.employeeCode} · on behalf of ${r.onBehalfOf.name}`
                : r.employeeCode,
            status: (r) => <StatusChip status={r.status} />,
            fields: [
              { label: 'Type', render: (r) => r.leaveTypeName },
              { label: 'Dates', render: (r) => dates(r) },
              { label: 'Days', render: (r) => r.totalDays },
              {
                label: 'Balance',
                render: (r) => (
                  <BalanceCell employeeId={r.employeeId} leaveTypeId={r.leaveTypeId} />
                ),
              },
              { label: 'Reason', render: (r) => r.reason ?? '—' },
            ],
            actions: (r) => actions(r, true),
          }}
        />
      </Stack>

      <ConfirmModal
        title={`Reject ${rejecting?.employeeName}'s request`}
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onConfirm={() => rejectMutation.mutate()}
        loading={rejectMutation.isPending}
        confirmDisabled={rejectComments.trim().length === 0}
        danger
        confirmLabel="Reject"
        info="Comments are required for a rejection."
      >
        <Input.TextArea
          rows={3}
          aria-label="Reason for rejection"
          value={rejectComments}
          onChange={(e) => setRejectComments(e.target.value)}
          placeholder="Why is this being rejected?"
        />
      </ConfirmModal>
    </Panel>
  );
}

// To do → Review: leave (leave.approve) and, from P2-E, forgot-to-punch
// requests (attendance.regularization.view/approve — a manager's team, by grant).
export function ReviewPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const leave = hasPermission('leave.approve');
  const attendance =
    hasPermission('attendance.regularization.view') ||
    hasPermission('attendance.regularization.approve');
  const tabs = [
    ...(leave ? [{ key: 'leave', label: 'Leave', children: <LeaveReview /> }] : []),
    ...(attendance
      ? [
          {
            key: 'attendance',
            label: 'Attendance corrections',
            children: (
              <Panel title="Attendance correction requests">
                <RegularizationQueue emptyText="No correction requests from your team" />
              </Panel>
            ),
          },
        ]
      : []),
  ];
  const active = tabs.some((t) => t.key === params.get('tab')) ? params.get('tab')! : tabs[0]?.key;
  return (
    <div>
      <PageHeader title="Review" subtitle="Requests from your team waiting for your decision" />
      {tabs.length === 0 ? (
        <Panel>
          <EmptyState
            illustration="success"
            title="Nothing to review"
            description="Requests that need your approval will appear here."
          />
        </Panel>
      ) : (
        <Tabs activeKey={active} onChange={(k) => setParams({ tab: k })} items={tabs} />
      )}
    </div>
  );
}
