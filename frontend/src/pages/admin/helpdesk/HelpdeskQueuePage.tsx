import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { HELPDESK_STATUSES, type HelpdeskStatus } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../../api/helpdesk";
import type { HelpdeskTicketSummary } from "../../../api/helpdesk";
import { PriorityTag, SensitiveChip, StatusTag } from "../../../components/helpdesk/HelpdeskBits";
import { formatDateTime } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, Stack } from "../../../ui";

const STATUS_LABEL: Record<HelpdeskStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_ON_EMPLOYEE: "Waiting on employee", RESOLVED: "Resolved", CLOSED: "Closed" };
const PAGE_SIZE = 25;

// The HR queue (helpdesk.manage). Sensitive categories only appear for
// holders of helpdesk.sensitive.view — the server decides, this just shows.
// Refreshes live on helpdesk.queue (sockets/useHelpdeskRealtime.ts).
export function HelpdeskQueuePage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<HelpdeskStatus | undefined>();
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [assignee, setAssignee] = useState<string | undefined>();
  const [page, setPage] = useState(1);

  const { data: categories = [] } = useQuery({ queryKey: ["helpdesk", "categories", "all"], queryFn: helpdeskApi.listAllCategories });
  const { data, isLoading, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ["helpdesk", "queue", { status, categoryId, assignee, page }],
    queryFn: () => helpdeskApi.listQueue({ status, categoryId, assignee, page, pageSize: PAGE_SIZE }),
    placeholderData: keepPreviousData,
  });
  const activeCount = [status, categoryId, assignee].filter(Boolean).length;
  const clear = () => {
    setStatus(undefined);
    setCategoryId(undefined);
    setAssignee(undefined);
    setPage(1);
  };
  const filterWidth = (w: number) => ({ width: "100%", maxWidth: w, minWidth: 160 });

  return (
    <>
      <PageHeader title="Helpdesk" subtitle="Tickets raised by employees — updates live as they come in" />
      <Stack>
        <Panel title="Queue" subtitle={data ? `${data.total} ticket${data.total === 1 ? "" : "s"}` : undefined}>
          <FilterBar
            activeCount={activeCount}
            onClear={clear}
            filters={
              <>
                <Select
                  style={filterWidth(220)}
                  allowClear
                  aria-label="Status"
                  placeholder="Active (not closed)"
                  value={status}
                  onChange={(val) => {
                    setStatus(val);
                    setPage(1);
                  }}
                  options={HELPDESK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                />
                <Select
                  style={filterWidth(240)}
                  allowClear
                  aria-label="Category"
                  placeholder="All categories"
                  value={categoryId}
                  onChange={(val) => {
                    setCategoryId(val);
                    setPage(1);
                  }}
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                  style={filterWidth(200)}
                  allowClear
                  aria-label="Assignee"
                  placeholder="Anyone"
                  value={assignee}
                  onChange={(val) => {
                    setAssignee(val);
                    setPage(1);
                  }}
                  options={[
                    { value: "me", label: "Assigned to me" },
                    { value: "unassigned", label: "Unassigned" },
                  ]}
                />
              </>
            }
          />
          <DataTable<HelpdeskTicketSummary>
            rowKey="id"
            loading={isLoading || isPlaceholderData}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.items}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: setPage, hideOnSinglePage: true }}
            onRowOpen={(t) => navigate(`/admin/employee/helpdesk/${t.id}`)}
            empty={
              <EmptyState
                illustration="inbox"
                title={activeCount ? "No tickets match these filters" : "The queue is clear"}
                description={activeCount ? "Try another status, category or assignee." : "New tickets appear here the moment they're raised."}
                compact
              />
            }
            columns={[
              { title: "Ticket", dataIndex: "number", width: 120, render: (n: string) => <span style={{ color: v.textSecondary, fontVariantNumeric: "tabular-nums" }}>{n}</span> },
              { title: "Subject", dataIndex: "subject", render: (s: string) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{s}</span> },
              {
                title: "Employee",
                key: "raisedBy",
                render: (_: unknown, t) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                    <InitialsAvatar name={t.raisedBy.name} size={28} />
                    <span>
                      {t.raisedBy.name} <span style={{ color: v.textSecondary, fontSize: fs.sm }}>({t.raisedBy.employeeCode})</span>
                    </span>
                  </span>
                ),
              },
              {
                title: "Category",
                key: "category",
                render: (_: unknown, t) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                    {t.category.name}
                    {t.category.isSensitive && <SensitiveChip />}
                  </span>
                ),
              },
              { title: "Priority", dataIndex: "priority", render: (_: unknown, t) => <PriorityTag priority={t.priority} /> },
              { title: "Status", dataIndex: "status", render: (_: unknown, t) => <StatusTag status={t.status} viewer="hr" /> },
              { title: "Assignee", key: "assignee", render: (_: unknown, t) => t.assignee?.name ?? <span style={{ color: v.textSecondary }}>Unassigned</span> },
              { title: "Last update", dataIndex: "lastActivityAt", render: (d: string) => formatDateTime(d) },
            ]}
            mobile={{
              title: (t) => t.subject,
              subtitle: (t) => `${t.number} · ${t.raisedBy.name} (${t.raisedBy.employeeCode})`,
              status: (t) => <StatusTag status={t.status} viewer="hr" />,
              fields: [
                {
                  label: "Category",
                  render: (t) => (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                      {t.category.name}
                      {t.category.isSensitive && <SensitiveChip />}
                    </span>
                  ),
                },
                { label: "Priority", render: (t) => <PriorityTag priority={t.priority} /> },
                { label: "Assignee", render: (t) => t.assignee?.name ?? "Unassigned" },
                { label: "Last update", render: (t) => formatDateTime(t.lastActivityAt) },
              ],
            }}
          />
        </Panel>
      </Stack>
    </>
  );
}
