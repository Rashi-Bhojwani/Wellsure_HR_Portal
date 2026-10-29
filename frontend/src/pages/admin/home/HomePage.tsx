import { lazy, Suspense, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Popconfirm, Segmented, Tooltip } from 'antd';
import {
  CloseOutlined,
  EyeOutlined,
  FileSearchOutlined,
  LinkOutlined,
  PlusOutlined,
  RightOutlined,
  SoundOutlined,
} from '@ant-design/icons';
import { useAuth } from '../../../hooks/useAuth';
import * as managersApi from '../../../api/managers';
import * as adminHomeApi from '../../../api/adminHome';
import * as announcementsApi from '../../../api/announcements';
import { FAVOURITE_ICONS } from './favouriteIcons';
import { DeviceWarnings } from '../../../components/devices/DeviceWarnings';
import { fs, fw, radius, space, v } from '../../../theme/tokens';
import { apiErrorMessage } from '../../../lib/apiError';
import { formatDate } from '../../../lib/dates';
// Direct ui/* imports, not the barrel: this page is on the "shell + admin home" bundle budget, and the barrel would drag DataTable (antd Table) along.
import { ApprovalBanner } from '../../../ui/ApprovalBanner';
import { EmptyState } from '../../../ui/EmptyState';
import { PageHeader } from '../../../ui/PageHeader';
import { Panel, Stack } from '../../../ui/Panel';
import { QueryState } from '../../../ui/QueryState';
import { Skel } from '../../../ui/Skeletons';
import { StatCard } from '../../../ui/StatCard';
import { toast } from '../../../ui/Toast';
import { useIsCompact, useIsPhone } from '../../../ui/hooks';

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const tileStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 112,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: space[2],
  padding: space[3],
  background: v.bgSurface,
  border: `1px solid ${v.borderDefault}`,
  borderRadius: radius.md,
  cursor: 'pointer',
  font: 'inherit',
  color: v.textPrimary,
  textAlign: 'center',
};

function FavouriteTiles() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  // The drawer mounts from its first open on (then stays, so it animates closed).
  const [addUsed, setAddUsed] = useState(false);
  if (addOpen && !addUsed) setAddUsed(true);
  const {
    data: favourites = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'favourites'],
    queryFn: adminHomeApi.listFavourites,
  });
  const deleteFavourite = useMutation({
    mutationFn: adminHomeApi.deleteFavourite,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['admin', 'favourites'] }),
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not remove this shortcut.')),
  });

  const grid: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(min(120px, 100%), 1fr))',
    gap: space[3],
  };

  return (
    <Panel title="My Favourites" subtitle="Your shortcuts to the screens you use most">
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        compact
        skeleton={
          <div style={grid} aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <Skel key={i} h={112} r={radius.md} />
            ))}
          </div>
        }
      >
        <div style={grid}>
          {favourites.map((f) => {
            const Icon = FAVOURITE_ICONS[f.icon] ?? LinkOutlined;
            return (
              <div key={f.id} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="ws-stat-card"
                  style={tileStyle}
                  onClick={() => navigate(f.path)}
                >
                  <span
                    aria-hidden
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: radius.pill,
                      background: v.accentSubtle,
                      color: v.accentText,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: fs.h2,
                    }}
                  >
                    <Icon />
                  </span>
                  <span
                    style={{
                      fontSize: fs.sm,
                      fontWeight: fw.semibold,
                      lineHeight: 1.3,
                      wordBreak: 'break-word',
                    }}
                  >
                    {f.label}
                  </span>
                </button>
                <Popconfirm
                  title="Remove this shortcut?"
                  okText="Remove"
                  okButtonProps={{ danger: true, loading: deleteFavourite.isPending }}
                  onConfirm={() => deleteFavourite.mutateAsync(f.id)}
                >
                  <Tooltip title="Remove shortcut">
                    <Button
                      type="text"
                      size="small"
                      aria-label={`Remove shortcut ${f.label}`}
                      icon={<CloseOutlined style={{ fontSize: fs.chip }} />}
                      style={{
                        position: 'absolute',
                        top: space[1],
                        right: space[1],
                        color: v.textSecondary,
                        minWidth: 28,
                        width: 28,
                        height: 28,
                      }}
                    />
                  </Tooltip>
                </Popconfirm>
              </div>
            );
          })}
          <button
            type="button"
            style={{
              ...tileStyle,
              borderStyle: 'dashed',
              borderColor: v.borderControl,
              color: v.textSecondary,
            }}
            onClick={() => setAddOpen(true)}
          >
            <span
              aria-hidden
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.pill,
                background: v.bgSubtle,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: fs.h2,
              }}
            >
              <PlusOutlined />
            </span>
            <span style={{ fontSize: fs.sm, fontWeight: fw.semibold }}>Add Shortcut</span>
          </button>
        </div>
      </QueryState>
      {addUsed && (
        <Suspense fallback={null}>
          <AddFavouriteDrawer open={addOpen} onClose={() => setAddOpen(false)} />
        </Suspense>
      )}
    </Panel>
  );
}

function TaskRow({
  label,
  count,
  note,
  action,
  onOpen,
}: {
  label: string;
  count: number;
  note: string;
  action: string;
  onOpen: () => void;
}) {
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: space[3],
        padding: `${space[3]}px 0`,
        borderTop: `1px solid ${v.borderDefault}`,
      }}
    >
      <span
        className="ws-num"
        style={{
          minWidth: 36,
          height: 36,
          padding: `0 ${space[2]}px`,
          borderRadius: radius.sm,
          background: v.bgSubtle,
          color: v.textPrimary,
          fontWeight: fw.bold,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {count}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{label}</div>
        <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{`${count} ${note}`}</div>
      </div>
      <Button type="link" onClick={onOpen} style={{ paddingInline: space[2] }}>
        {action} <RightOutlined />
      </Button>
    </li>
  );
}

function MyTasks() {
  const navigate = useNavigate();
  const {
    data: taskCounts,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['admin', 'tasks', 'counts'],
    queryFn: adminHomeApi.getTaskCounts,
  });
  const rows = taskCounts
    ? [
        ...taskCounts.review.byType
          .filter((t) => t.count > 0)
          .map((t) => ({
            ...t,
            note: 'pending your review',
            action: 'Review',
            to: '/app/todo/review',
          })),
        ...taskCounts.monitor.byType
          .filter((t) => t.count > 0)
          .map((t) => ({
            ...t,
            note: "pending for others' review",
            action: 'Monitor',
            to: '/admin/workforce/leave/employee-leave',
          })),
      ]
    : [];

  return (
    <Panel title="My Tasks">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(200px, 100%), 1fr))',
          gap: space[4],
        }}
      >
        <StatCard
          tone="warning"
          icon={<FileSearchOutlined />}
          label="Things to review"
          value={taskCounts?.review.total ?? 0}
          loading={isLoading}
        />
        <StatCard
          tone="info"
          icon={<EyeOutlined />}
          label="Things to monitor"
          value={taskCounts?.monitor.total ?? 0}
          loading={isLoading}
        />
      </div>
      <div style={{ marginTop: space[4] }}>
        <QueryState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          compact
          skeleton={
            <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: space[3] }}>
              <Skel h={44} />
              <Skel h={44} />
            </div>
          }
          isEmpty={rows.length === 0}
          empty={
            <EmptyState
              compact
              illustration="success"
              title="Nothing to review or monitor"
              description="New approvals waiting on you or your team will show up here."
            />
          }
        >
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {rows.map((t) => (
              <TaskRow
                key={`${t.action}:${t.type}`}
                label={t.label}
                count={t.count}
                note={t.note}
                action={t.action}
                onOpen={() => navigate(t.to)}
              />
            ))}
          </ul>
        </QueryState>
      </div>
    </Panel>
  );
}

function LatestUpdates() {
  const { hasPermission } = useAuth();
  const canManageAnnouncements = hasPermission('announcements.manage');
  const all = useQuery({
    queryKey: ['announcements', 'all'],
    queryFn: announcementsApi.listAnnouncements,
    enabled: canManageAnnouncements,
  });
  const active = useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: announcementsApi.getActiveAnnouncement,
    enabled: !canManageAnnouncements,
  });
  const q = canManageAnnouncements ? all : active;
  const latestUpdates = canManageAnnouncements
    ? (all.data ?? []).slice(0, 5)
    : active.data
      ? [active.data]
      : [];

  return (
    <Panel title="Latest Updates" style={{ height: '100%' }}>
      <QueryState
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        compact
        skeleton={
          <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ display: 'flex', gap: space[3] }}>
                <Skel w={36} h={36} r={radius.pill} />
                <div style={{ flex: 1 }}>
                  <Skel w="70%" style={{ marginBottom: space[2] }} />
                  <Skel w="40%" h={10} />
                </div>
              </div>
            ))}
          </div>
        }
        isEmpty={latestUpdates.length === 0}
        empty={
          <EmptyState
            compact
            illustration="documents"
            title="No updates yet"
            description="Company announcements will appear here."
          />
        }
      >
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {latestUpdates.map((u, i) => (
            <li
              key={u.id}
              style={{
                display: 'flex',
                gap: space[3],
                padding: `${space[3]}px 0`,
                borderTop: i === 0 ? undefined : `1px solid ${v.borderDefault}`,
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 36,
                  height: 36,
                  flex: 'none',
                  borderRadius: radius.pill,
                  background: v.infoSubtle,
                  color: v.infoText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <SoundOutlined />
              </span>
              <div style={{ minWidth: 0 }}>
                <div
                  style={{ fontWeight: fw.semibold, color: v.textPrimary, wordBreak: 'break-word' }}
                >
                  {u.title}
                </div>
                <div style={{ fontSize: fs.sm, color: v.textSecondary }}>
                  {u.activeFrom ? formatDate(u.activeFrom) : ''}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </QueryState>
    </Panel>
  );
}

function WelcomeTab() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const compact = useIsCompact();

  const { data: taskCounts } = useQuery({
    queryKey: ['admin', 'tasks', 'counts'],
    queryFn: adminHomeApi.getTaskCounts,
  });

  // E2: people with no (valid) manager, for whoever can assign teams.
  const canAssignTeams = hasPermission('manager.team.assign');
  const { data: unassigned = [] } = useQuery({
    queryKey: ['managers', 'unassigned'],
    queryFn: managersApi.listUnassigned,
    enabled: canAssignTeams,
  });
  const noApprover = taskCounts?.leaveNoTeamApprover ?? 0;
  const held = taskCounts?.heldFromHr ?? null;

  return (
    <Stack>
      {held && (
        <ApprovalBanner
          tone="info"
          title={[held.leave > 0 && `${held.leave} leave ${held.leave === 1 ? "request" : "requests"}`, held.regularizations > 0 && `${held.regularizations} attendance ${held.regularizations === 1 ? "correction" : "corrections"}`].filter(Boolean).join(" and ") + " waiting for you"}
          description="HR has been switched off from deciding these (Admin Tools, What HR Can Do). Nothing was approved or lost; they are in your queue, and go back to HR if you switch the duty on again."
          actions={<Button onClick={() => navigate("/admin/tasks")}>Open</Button>}
        />
      )}
      {noApprover > 0 && (
        <ApprovalBanner
          tone="warning"
          title={`${noApprover} leave ${noApprover === 1 ? 'request has' : 'requests have'} no manager who can approve ${noApprover === 1 ? 'it' : 'them'}`}
          description="Their manager hasn't been given leave approval and nobody is covering, or they have no reporting manager. They wait on HR."
          actions={
            <Button
              onClick={() => navigate('/admin/workforce/leave/employee-leave?noTeamApprover=1')}
            >
              Review
            </Button>
          }
        />
      )}
      {/* P2-F: a wrong device clock or punches at risk — "nobody would think to look". */}
      <DeviceWarnings enabled={hasPermission('attendance.devices.manage')} linkToDevices />
      {canAssignTeams && unassigned.length > 0 && (
        <ApprovalBanner
          tone="warning"
          title={`${unassigned.length} ${unassigned.length === 1 ? 'person has' : 'people have'} no reporting manager`}
          description="Their leave has no manager to approve it, and they don't appear in any team."
          actions={<Button onClick={() => navigate('/admin/admin-tools/managers')}>Assign</Button>}
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: compact ? 'minmax(0, 1fr)' : 'minmax(0, 2fr) minmax(0, 1fr)',
          gap: 'inherit',
          alignItems: 'start',
        }}
      >
        <Stack>
          <FavouriteTiles />
          <MyTasks />
        </Stack>
        <LatestUpdates />
      </div>
    </Stack>
  );
}

const AddFavouriteDrawer = lazy(() => import('./AddFavouriteDrawer').then((m) => ({ default: m.AddFavouriteDrawer })));

// The Dashboard tab (charts) is its own chunk; hovering or focusing the switcher starts loading it.
const loadDashboard = () => import('./AdminDashboardTab');
const AdminDashboardTab = lazy(() => loadDashboard().then((m) => ({ default: m.AdminDashboardTab })));

function DashboardSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading dashboard"
      style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(400px, 100%), 1fr))', gap: space[6] }}
    >
      {[0, 1, 2, 3].map((i) => (
        <Skel key={i} h={360} r={radius.md} />
      ))}
    </div>
  );
}

type View = 'Welcome' | 'Dashboard';

export function AdminHomePage() {
  const { user } = useAuth();
  const phone = useIsPhone();
  const [params, setParams] = useSearchParams();
  // ?view=dashboard makes the Dashboard tab linkable; the default stays Welcome.
  const tab: View = params.get('view') === 'dashboard' ? 'Dashboard' : 'Welcome';
  const setTab = (t: View) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (t === 'Dashboard') next.set('view', 'dashboard');
        else next.delete('view');
        return next;
      },
      { replace: true },
    );

  return (
    <div>
      <PageHeader
        title={`${greeting()}, ${user?.fullName?.split(' ')[0] ?? ''}`}
        subtitle={
          tab === 'Welcome'
            ? "Here's what needs your attention today."
            : 'Your people at a glance, from the figures we hold.'
        }
        actions={
          <span onPointerEnter={() => void loadDashboard()} onFocus={() => void loadDashboard()} style={phone ? { flex: 1, minWidth: 0 } : undefined}>
          <Segmented<View>
            options={['Welcome', 'Dashboard']}
            value={tab}
            onChange={setTab}
            size="large"
            block={phone}
            aria-label="Home view"
          />
          </span>
        }
      />
      {tab === 'Welcome' ? (
        <WelcomeTab />
      ) : (
        <Suspense fallback={<DashboardSkeleton />}>
          <AdminDashboardTab />
        </Suspense>
      )}
    </div>
  );
}
