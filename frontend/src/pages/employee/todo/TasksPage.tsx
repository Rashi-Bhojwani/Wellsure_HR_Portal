import { TasksInbox } from '../../../components/inbox/TasksInbox';
import { PageHeader } from '../../../ui';

export function TasksPage() {
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Things waiting on you, oldest first" />
      <TasksInbox portal="employee" />
    </div>
  );
}
