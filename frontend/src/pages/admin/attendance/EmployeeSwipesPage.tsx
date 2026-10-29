import { useState } from 'react';
import dayjs from 'dayjs';
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { Button, Checkbox, DatePicker, Select, Tooltip, Typography } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import * as adminApi from '../../../api/attendanceAdmin';
import type { Swipe, SwipeQuery } from '../../../api/attendanceAdmin';
import * as employeeApi from '../../../api/employee';
import * as musterApi from '../../../api/muster';
import {
  DataTable,
  EmptyState,
  FilterBar,
  PageHeader,
  Panel,
  StatusChip,
  toast,
} from '../../../ui';
import { useAuth } from '../../../hooks/useAuth';
import { apiErrorMessage } from '../../../lib/apiError';

const { Text } = Typography;

// Workforce → Attendance → Employee Swipes (Phase 3 commit 2): the raw punch log exactly as the device sent it, for
// finding out what happened on a day. Read-only. Company-wide for HR (including punches that match nobody); a manager
// who has been given this sees their team's punches only.
export function EmployeeSwipesPage() {
  const { hasPermission, user } = useAuth();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([
    dayjs().subtract(6, 'day'),
    dayjs(),
  ]);
  const [filters, setFilters] = useState<Omit<SwipeQuery, 'from' | 'to' | 'page' | 'pageSize'>>({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query: SwipeQuery = {
    ...filters,
    from: range[0].format('YYYY-MM-DD'),
    to: range[1].format('YYYY-MM-DD'),
  };
  const { data: options } = useQuery({
    queryKey: ['attendance', 'swipes', 'options'],
    queryFn: adminApi.swipeOptions,
    staleTime: 30_000,
  });
  const { data: people } = useQuery({
    queryKey: ['employees', 'picker', search],
    queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20 }),
  });
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['attendance', 'swipes', query, page],
    queryFn: () => adminApi.listSwipes({ ...query, page, pageSize: 50 }),
    retry: false,
    placeholderData: keepPreviousData,
  });
  const exportMutation = useMutation({
    mutationFn: () => adminApi.exportSwipes(query),
    onSuccess: (blob) =>
      musterApi.saveBlob(blob, `employee-swipes-${query.from}-to-${query.to}.xlsx`),
    onError: (err) => toast.error(apiErrorMessage(err, 'Could not export.')),
  });
  const set = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const companyWide = user?.dataScope === 'ALL' || hasPermission('attendance.override.manage');

  const activeCount = [
    filters.deviceId,
    filters.employeeId,
    filters.route,
    filters.used,
    filters.flagged,
    filters.unmapped,
  ].filter(Boolean).length;
  const flagChip = (r: Swipe) =>
    r.flag ? (
      <Tooltip title={r.decisionReason ?? undefined}>
        <span>
          <StatusChip
            tone={
              r.decision === 'ACCEPTED'
                ? 'success'
                : r.decision === 'DISCARDED'
                  ? 'neutral'
                  : 'warning'
            }
          >
            {r.flagLabel}:{' '}
            {r.decision === 'ACCEPTED'
              ? 'accepted'
              : r.decision === 'DISCARDED'
                ? 'discarded'
                : 'waiting'}
          </StatusChip>
        </span>
      </Tooltip>
    ) : (
      <Text type="secondary">—</Text>
    );
  const usedChip = (r: Swipe) =>
    r.employeeId ? (
      r.used ? (
        <StatusChip tone="success">used</StatusChip>
      ) : (
        <StatusChip tone="neutral">not used</StatusChip>
      )
    ) : (
      <Text type="secondary">n/a</Text>
    );
  const employeeCell = (r: Swipe) =>
    r.employeeId ? (
      `${r.employeeName ?? ''} (${r.employeeCode ?? ''})`
    ) : (
      <StatusChip tone="danger">matches nobody</StatusChip>
    );

  return (
    <>
      <PageHeader
        title="Employee Swipes"
        subtitle={`Every punch exactly as the device sent it, newest first. A punch can be unused: a near-duplicate, one still waiting for a decision or discarded, or one outside every shift's window. ${companyWide ? 'You see the whole company, including punches that match no employee.' : "You see your team's punches."}`}
        actions={
          <Button
            icon={<DownloadOutlined />}
            loading={exportMutation.isPending}
            onClick={() => exportMutation.mutate()}
          >
            Export to Excel
          </Button>
        }
      />
      <Panel>
        <FilterBar
          activeCount={activeCount}
          onClear={() => {
            setFilters({});
            setPage(1);
          }}
          filters={
            <>
              <DatePicker.RangePicker
                allowClear={false}
                format="D MMM YYYY"
                value={range}
                aria-label="Dates"
                onChange={(v) => {
                  if (v?.[0] && v[1]) {
                    setRange([v[0], v[1]]);
                    setPage(1);
                  }
                }}
              />
              <Select
                allowClear
                placeholder="Any device"
                aria-label="Device"
                style={{ width: 200 }}
                value={filters.deviceId}
                onChange={(v) => set({ deviceId: v })}
                options={(options?.devices ?? []).map((d) => ({
                  value: d.id,
                  label: `${d.name} (${d.branch})`,
                }))}
              />
              <Select
                allowClear
                showSearch={{ filterOption: false, onSearch: setSearch }}
                placeholder="Any employee"
                aria-label="Employee"
                style={{ width: 220 }}
                value={filters.employeeId}
                onChange={(v) => set({ employeeId: v })}
                options={(people?.rows ?? []).map((e) => ({
                  value: e.id,
                  label: `${e.fullName} (${e.employeeCode})`,
                }))}
              />
              <Select
                allowClear
                placeholder="Any route"
                aria-label="Route"
                style={{ width: 130 }}
                value={filters.route}
                onChange={(v) => set({ route: v })}
                options={(options?.routes ?? []).map((r) => ({
                  value: r as SwipeQuery['route'],
                  label: r,
                }))}
              />
              <Select
                allowClear
                placeholder="Used or not"
                aria-label="Used or not"
                style={{ width: 150 }}
                value={filters.used}
                onChange={(v) => set({ used: v })}
                options={[
                  { value: 'yes', label: 'Used in a day' },
                  { value: 'no', label: 'Not used' },
                ]}
              />
              <Select
                allowClear
                placeholder="Flags"
                aria-label="Flags"
                style={{ width: 190 }}
                value={filters.flagged}
                onChange={(v) => set({ flagged: v })}
                options={[
                  { value: 'any', label: 'Flagged' },
                  { value: 'pending', label: 'Waiting for a decision' },
                  { value: 'accepted', label: 'Accepted' },
                  { value: 'discarded', label: 'Discarded' },
                  { value: 'none', label: 'Not flagged' },
                ]}
              />
              {companyWide && (
                <Checkbox
                  checked={!!filters.unmapped}
                  onChange={(e) => set({ unmapped: e.target.checked || undefined })}
                >
                  Matching no employee
                </Checkbox>
              )}
            </>
          }
        />
        <DataTable<Swipe>
          density="compact"
          rowKey="id"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data?.entries ?? []}
          empty={
            <EmptyState
              kind={activeCount ? 'no-results' : 'empty'}
              compact
              title="No punches for these filters."
              description={null}
            />
          }
          pagination={{
            current: page,
            pageSize: 50,
            total: data?.total ?? 0,
            onChange: setPage,
            showSizeChanger: false,
            showTotal: (t) => `${t.toLocaleString('en-IN')} punches`,
          }}
          mobile={{
            title: (r) => dayjs(r.time).format('ddd D MMM, HH:mm:ss'),
            subtitle: (r) => (r.branch ? `${r.device} (${r.branch})` : r.device),
            status: usedChip,
            fields: [
              { label: 'Employee', render: employeeCell },
              { label: 'Device user ID', render: (r) => r.deviceUserId },
              { label: 'Arrived by', render: (r) => r.route },
              { label: 'Flag', render: flagChip },
            ],
          }}
          columns={[
            {
              title: 'Time',
              key: 't',
              render: (_, r) => (
                <Tooltip title={`The device recorded: ${r.deviceTime}`}>
                  {dayjs(r.time).format('ddd D MMM, HH:mm:ss')}
                </Tooltip>
              ),
            },
            {
              title: 'Device',
              key: 'd',
              render: (_, r) => (r.branch ? `${r.device} (${r.branch})` : r.device),
            },
            { title: 'Device user ID', dataIndex: 'deviceUserId' },
            { title: 'Employee', key: 'e', render: (_, r) => employeeCell(r) },
            {
              title: 'Arrived by',
              dataIndex: 'route',
              render: (v: string) => <StatusChip tone="neutral">{v}</StatusChip>,
            },
            { title: 'Flag', key: 'f', render: (_, r) => flagChip(r) },
            { title: 'Used', dataIndex: 'used', render: (_: boolean, r) => usedChip(r) },
          ]}
        />
      </Panel>
    </>
  );
}
