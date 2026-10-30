import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  CalendarOutlined,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  SafetyCertificateOutlined,
  UserSwitchOutlined,
} from '@ant-design/icons';
import { TASK_TYPE_LABELS, type TaskItem, type TaskType } from '@shared/types/inbox';
import * as inboxApi from '../../api/inbox';
import { formatDateTime } from '../../lib/dates';
import { fs, fw, radius, space, v } from '../../theme/tokens';
import { DataTable, EmptyState, InitialsAvatar, Panel, StatusChip, type ChipTone } from '../../ui';

const TYPE_META: Record<TaskType, { icon: ReactNode; tone: ChipTone; bg: string; fg: string }> = {
  LEAVE_APPROVAL: {
    icon: <CalendarOutlined />,
    tone: 'info',
    bg: v.chipInfoBg,
    fg: v.chipInfoText,
  },
  PROFILE_CHANGE_APPROVAL: {
    icon: <UserSwitchOutlined />,
    tone: 'purple',
    bg: v.chipPurpleBg,
    fg: v.chipPurpleText,
  },
  HELPDESK_ASSIGNED: {
    icon: <CustomerServiceOutlined />,
    tone: 'success',
    bg: v.chipSuccessBg,
    fg: v.chipSuccessText,
  },
  REGULARIZATION_APPROVAL: {
    icon: <ClockCircleOutlined />,
    tone: 'warning',
    bg: v.chipWarningBg,
    fg: v.chipWarningText,
  },
  DIRECTOR_NOTICE: {
    icon: <SafetyCertificateOutlined />,
    tone: 'danger',
    bg: v.chipDangerBg,
    fg: v.chipDangerText,
  },
};

function TypeIcon({ type }: { type: TaskType }) {
  const m = TYPE_META[type];
  return (
    <span
      aria-hidden
      style={{
        width: 36,
        height: 36,
        flex: 'none',
        borderRadius: radius.md,
        background: m.bg,
        color: m.fg,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: fs.lg,
      }}
    >
      {m.icon}
    </span>
  );
}

function Requester({ name }: { name: string | null }) {
  if (!name) return <span style={{ color: v.textSecondary }}>—</span>;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}>
      <InitialsAvatar name={name} size={28} />
      {name}
    </span>
  );
}

// To do → Tasks and the admin Tasks app (user decision 1): an inbox of
// things waiting on me, oldest first. Each row opens the screen where the
// item is actually acted on — the inbox itself never approves anything.
// Refreshes live on tasks.counts, helpdesk.* and notification.new.
export function TasksInbox({ portal }: { portal: 'employee' | 'admin' }) {
  const navigate = useNavigate();
  const {
    data = [],
    isLoading,
    error,
    refetch,
  } = useQuery({ queryKey: ['tasks', 'mine'], queryFn: inboxApi.listMyTasks });
  const open = (t: TaskItem) => navigate(portal === 'admin' ? t.adminLink : t.link);

  return (
    <Panel
      title="Waiting on you"
      subtitle={
        data.length > 0
          ? `${data.length} item${data.length === 1 ? '' : 's'}, oldest first. Open one to act on it.`
          : undefined
      }
    >
      <DataTable<TaskItem>
        rowKey={(t) => `${t.type}:${t.id}`}
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data}
        pagination={data.length > 25 ? { pageSize: 25 } : false}
        onRowOpen={open}
        empty={
          <EmptyState
            illustration="inbox"
            title="You're all caught up"
            description="Nothing is waiting on you."
          />
        }
        columns={[
          {
            title: 'Item',
            dataIndex: 'title',
            render: (_: string, t) => (
              <span style={{ display: 'flex', alignItems: 'center', gap: space[3], minWidth: 220 }}>
                <TypeIcon type={t.type} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontWeight: fw.semibold, color: v.textPrimary }}>
                    {t.title}
                  </span>
                  {t.detail && (
                    <span style={{ display: 'block', color: v.textSecondary, fontSize: fs.sm }}>
                      {t.detail}
                    </span>
                  )}
                </span>
              </span>
            ),
          },
          {
            title: 'Type',
            dataIndex: 'type',
            render: (ty: TaskType) => (
              <StatusChip tone={TYPE_META[ty].tone}>{TASK_TYPE_LABELS[ty]}</StatusChip>
            ),
          },
          {
            title: 'Requested by',
            dataIndex: 'employeeName',
            render: (n: string | null) => <Requester name={n} />,
          },
          {
            title: 'Waiting since',
            dataIndex: 'waitingSince',
            render: (d: string) => <span className="ws-num">{formatDateTime(d)}</span>,
          },
          { title: 'Status', key: 'status', render: () => <StatusChip status="PENDING" /> },
        ]}
        mobile={{
          avatar: (t) => <TypeIcon type={t.type} />,
          title: (t) => t.title,
          subtitle: (t) => t.detail,
          status: (t) => (
            <StatusChip tone={TYPE_META[t.type].tone}>{TASK_TYPE_LABELS[t.type]}</StatusChip>
          ),
          fields: [
            { label: 'Requested by', render: (t) => t.employeeName ?? '—' },
            { label: 'Waiting since', render: (t) => formatDateTime(t.waitingSince) },
          ],
        }}
      />
    </Panel>
  );
}
