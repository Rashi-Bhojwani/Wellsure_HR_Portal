import { useQuery } from '@tanstack/react-query';
import * as adminHomeApi from '../../../api/adminHome';
import { TasksInbox } from '../../../components/inbox/TasksInbox';
import { ApprovalBanner, PageHeader } from '../../../ui';

export function AdminTasksPage() {
  const { data: counts } = useQuery({ queryKey: ['admin', 'tasks', 'counts'], queryFn: adminHomeApi.getTaskCounts });
  const held = counts?.heldFromHr ?? null;
  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything waiting on you, from every module" />
      {held && (
        <ApprovalBanner
          tone="info"
          title="Some of what is below is here because HR has been switched off from deciding it"
          description={`${held.leave} leave and ${held.regularizations} attendance correction requests. Nothing was approved or lost. If you switch the duty back on (Admin Tools, What HR Can Do), they go back to HR.`}
        />
      )}
      <TasksInbox portal="admin" />
    </div>
  );
}
