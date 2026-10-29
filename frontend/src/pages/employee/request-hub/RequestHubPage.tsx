import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Segmented, Select } from 'antd';
import {
  REQUEST_HUB_TYPES,
  REQUEST_HUB_TYPE_LABELS,
  type RequestHubItem,
  type RequestHubState,
  type RequestHubType,
} from '@shared/types/inbox';
import * as inboxApi from '../../../api/inbox';
import { formatDate, formatDateTime } from '../../../lib/dates';
import { fs, fw, space, v } from '../../../theme/tokens';
import {
  DataTable,
  EmptyState,
  PageHeader,
  Panel,
  StatusChip,
  useIsPhone,
  type ChipTone,
} from '../../../ui';

const STATUS_TONES: Record<string, ChipTone> = {
  PENDING: 'warning',
  APPROVED: 'success',
  REJECTED: 'danger',
  CANCELLED: 'neutral',
  RESOLVED: 'success',
  WAITING_ON_EMPLOYEE: 'warning',
};
const toneFor = (r: RequestHubItem): ChipTone =>
  STATUS_TONES[r.status] ?? (r.state === 'OPEN' ? 'warning' : 'neutral');

// Request Hub (spec §6): everything I've asked for, from every module, in
// one list. Read-only — each row opens the module where it's handled.
export function RequestHubPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [state, setState] = useState<RequestHubState | 'ALL'>('OPEN');
  const [type, setType] = useState<RequestHubType | undefined>();
  const {
    data = [],
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['request-hub', { state, type }],
    queryFn: () =>
      inboxApi.listMyRequests({ state: state === 'ALL' ? undefined : state, type, limit: 200 }),
    placeholderData: keepPreviousData,
  });
  const filtered = type !== undefined || state !== 'OPEN';

  return (
    <div>
      <PageHeader
        title="Request Hub"
        subtitle="Everything you've asked for, from every module. Open a request to see it where it's handled."
      />
      <Panel>
        <div
          style={{
            display: 'flex',
            gap: space[3],
            flexWrap: 'wrap',
            alignItems: 'center',
            marginBottom: space[5],
          }}
        >
          <Segmented<RequestHubState | 'ALL'>
            value={state}
            onChange={setState}
            block={phone}
            style={phone ? { width: '100%' } : undefined}
            aria-label="Request state"
            options={[
              { value: 'OPEN', label: 'In progress' },
              { value: 'CLOSED', label: 'Completed' },
              { value: 'ALL', label: 'All' },
            ]}
          />
          <Select
            allowClear
            style={{ width: phone ? '100%' : 240 }}
            placeholder="All request types"
            aria-label="Request type"
            value={type}
            onChange={setType}
            options={REQUEST_HUB_TYPES.map((t) => ({
              value: t,
              label: REQUEST_HUB_TYPE_LABELS[t],
            }))}
          />
        </div>
        <DataTable<RequestHubItem>
          rowKey={(r) => `${r.type}:${r.id}`}
          loading={isLoading || isFetching}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={data.length > 25 ? { pageSize: 25 } : false}
          onRowOpen={(r) => navigate(r.link)}
          empty={
            <EmptyState
              kind={filtered ? 'no-results' : 'empty'}
              illustration="inbox"
              title={state === 'OPEN' ? 'Nothing in progress.' : 'No requests yet.'}
              description={
                type !== undefined
                  ? 'Try another request type, or clear the filter.'
                  : 'Requests you raise — leave, profile changes, helpdesk — show their progress here.'
              }
            />
          }
          columns={[
            {
              title: 'Type',
              dataIndex: 'type',
              render: (t: RequestHubType) => (
                <StatusChip tone="neutral">{REQUEST_HUB_TYPE_LABELS[t]}</StatusChip>
              ),
            },
            {
              title: 'Request',
              dataIndex: 'title',
              render: (_: string, r) => (
                <span style={{ display: 'flex', flexDirection: 'column', minWidth: 220 }}>
                  <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.title}</span>
                  {r.detail && (
                    <span style={{ fontSize: fs.sm, color: v.textSecondary }}>{r.detail}</span>
                  )}
                  {r.autoClosesAt && (
                    <span style={{ fontSize: fs.sm, color: v.warningText }}>
                      Closes automatically on {formatDate(r.autoClosesAt)} unless you reply
                    </span>
                  )}
                </span>
              ),
            },
            {
              title: 'Status',
              dataIndex: 'statusLabel',
              render: (label: string, r) => <StatusChip tone={toneFor(r)}>{label}</StatusChip>,
            },
            {
              title: 'Submitted',
              dataIndex: 'submittedAt',
              render: (d: string) => <span className="ws-num">{formatDate(d)}</span>,
            },
            {
              title: 'Last update',
              dataIndex: 'updatedAt',
              render: (d: string) => <span className="ws-num">{formatDateTime(d)}</span>,
            },
          ]}
          mobile={{
            title: (r) => r.title,
            subtitle: (r) => (
              <>
                {REQUEST_HUB_TYPE_LABELS[r.type]}
                {r.detail ? ` · ${r.detail}` : ''}
                {r.autoClosesAt && (
                  <span style={{ display: 'block', color: v.warningText }}>
                    Closes automatically on {formatDate(r.autoClosesAt)} unless you reply
                  </span>
                )}
              </>
            ),
            status: (r) => <StatusChip tone={toneFor(r)}>{r.statusLabel}</StatusChip>,
            fields: [
              { label: 'Submitted', render: (r) => formatDate(r.submittedAt) },
              { label: 'Last update', render: (r) => formatDateTime(r.updatedAt) },
            ],
          }}
        />
      </Panel>
    </div>
  );
}
