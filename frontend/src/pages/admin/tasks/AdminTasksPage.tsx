import { Space, Typography } from "antd";
import { TasksInbox } from "../../../components/inbox/TasksInbox";

export function AdminTasksPage() {
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Typography.Title level={3} style={{ margin: 0 }}>
        Tasks
      </Typography.Title>
      <TasksInbox portal="admin" />
    </Space>
  );
}
