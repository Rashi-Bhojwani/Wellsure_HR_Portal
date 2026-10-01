import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Card, Flex, Table, Tag, Typography } from "antd";
import { TASK_TYPE_LABELS, type TaskItem, type TaskType } from "@shared/types/inbox";
import * as inboxApi from "../../api/inbox";
import { EmptyState } from "../common/EmptyState";
import { formatDateTime } from "../../lib/dates";

const { Text } = Typography;
const TYPE_COLORS: Record<TaskType, string> = { LEAVE_APPROVAL: "blue", PROFILE_CHANGE_APPROVAL: "purple", HELPDESK_ASSIGNED: "cyan" };

// To do → Tasks and the admin Tasks app (user decision 1): an inbox of
// things waiting on me, oldest first. Each row opens the screen where the
// item is actually acted on — the inbox itself never approves anything.
// Refreshes live on tasks.counts, helpdesk.* and notification.new.
export function TasksInbox({ portal }: { portal: "employee" | "admin" }) {
  const navigate = useNavigate();
  const { data = [], isLoading } = useQuery({ queryKey: ["tasks", "mine"], queryFn: inboxApi.listMyTasks });

  return (
    <Card>
      <Table<TaskItem>
        rowKey={(t) => `${t.type}:${t.id}`}
        loading={isLoading}
        dataSource={data}
        pagination={{ pageSize: 25, hideOnSinglePage: true }}
        scroll={{ x: true }}
        onRow={(t) => ({ onClick: () => navigate(portal === "admin" ? t.adminLink : t.link), style: { cursor: "pointer" } })}
        locale={{ emptyText: <EmptyState message="Nothing is waiting on you." /> }}
        columns={[
          { title: "Type", dataIndex: "type", width: 190, render: (v: TaskType) => <Tag color={TYPE_COLORS[v]}>{TASK_TYPE_LABELS[v]}</Tag> },
          {
            title: "Item",
            dataIndex: "title",
            render: (_: string, t) => (
              <Flex vertical>
                <Text strong>{t.title}</Text>
                {t.detail && <Text type="secondary" style={{ fontSize: 12 }}>{t.detail}</Text>}
              </Flex>
            ),
          },
          { title: "Employee", dataIndex: "employeeName", render: (v: string | null) => v ?? "—" },
          { title: "Waiting since", dataIndex: "waitingSince", render: (v: string) => formatDateTime(v) },
        ]}
      />
    </Card>
  );
}
