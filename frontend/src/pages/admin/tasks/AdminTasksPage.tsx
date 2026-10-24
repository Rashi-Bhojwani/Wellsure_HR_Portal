import { TasksInbox } from "../../../components/inbox/TasksInbox";
import { PageHeader } from "../../../ui";

export function AdminTasksPage() {
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything waiting on you, from every module" />
      <TasksInbox portal="admin" />
    </div>
  );
}
