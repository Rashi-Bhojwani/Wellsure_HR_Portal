import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Input, Modal, Space, Table, Tag, Typography, message } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { LeaveRequestRow } from "../../../api/leave";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAuth } from "../../../hooks/useAuth";

const { Title, Text } = Typography;

// One employee's balance for one leave type — fetched per row (react-query
// dedupes/caches by employeeId, so an employee with several pending
// requests only costs one balances call, not one per row).
function BalanceCell({ employeeId, leaveTypeId }: { employeeId: string; leaveTypeId: string }) {
  const { data } = useQuery({ queryKey: ["leave", "balances", employeeId], queryFn: () => leaveApi.getLeaveBalances(employeeId) });
  const balance = data?.find((b) => b.leaveTypeId === leaveTypeId)?.balance;
  return <>{balance ?? "—"}</>;
}

export function ReviewPage() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("leave.approve");
  const queryClient = useQueryClient();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [rejectComments, setRejectComments] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["leave", "requests", "review-queue"],
    queryFn: () => leaveApi.listLeaveRequests({ status: "PENDING", pageSize: 100 }),
    enabled: canApprove,
  });
  const rows = data?.rows ?? [];

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["leave", "requests"] });
    void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
  }

  const approveMutation = useMutation({
    mutationFn: (id: string) => leaveApi.approveLeaveRequest(id),
    onSuccess: () => {
      void message.success("Approved.");
      invalidate();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not approve this request.")),
  });

  const rejectMutation = useMutation({
    mutationFn: () => leaveApi.rejectLeaveRequest(rejecting!.id, rejectComments),
    onSuccess: () => {
      void message.success("Rejected.");
      setRejecting(null);
      setRejectComments("");
      invalidate();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not reject this request.")),
  });

  const bulkApproveMutation = useMutation({
    mutationFn: () => leaveApi.bulkApproveLeaveRequests(selectedIds),
    onSuccess: (r) => {
      const approved = r.results.filter((x) => x.status === "approved").length;
      const failed = r.results.filter((x) => x.status === "failed").length;
      if (failed === 0) void message.success(`Approved ${approved} request(s).`);
      else void message.warning(`Approved ${approved}, failed ${failed} — see details in the list.`);
      setSelectedIds([]);
      invalidate();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not bulk-approve.")),
  });

  if (!canApprove) {
    return (
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Title level={3} style={{ margin: 0 }}>
          Review
        </Title>
        <EmptyState message="Nothing to review" />
      </Space>
    );
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Review
      </Title>
      <Text type="secondary">Pending leave requests from your team — and from the team of any manager whose approvals you're covering (Workflow Delegates).</Text>

      {selectedIds.length > 0 && (
        <Alert
          type="info"
          showIcon
          message={`${selectedIds.length} selected`}
          action={
            <Button size="small" type="primary" loading={bulkApproveMutation.isPending} onClick={() => bulkApproveMutation.mutate()}>
              Bulk Approve
            </Button>
          }
        />
      )}

      <Table<LeaveRequestRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: <EmptyState message="No pending requests from your team" compact /> }}
        rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as string[]) }}
        columns={[
          {
            title: "Employee",
            key: "employee",
            render: (_, r) => (
              <Space size={6} wrap>
                <span>{`${r.employeeName} (${r.employeeCode})`}</span>
                {r.onBehalfOf && <Tag color="purple">On behalf of {r.onBehalfOf.name}</Tag>}
              </Space>
            ),
          },
          { title: "Type", dataIndex: "leaveTypeName" },
          {
            title: "Dates",
            key: "dates",
            render: (_, r) => (r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`),
          },
          { title: "Days", dataIndex: "totalDays" },
          { title: "Balance", key: "balance", render: (_, r) => <BalanceCell employeeId={r.employeeId} leaveTypeId={r.leaveTypeId} /> },
          { title: "Reason", dataIndex: "reason", render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) => (
              <Space>
                <Button size="small" type="primary" icon={<CheckOutlined />} loading={approveMutation.isPending} onClick={() => approveMutation.mutate(r.id)}>
                  Approve
                </Button>
                <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejecting(r)}>
                  Reject
                </Button>
              </Space>
            ),
          },
        ]}
      />

      <Modal
        title={`Reject ${rejecting?.employeeName}'s request`}
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onOk={() => rejectMutation.mutate()}
        confirmLoading={rejectMutation.isPending}
        okButtonProps={{ disabled: rejectComments.trim().length === 0, danger: true }}
        okText="Reject"
        destroyOnHidden
      >
        <Text>Comments are required for a rejection.</Text>
        <Input.TextArea
          rows={3}
          style={{ marginTop: 8 }}
          value={rejectComments}
          onChange={(e) => setRejectComments(e.target.value)}
          placeholder="Why is this being rejected?"
        />
      </Modal>
    </Space>
  );
}
