import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Select, Space, Table, Tag, Typography, message } from "antd";
import type { AxiosError } from "axios";
import * as employeeApi from "../../../api/employee";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title } = Typography;

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
  return axiosErr.response?.data?.error?.message ?? fallback;
}

const STATUS_COLORS: Record<string, string> = { PENDING: "gold", APPROVED: "green", REJECTED: "red" };

export function ChangeRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<string | undefined>("PENDING");
  const [decision, setDecision] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");

  const { data: requests = [], isLoading } = useQuery({
    queryKey: ["employees", "change-requests", statusFilter],
    queryFn: () => employeeApi.listChangeRequests(statusFilter),
  });

  const decideMutation = useMutation({
    mutationFn: () =>
      decision!.action === "approve" ? employeeApi.approveChangeRequest(decision!.id, remarks) : employeeApi.rejectChangeRequest(decision!.id, remarks),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "change-requests"] });
      setDecision(null);
      setRemarks("");
      void message.success(decision?.action === "approve" ? "Change approved and applied." : "Change rejected.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not record decision.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>Profile Change Requests</Title>
      <Select
        style={{ width: 200 }}
        value={statusFilter}
        onChange={setStatusFilter}
        options={[
          { value: "PENDING", label: "Pending" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: undefined, label: "All" },
        ]}
      />
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={requests}
        locale={{ emptyText: <EmptyState message="No change requests." /> }}
        columns={[
          { title: "Employee", dataIndex: "employeeName", render: (v: string, r: employeeApi.ChangeRequestSummary) => <a onClick={() => navigate(`/admin/employee/profile/${r.employeeId}`)}>{v} ({r.employeeCode})</a> },
          { title: "Field Group", dataIndex: "fieldGroup", render: (v: string) => <Tag>{v}</Tag> },
          { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={STATUS_COLORS[v]}>{v}</Tag> },
          { title: "Submitted", dataIndex: "createdAt", render: (v: string) => new Date(v).toLocaleString() },
          { title: "Remarks", dataIndex: "remarks", render: (v: string | null) => v ?? "—" },
          {
            title: "Actions",
            key: "actions",
            render: (_: unknown, r: employeeApi.ChangeRequestSummary) =>
              r.status === "PENDING" ? (
                <Space>
                  <Button size="small" type="primary" onClick={() => setDecision({ id: r.id, action: "approve" })}>Approve</Button>
                  <Button size="small" danger onClick={() => setDecision({ id: r.id, action: "reject" })}>Reject</Button>
                </Space>
              ) : null,
          },
        ]}
      />
      <Modal
        title={decision?.action === "approve" ? "Approve change request" : "Reject change request"}
        open={decision !== null}
        onCancel={() => setDecision(null)}
        onOk={() => decideMutation.mutate()}
        confirmLoading={decideMutation.isPending}
        destroyOnHidden
      >
        <Input.TextArea placeholder="Remarks (optional)" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </Modal>
    </Space>
  );
}
