import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Flex, Segmented, Select, Table, Tag, Typography } from "antd";
import { REQUEST_HUB_TYPES, REQUEST_HUB_TYPE_LABELS, type RequestHubItem, type RequestHubState, type RequestHubType } from "@shared/types/inbox";
import * as inboxApi from "../../../api/inbox";
import { EmptyState } from "../../../components/common/EmptyState";
import { formatDate, formatDateTime } from "../../../lib/dates";

const { Text } = Typography;
const STATE_COLORS: Record<string, string> = { OPEN: "gold", CLOSED: "default" };
const STATUS_COLORS: Record<string, string> = { PENDING: "gold", APPROVED: "green", REJECTED: "red", CANCELLED: "default", RESOLVED: "green", WAITING_ON_EMPLOYEE: "gold" };

// Request Hub (spec §6): everything I've asked for, from every module, in
// one list. Read-only — each row opens the module where it's handled.
export function RequestHubPage() {
  const navigate = useNavigate();
  const [state, setState] = useState<RequestHubState | "ALL">("OPEN");
  const [type, setType] = useState<RequestHubType | undefined>();
  const { data = [], isLoading } = useQuery({
    queryKey: ["request-hub", { state, type }],
    queryFn: () => inboxApi.listMyRequests({ state: state === "ALL" ? undefined : state, type, limit: 200 }),
  });

  return (
    <Card>
      <Flex gap={12} wrap style={{ marginBottom: 16 }}>
        <Segmented<RequestHubState | "ALL">
          value={state}
          onChange={setState}
          options={[
            { value: "OPEN", label: "In progress" },
            { value: "CLOSED", label: "Completed" },
            { value: "ALL", label: "All" },
          ]}
        />
        <Select
          allowClear
          style={{ width: 200 }}
          placeholder="All request types"
          value={type}
          onChange={setType}
          options={REQUEST_HUB_TYPES.map((t) => ({ value: t, label: REQUEST_HUB_TYPE_LABELS[t] }))}
        />
      </Flex>
      <Table<RequestHubItem>
        rowKey={(r) => `${r.type}:${r.id}`}
        loading={isLoading}
        dataSource={data}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        scroll={{ x: true }}
        onRow={(r) => ({ onClick: () => navigate(r.link), style: { cursor: "pointer" } })}
        locale={{ emptyText: <EmptyState message={state === "OPEN" ? "Nothing in progress." : "No requests yet."} /> }}
        columns={[
          { title: "Type", dataIndex: "type", width: 140, render: (v: RequestHubType) => <Tag>{REQUEST_HUB_TYPE_LABELS[v]}</Tag> },
          {
            title: "Request",
            dataIndex: "title",
            render: (_: string, r) => (
              <Flex vertical>
                <Text strong>{r.title}</Text>
                {r.detail && <Text type="secondary" style={{ fontSize: 12 }}>{r.detail}</Text>}
                {r.autoClosesAt && <Text type="secondary" style={{ fontSize: 12 }}>Closes automatically on {formatDate(r.autoClosesAt)} unless you reply</Text>}
              </Flex>
            ),
          },
          { title: "Status", dataIndex: "statusLabel", render: (v: string, r) => <Tag color={STATUS_COLORS[r.status] ?? STATE_COLORS[r.state]}>{v}</Tag> },
          { title: "Submitted", dataIndex: "submittedAt", render: (v: string) => formatDate(v) },
          { title: "Last update", dataIndex: "updatedAt", render: (v: string) => formatDateTime(v) },
        ]}
      />
    </Card>
  );
}
