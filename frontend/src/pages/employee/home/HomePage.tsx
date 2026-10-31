import { lazy, Suspense, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tooltip } from 'antd';
import {
  ArrowRightOutlined,
  IdcardOutlined,
  SafetyCertificateOutlined,
  SoundOutlined,
  WalletOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router-dom';
import * as leaveApi from '../../../api/leave';
import * as inboxApi from '../../../api/inbox';
import { REQUEST_HUB_TYPE_LABELS } from '@shared/types/inbox';
import * as announcementsApi from '../../../api/announcements';
import { useAuth } from '../../../hooks/useAuth';
import { fs, fw, radius, space, v } from '../../../theme/tokens';
// Direct ui/* imports, not the barrel: this page is on the "shell + employee home" bundle budget, and the barrel would drag DataTable (antd Table) along.
import { ApprovalBanner } from '../../../ui/ApprovalBanner';
import { CardGrid, Panel, Stack } from '../../../ui/Panel';
const RemoteCheckCard = lazy(() => import('../../../components/attendance/RemoteCheckCard').then((m) => ({ default: m.RemoteCheckCard })));
import { EmptyState } from '../../../ui/EmptyState';
import { Illustration } from '../../../ui/Illustrations';
import { InitialsAvatar } from '../../../ui/Avatar';
import { QueryState } from '../../../ui/QueryState';
import { Skel } from '../../../ui/Skeletons';
import { StatusChip } from '../../../ui/StatusChip';
import { useIsPhone } from '../../../ui/hooks';

const QUOTES = [
  { text: 'Small daily improvements lead to stunning results.', author: 'Robin Sharma' },
  { text: 'Teamwork makes the dream work.', author: 'John C. Maxwell' },
  { text: 'Great things are done by a series of small things.', author: 'Vincent Van Gogh' },
];

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  timeZone: 'Asia/Kolkata',
});
const DAY_FORMAT = new Intl.DateTimeFormat('en-IN', { day: '2-digit', timeZone: 'Asia/Kolkata' });
const MONTH_FORMAT = new Intl.DateTimeFormat('en-IN', { month: 'short', timeZone: 'Asia/Kolkata' });

const CARD_MIN_HEIGHT = 220;

/** The card header's arrow: still a link (so it opens in a new tab, reads as a link), shaped like an icon button. */
function CardLink({ to, label }: { to: string; label: string }) {
  return (
    <Tooltip title={label}>
      <Link
        to={to}
        aria-label={label}
        style={{
          width: 36,
          height: 36,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.sm,
          border: `1px solid ${v.borderDefault}`,
          color: v.textBody,
        }}
      >
        <ArrowRightOutlined />
      </Link>
    </Tooltip>
  );
}

function RowsSkeleton({ rows = 3, avatar = true }: { rows?: number; avatar?: boolean }) {
  return (
    <div aria-hidden style={{ display: 'flex', flexDirection: 'column', gap: space[4] }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: space[3] }}>
          {avatar && <Skel w={40} h={40} r={radius.md} style={{ flex: 'none' }} />}
          <div style={{ flex: 1 }}>
            <Skel w="65%" style={{ marginBottom: space[2] }} />
            <Skel w="40%" h={10} />
          </div>
        </div>
      ))}
    </div>
  );
}

function RowList({ children }: { children: ReactNode }) {
  return (
    <ul
      style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}
    >
      {children}
    </ul>
  );
}

const rowStyle = (first: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: space[3],
  padding: `${space[3]}px 0`,
  borderTop: first ? undefined : `1px solid ${v.borderDefault}`,
  minWidth: 0,
});

function Primary({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        fontWeight: fw.semibold,
        color: v.textPrimary,
        fontSize: fs.md,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
}
function Secondary({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        color: v.textSecondary,
        fontSize: fs.sm,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </div>
  );
}

/** A quiet "coming later" line: icon, title, one sentence. */
function InfoRow({
  icon,
  title,
  text,
  first,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  first?: boolean;
}) {
  return (
    <li style={{ ...rowStyle(Boolean(first)), alignItems: 'flex-start' }}>
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          flex: 'none',
          borderRadius: radius.pill,
          background: v.bgSubtle,
          color: v.textSecondary,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: fs.lg,
        }}
      >
        {icon}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{title}</div>
        <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{text}</div>
      </div>
    </li>
  );
}

function ReviewCard() {
  const { hasPermission } = useAuth();
  const canApprove = hasPermission('leave.approve');
  const {
    data: pendingReview,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['leave', 'requests', 'review-queue'],
    queryFn: () => leaveApi.listLeaveRequests({ status: 'PENDING', pageSize: 3 }),
    enabled: canApprove,
  });
  const pendingCount = pendingReview?.total ?? 0;
  const rows = (pendingReview?.rows ?? []).slice(0, 3);

  return (
    <Panel
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: space[2] }}>
          Review
          {canApprove && pendingCount > 0 && (
            <StatusChip tone="warning">{`${pendingCount} pending`}</StatusChip>
          )}
        </span>
      }
      extra={<CardLink to="/app/todo/review" label="Open Review" />}
      style={{ height: '100%', minHeight: CARD_MIN_HEIGHT }}
    >
      {!canApprove ? (
        <EmptyState
          compact
          illustration="success"
          title="Nothing to review"
          description="Requests that need your approval will appear here."
        />
      ) : (
        <QueryState
          isLoading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          compact
          skeleton={<RowsSkeleton />}
          isEmpty={pendingCount === 0}
          empty={
            <EmptyState
              compact
              illustration="success"
              title="Nothing to review"
              description="You're all caught up. New requests from your team will appear here."
            />
          }
        >
          <RowList>
            {rows.map((r, i) => (
              <li key={r.id} style={rowStyle(i === 0)}>
                <InitialsAvatar name={r.employeeName} size={36} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Primary>{r.employeeName}</Primary>
                  <Secondary>
                    {r.leaveTypeName} ·{' '}
                    {r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`}
                  </Secondary>
                </div>
                <StatusChip status={r.status} />
              </li>
            ))}
          </RowList>
          <div
            style={{
              marginTop: space[3],
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: space[2],
            }}
          >
            <span style={{ color: v.textSecondary, fontSize: fs.sm }}>
              {pendingCount} leave request{pendingCount === 1 ? '' : 's'} from your team awaiting
              your decision.
            </span>
            <Link to="/app/todo/review" style={{ fontWeight: fw.semibold }}>
              Go to Review →
            </Link>
          </div>
        </QueryState>
      )}
    </Panel>
  );
}

function HolidaysCard() {
  const {
    data: holidays,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['leave', 'holidays', 'upcoming'],
    queryFn: () => leaveApi.listHolidays(),
  });
  const upcomingHolidays = (holidays ?? [])
    .filter((h) => new Date(h.date).getTime() >= new Date().setHours(0, 0, 0, 0))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 3);

  return (
    <Panel
      title="Upcoming Holidays"
      extra={<CardLink to="/app/leave/holiday-calendar" label="Open holiday calendar" />}
      style={{ height: '100%', minHeight: CARD_MIN_HEIGHT }}
    >
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        compact
        skeleton={<RowsSkeleton />}
        isEmpty={upcomingHolidays.length === 0}
        empty={
          <EmptyState
            compact
            illustration="calendar"
            title="No upcoming holidays"
            description="See the whole year on the holiday calendar."
          />
        }
      >
        <RowList>
          {upcomingHolidays.map((h, i) => {
            const date = new Date(h.date);
            return (
              <li key={h.id} style={rowStyle(i === 0)}>
                <span
                  style={{
                    width: 44,
                    height: 44,
                    flex: 'none',
                    borderRadius: radius.md,
                    background: v.accentSubtle,
                    color: v.accentText,
                    display: 'inline-flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1.1,
                  }}
                >
                  <span className="ws-num" style={{ fontSize: fs.lg, fontWeight: fw.bold }}>
                    {DAY_FORMAT.format(date)}
                  </span>
                  <span
                    style={{ fontSize: fs.xs, fontWeight: fw.semibold, textTransform: 'uppercase' }}
                  >
                    {MONTH_FORMAT.format(date)}
                  </span>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Primary>{h.name}</Primary>
                  <Secondary>{WEEKDAY_FORMAT.format(date)}</Secondary>
                </div>
              </li>
            );
          })}
        </RowList>
      </QueryState>
    </Panel>
  );
}

function TrackCard() {
  // Track = my own requests still in progress, from every module (Request
  // Hub, Phase 5 commit D). It used to list pending leave without an
  // employee filter, which for anyone with leave.view meant other people's.
  const {
    data: tracking,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['request-hub', { state: 'OPEN', limit: 5 }],
    queryFn: () => inboxApi.listMyRequests({ state: 'OPEN', limit: 5 }),
  });

  return (
    <Panel
      title="Track"
      extra={<CardLink to="/app/request-hub" label="Open Request Hub" />}
      style={{ height: '100%', minHeight: CARD_MIN_HEIGHT }}
    >
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        compact
        skeleton={<RowsSkeleton avatar={false} />}
        isEmpty={!tracking || tracking.length === 0}
        empty={
          <EmptyState
            compact
            illustration="inbox"
            title="Nothing new to track"
            description="Requests you raise — leave, profile changes, helpdesk — show their progress here."
          />
        }
      >
        <RowList>
          {(tracking ?? []).map((r, i) => (
            <li
              key={`${r.type}:${r.id}`}
              style={{ borderTop: i === 0 ? undefined : `1px solid ${v.borderDefault}` }}
            >
              <Link to={r.link} style={{ ...rowStyle(true), color: 'inherit' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <Primary>{r.title}</Primary>
                  <Secondary>
                    {REQUEST_HUB_TYPE_LABELS[r.type]}
                    {r.detail ? ` · ${r.detail}` : ''}
                  </Secondary>
                </div>
                <StatusChip status={r.status}>{r.statusLabel}</StatusChip>
              </Link>
            </li>
          ))}
        </RowList>
      </QueryState>
    </Panel>
  );
}

function AnnouncementBanner() {
  const { data: announcement } = useQuery({
    queryKey: ['announcements', 'active'],
    queryFn: announcementsApi.getActiveAnnouncement,
  });
  if (!announcement) return null;
  return (
    <ApprovalBanner
      tone="info"
      icon={<SoundOutlined />}
      title={announcement.title}
      description={announcement.body}
      actions={
        announcement.linkUrl && announcement.linkLabel ? (
          <a
            href={announcement.linkUrl}
            target="_blank"
            rel="noreferrer"
            style={{ fontWeight: fw.semibold }}
          >
            {announcement.linkLabel}
          </a>
        ) : undefined
      }
    />
  );
}

export function HomePage() {
  const quote = QUOTES[new Date().getDate() % QUOTES.length]!;
  const { user } = useAuth();
  const phone = useIsPhone();

  return (
    <Stack>
      <section
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: space[6],
        }}
      >
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontSize: phone ? fs.h1 - 2 : fs.h1,
              fontWeight: fw.bold,
              color: v.textPrimary,
              lineHeight: 1.3,
            }}
          >
            {greeting()}, {user?.fullName?.split(' ')[0] ?? ''}
          </h1>
          <p style={{ margin: `${space[1]}px 0 0`, color: v.textSecondary, fontSize: fs.md }}>
            “{quote.text}” — {quote.author}
          </p>
        </div>
        {!phone && <Illustration name="people" size={96} style={{ flex: 'none' }} />}
      </section>

      <AnnouncementBanner />

      <Suspense fallback={null}>
        <RemoteCheckCard />
      </Suspense>

      <CardGrid min={300}>
        <ReviewCard />
        <HolidaysCard />
        <TrackCard />

        <Panel title="Payslip" style={{ height: '100%' }}>
          <EmptyState
            compact
            illustration="documents"
            title="Payslips are coming in Phase 6"
            description="Your monthly payslip will show here once payroll moves to this portal."
          />
        </Panel>

        <Panel title="Quick Access" style={{ height: '100%' }}>
          <RowList>
            <InfoRow
              first
              icon={<WalletOutlined />}
              title="Salary documents"
              text="Salary documents are coming in Phase 6"
            />
          </RowList>
        </Panel>

        <Panel title="Tax declarations" style={{ height: '100%' }}>
          <RowList>
            <InfoRow
              first
              icon={<IdcardOutlined />}
              title="IT Declaration"
              text="Coming in Phase 6 — you'll be able to submit your Income Tax declaration here."
            />
            <InfoRow
              icon={<SafetyCertificateOutlined />}
              title="POI (Proof of Investment)"
              text="Coming in Phase 6 — you'll be able to submit your Proof of Investments here."
            />
          </RowList>
        </Panel>
      </CardGrid>
    </Stack>
  );
}
