import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, DatePicker, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import type { Dayjs } from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as adminHomeApi from "../../../api/adminHome";
import * as leaveApi from "../../../api/leave";
import type { LeaveRequestRow, LeaveRequestStatus } from "../../../api/leave";
import * as employeeApi from "../../../api/employee";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAuth } from "../../../hooks/useAuth";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const STATUS_COLORS: Record<string, string> = { PENDING: "gold", APPROVED: "green", REJECTED: "red", CANCELLED: "default" };
const STATUS_OPTIONS = ["PENDING", "APPROVED", "REJECTED", "CANCELLED"].map((s) => ({ value: s, label: s }));
const DAY_PART_OPTIONS = [
  { value: "FULL", label: "Full Day" },
  { value: "FIRST_HALF", label: "First Half" },
  { value: "SECOND_HALF", label: "Second Half" },
];

interface OnBehalfFormValues {
  employeeId: string;
  leaveTypeId: string;
  dateRange: [Dayjs, Dayjs];
  fromDayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  toDayPart: "FULL" | "FIRST_HALF" | "SECOND_HALF";
  reason?: string;
}

function OnBehalfModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<OnBehalfFormValues>();
  const queryClient = useQueryClient();
  const { data: employees } = useQuery({ queryKey: ["employees", "picker"], queryFn: () => employeeApi.listEmployees({ pageSize: 200, sortBy: "fullName", sortDir: "asc" }) });
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes });

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
      void message.success(`Applied for ${result.totalDays} day(s) on their behalf — pending approval.`);
      form.resetFields();
      onClose();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not submit this request.")),
  });

  return (
    <Modal title="Apply for Leave on Behalf" open={open} onCancel={onClose} footer={null} destroyOnHidden width={520}>
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => applyMutation.mutate(v)}>
        <Form.Item name="employeeId" label="Employee" rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp="label"
            options={(employees?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
            placeholder="Select an employee"
          />
        </Form.Item>
        <Form.Item name="leaveTypeId" label="Leave Type" rules={[{ required: true }]}>
          <Select options={leaveTypes.map((t) => ({ value: t.id, label: t.name }))} placeholder="Select a leave type" />
        </Form.Item>
        <Form.Item name="dateRange" label="Dates" rules={[{ required: true }]}>
          <RangePicker style={{ width: "100%" }} />
        </Form.Item>
        <Space size={16} style={{ width: "100%" }}>
          <Form.Item name="fromDayPart" label="First Day" initialValue="FULL" style={{ flex: 1 }}>
            <Select options={DAY_PART_OPTIONS} />
          </Form.Item>
          <Form.Item name="toDayPart" label="Last Day" initialValue="FULL" style={{ flex: 1 }}>
            <Select options={DAY_PART_OPTIONS} />
          </Form.Item>
        </Space>
        <Form.Item name="reason" label="Reason">
          <Input.TextArea rows={2} placeholder="Optional" />
        </Form.Item>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={applyMutation.isPending}>
            Submit
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function EmployeeLeavePage() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("leave.approve");
  const canApplyOnBehalf = hasPermission("leave.apply.onBehalf");
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LeaveRequestStatus | undefined>(undefined);
  const [onBehalfOpen, setOnBehalfOpen] = useState(false);
  const [rejecting, setRejecting] = useState<LeaveRequestRow | null>(null);
  const [rejectComments, setRejectComments] = useState("");

  // Requests nobody on the team side can decide (no manager with leave
  // approval, no delegate, or no manager at all) — HR's to decide. Linked
  // from the notification and Admin Home as ?noTeamApprover=1.
  const [params, setParams] = useSearchParams();
  const onlyNoTeamApprover = params.get("noTeamApprover") === "1";
  const setOnlyNoTeamApprover = (on: boolean) => setParams(on ? { noTeamApprover: "1" } : {}, { replace: true });
  const { data: taskCounts } = useQuery({ queryKey: ["admin", "tasks", "counts"], queryFn: adminHomeApi.getTaskCounts });
  const noTeamApproverCount = taskCounts?.leaveNoTeamApprover ?? 0;

  const { data, isLoading } = useQuery({
    queryKey: ["leave", "requests", "admin", status, onlyNoTeamApprover],
    queryFn: () => leaveApi.listLeaveRequests({ status, noTeamApprover: onlyNoTeamApprover || undefined, pageSize: 100 }),
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
  const cancelMutation = useMutation({
    mutationFn: (id: string) => leaveApi.cancelLeaveRequest(id, "Cancelled by HR"),
    onSuccess: () => {
      void message.success("Cancelled.");
      invalidate();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not cancel this request.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Title level={3} style={{ margin: 0 }}>
          Employee Leave
        </Title>
        {canApplyOnBehalf && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setOnBehalfOpen(true)}>
            Apply on Behalf
          </Button>
        )}
      </Space>

      {(noTeamApproverCount > 0 || onlyNoTeamApprover) && (
        <Alert
          type={noTeamApproverCount > 0 ? "warning" : "success"}
          showIcon
          title={
            noTeamApproverCount > 0
              ? `${noTeamApproverCount} pending ${noTeamApproverCount === 1 ? "request has" : "requests have"} no manager who can approve ${noTeamApproverCount === 1 ? "it" : "them"}`
              : "Every pending request has a manager or delegate who can approve it"
          }
          description={noTeamApproverCount > 0 ? "Their manager hasn't been given leave approval (and nobody is covering), or they have no reporting manager — so these wait on HR." : undefined}
          action={
            <Button size="small" onClick={() => setOnlyNoTeamApprover(!onlyNoTeamApprover)}>
              {onlyNoTeamApprover ? "Show all requests" : "Show only these"}
            </Button>
          }
        />
      )}

      <Select
        allowClear
        placeholder="Filter by status"
        style={{ width: 200 }}
        options={STATUS_OPTIONS}
        value={status}
        onChange={(v) => setStatus(v as LeaveRequestStatus | undefined)}
      />

      <Table<LeaveRequestRow>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 20 }}
        scroll={{ x: "max-content" }}
        locale={{ emptyText: <EmptyState message="No leave requests found" compact /> }}
        columns={[
          {
            title: "Employee",
            key: "employee",
            render: (_, r) => (
              <Space size={6} wrap>
                {`${r.employeeName} (${r.employeeCode})`}
                {r.noTeamApprover && (
                  <Tooltip title={r.noTeamApprover === "NO_MANAGER" ? "No reporting manager — HR decides." : "Their manager hasn't been given leave approval and nobody is covering — HR decides."}>
                    <Tag color="orange">No manager can approve</Tag>
                  </Tooltip>
                )}
              </Space>
            ),
          },
          { title: "Type", dataIndex: "leaveTypeName" },
          { title: "Dates", key: "dates", render: (_, r) => (r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`) },
          { title: "Days", dataIndex: "totalDays" },
          { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={STATUS_COLORS[v]}>{v}</Tag> },
          { title: "Reason", dataIndex: "reason", render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
          { title: "Decision Comments", dataIndex: "decisionComments", render: (v: string | null) => v ?? <Text type="secondary">—</Text> },
          {
            title: "Actions",
            key: "actions",
            render: (_, r) =>
              canApprove ? (
                <Space>
                  {r.status === "PENDING" && (
                    <>
                      <Button size="small" type="primary" loading={approveMutation.isPending} onClick={() => approveMutation.mutate(r.id)}>
                        Approve
                      </Button>
                      <Button size="small" danger onClick={() => setRejecting(r)}>
                        Reject
                      </Button>
                    </>
                  )}
                  {(r.status === "PENDING" || r.status === "APPROVED") && (
                    <Button size="small" onClick={() => cancelMutation.mutate(r.id)}>
                      Cancel
                    </Button>
                  )}
                </Space>
              ) : null,
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
        <Input.TextArea rows={3} style={{ marginTop: 8 }} value={rejectComments} onChange={(e) => setRejectComments(e.target.value)} placeholder="Why is this being rejected?" />
      </Modal>

      <OnBehalfModal open={onBehalfOpen} onClose={() => setOnBehalfOpen(false)} />
    </Space>
  );
}
