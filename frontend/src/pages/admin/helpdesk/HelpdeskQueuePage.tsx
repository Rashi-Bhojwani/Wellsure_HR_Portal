import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Flex, Select, Space, Table, Tag, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import { HELPDESK_STATUSES, type HelpdeskStatus } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../../api/helpdesk";
import type { HelpdeskTicketSummary } from "../../../api/helpdesk";
import { EmptyState } from "../../../components/common/EmptyState";
import { PriorityTag, StatusTag } from "../../../components/helpdesk/HelpdeskBits";
import { formatDateTime } from "../../../lib/dates";

const { Title, Text } = Typography;
const STATUS_LABEL: Record<HelpdeskStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_ON_EMPLOYEE: "Waiting on employee", RESOLVED: "Resolved", CLOSED: "Closed" };

// The HR queue (helpdesk.manage). Sensitive categories only appear for
// holders of helpdesk.sensitive.view — the server decides, this just shows.
// Refreshes live on helpdesk.queue (sockets/useHelpdeskRealtime.ts).
export function HelpdeskQueuePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<HelpdeskStatus | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [assignee, setAssignee] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const pageSize = 25;

  const { data: categories = [] } = useQuery({ queryKey: ["helpdesk", "categories", "all"], queryFn: helpdeskApi.listAllCategories });
  const { data, isLoading } = useQuery({
    queryKey: ["helpdesk", "queue", { status, categoryId, assignee, page }],
    queryFn: () => helpdeskApi.listQueue({ status, categoryId, assignee, page, pageSize }),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Helpdesk
      </Title>
      <Flex gap={8} wrap>
        <Select
          style={{ width: 200 }}
          allowClear
          placeholder="Active (not closed)"
          value={status}
          onChange={(v) => { setStatus(v); setPage(1); }}
          options={HELPDESK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
        />
        <Select
          style={{ width: 220 }}
          allowClear
          placeholder="All categories"
          value={categoryId}
          onChange={(v) => { setCategoryId(v); setPage(1); }}
          options={categories.map((c) => ({ value: c.id, label: c.name }))}
        />
        <Select
          style={{ width: 180 }}
          allowClear
          placeholder="Anyone"
          value={assignee}
          onChange={(v) => { setAssignee(v); setPage(1); }}
          options={[
            { value: "me", label: "Assigned to me" },
            { value: "unassigned", label: "Unassigned" },
          ]}
        />
      </Flex>
      <Table<HelpdeskTicketSummary>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        scroll={{ x: true }}
        pagination={{ current: page, pageSize, total: data?.total ?? 0, onChange: setPage, hideOnSinglePage: true }}
        onRow={(t) => ({ onClick: () => navigate(`/admin/employee/helpdesk/${t.id}`), style: { cursor: "pointer" } })}
        locale={{ emptyText: <EmptyState message="No tickets match these filters." /> }}
        columns={[
          { title: "Ticket", dataIndex: "number", width: 110 },
          { title: "Subject", dataIndex: "subject", render: (v: string) => <Text strong>{v}</Text> },
          { title: "Employee", key: "raisedBy", render: (_: unknown, t) => `${t.raisedBy.name} (${t.raisedBy.employeeCode})` },
          {
            title: "Category",
            key: "category",
            render: (_: unknown, t) => (
              <Space size={4}>
                {t.category.name}
                {t.category.isSensitive && <Tag icon={<LockOutlined />}>Sensitive</Tag>}
              </Space>
            ),
          },
          { title: "Priority", dataIndex: "priority", render: (_: unknown, t) => <PriorityTag priority={t.priority} /> },
          { title: "Status", dataIndex: "status", render: (_: unknown, t) => <StatusTag status={t.status} viewer="hr" /> },
          { title: "Assignee", key: "assignee", render: (_: unknown, t) => t.assignee?.name ?? <Text type="secondary">Unassigned</Text> },
          { title: "Last update", dataIndex: "lastActivityAt", render: (v: string) => formatDateTime(v) },
        ]}
      />
    </Space>
  );
}
