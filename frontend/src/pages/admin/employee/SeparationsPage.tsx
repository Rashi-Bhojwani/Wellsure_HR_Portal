import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import type { AxiosError } from "axios";
import * as employeeApi from "../../../api/employee";
import { EmptyState } from "../../../components/common/EmptyState";

const { Title } = Typography;

function errorMessage(err: unknown, fallback: string): string {
  const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
  return axiosErr.response?.data?.error?.message ?? fallback;
}

const STATUS_COLORS: Record<string, string> = { INITIATED: "gold", COMPLETED: "default", CANCELLED: "red" };

export function SeparationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: separations = [], isLoading } = useQuery({ queryKey: ["employees", "separations"], queryFn: employeeApi.listSeparations });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => employeeApi.cancelSeparation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "separations"] });
      void message.success("Separation cancelled.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not cancel separation.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>Separations</Title>
      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={separations}
        locale={{ emptyText: <EmptyState message="No separations on record." /> }}
        columns={[
          { title: "Employee", dataIndex: "employeeName", render: (v: string, r: employeeApi.SeparationSummary) => <a onClick={() => navigate(`/admin/employee/profile/${r.employeeId}`)}>{v} ({r.employeeCode})</a> },
          { title: "Last Working Date", dataIndex: "lastWorkingDate" },
          { title: "Reason", dataIndex: "reason" },
          { title: "Status", dataIndex: "status", render: (v: string) => <Tag color={STATUS_COLORS[v]}>{v}</Tag> },
          { title: "Initiated", dataIndex: "initiatedAt", render: (v: string) => new Date(v).toLocaleDateString() },
          {
            title: "Actions",
            key: "actions",
            render: (_: unknown, r: employeeApi.SeparationSummary) =>
              r.status === "INITIATED" ? (
                <Popconfirm title="Cancel this separation?" onConfirm={() => cancelMutation.mutate(r.id)}>
                  <Button size="small" danger>Cancel</Button>
                </Popconfirm>
              ) : null,
          },
        ]}
      />
    </Space>
  );
}
