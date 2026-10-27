import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Input } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import * as auditLogApi from "../../../api/auditLog";
import type { AuditLogRow } from "../../../api/auditLog";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, FilterBar, InitialsAvatar, KeyValueGrid, PageHeader, Panel, SideDrawer, Stack, StatusChip, Timeline, useDebouncedValue, useIsPhone } from "../../../ui";

const { RangePicker } = DatePicker;

const actorText = (r: AuditLogRow) => (r.actorName ? `${r.actorName} (${r.actorEmployeeCode})${r.onBehalfOfName ? ` on behalf of ${r.onBehalfOfName}` : ""}` : "System");

/** "Name did ACTION on Entity" — the activity sentence (recruitment-08). */
function Sentence({ r }: { r: AuditLogRow }) {
  return (
    <span>
      <strong style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.actorName ?? "System"}</strong>
      {r.onBehalfOfName && <span style={{ color: v.textSecondary }}> on behalf of {r.onBehalfOfName}</span>} <code style={{ fontSize: fs.sm, color: v.textPrimary }}>{r.action}</code> on{" "}
      <strong style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.entityType}</strong>
    </span>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div style={{ fontSize: fs.sm, fontWeight: fw.semibold, color: v.textSecondary, marginBottom: space[1] }}>{label}</div>
      <pre
        tabIndex={0}
        aria-label={`${label} value`}
        style={{ background: v.bgSubtle, color: v.textBody, border: `1px solid ${v.borderDefault}`, padding: space[3], borderRadius: radius.sm, maxHeight: 280, overflow: "auto", margin: 0, fontSize: fs.sm, whiteSpace: "pre-wrap", wordBreak: "break-word" }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export function AuditLogPage({ payroll = false }: { payroll?: boolean } = {}) {
  const phone = useIsPhone();
  const [actorSearch, setActorSearch] = useState("");
  const [entityTypeText, setEntityTypeText] = useState("");
  const [actionText, setActionText] = useState("");
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detail, setDetail] = useState<AuditLogRow | null>(null);
  // Free-text filters settle before they query, like the search box.
  const entityType = useDebouncedValue(entityTypeText, 250);
  const action = useDebouncedValue(actionText, 250);

  const query = {
    actorSearch: actorSearch || undefined,
    entityType: entityType || undefined,
    action: action || undefined,
    dateFrom: dateRange?.[0]?.format("YYYY-MM-DD"),
    dateTo: dateRange?.[1]?.format("YYYY-MM-DD"),
    page,
    pageSize,
  };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["audit-log", payroll ? "payroll" : "all", query],
    queryFn: () => auditLogApi.listAuditLogs(query, payroll ? "payroll" : "all"),
    placeholderData: keepPreviousData,
  });

  const activeCount = [entityTypeText, actionText].filter(Boolean).length + (dateRange ? 1 : 0);
  const clear = () => {
    setEntityTypeText("");
    setActionText("");
    setDateRange(null);
    setPage(1);
  };
  const filtered = activeCount > 0 || Boolean(actorSearch);

  return (
    <>
      <PageHeader
        title={payroll ? "Payroll Audit Trail" : "Audit Log"}
        subtitle={
          payroll
            ? "Who prepared, confirmed, approved and carried out each payroll step, and when. It records that something changed, never a secret value."
            : "Every recorded change: who did it, to what, and when. Open an entry to see what it looked like before and after."
        }
      />
      <Stack>
        <Panel>
          <FilterBar
            onSearch={(s) => {
              setActorSearch(s);
              setPage(1);
            }}
            searchValue={actorSearch}
            searchPlaceholder="Actor (name or code)"
            activeCount={activeCount}
            onClear={clear}
            filters={
              <>
                <Input
                  placeholder="Entity type"
                  aria-label="Entity type"
                  value={entityTypeText}
                  onChange={(e) => {
                    setEntityTypeText(e.target.value);
                    setPage(1);
                  }}
                  style={{ width: phone ? "100%" : 180 }}
                  allowClear
                />
                <Input
                  placeholder="Action"
                  aria-label="Action"
                  value={actionText}
                  onChange={(e) => {
                    setActionText(e.target.value);
                    setPage(1);
                  }}
                  style={{ width: phone ? "100%" : 200 }}
                  allowClear
                />
                <RangePicker
                  aria-label="Date range"
                  value={dateRange}
                  style={{ width: phone ? "100%" : undefined }}
                  onChange={(val) => {
                    setDateRange(val as [Dayjs | null, Dayjs | null] | null);
                    setPage(1);
                  }}
                />
              </>
            }
          />
          <DataTable<AuditLogRow>
            rowKey="id"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.rows ?? []}
            onRowOpen={setDetail}
            empty={
              filtered ? (
                <EmptyState kind="no-results" compact title="No matching audit entries" description="Try a wider date range or fewer filters." action={<Button onClick={clear}>Clear filters</Button>} />
              ) : (
                <EmptyState compact title="No audit entries yet" description="Changes people make will be recorded here as they happen." />
              )
            }
            pagination={{
              current: page,
              pageSize,
              total: data?.total ?? 0,
              onChange: (p, ps) => {
                setPage(p);
                setPageSize(ps);
              },
            }}
            columns={[
              { title: "When", dataIndex: "createdAt", width: 160, render: (val: string) => dayjs(val).format("DD-MMM-YYYY HH:mm") },
              {
                title: "Actor",
                key: "actor",
                render: (_: unknown, r) => (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                    <InitialsAvatar name={r.actorName ?? "System"} size={28} />
                    <span>{actorText(r)}</span>
                  </span>
                ),
              },
              { title: "Action", dataIndex: "action", render: (val: string) => <code style={{ fontSize: fs.sm, color: v.textPrimary }}>{val}</code> },
              { title: "Entity", key: "entity", render: (_: unknown, r) => `${r.entityType} · ${r.entityId}` },
              { title: "IP", dataIndex: "ipAddress", render: (val: string | null) => val ?? "—" },
              {
                title: "",
                key: "actions",
                align: "right",
                render: (_: unknown, r) => (
                  <Button type="link" onClick={() => setDetail(r)} aria-label={`Details of ${r.action} on ${r.entityType}`}>
                    Details <ArrowRightOutlined aria-hidden />
                  </Button>
                ),
              },
            ]}
            mobile={{
              avatar: (r) => <InitialsAvatar name={r.actorName ?? "System"} size={36} />,
              title: (r) => <Sentence r={r} />,
              subtitle: (r) => dayjs(r.createdAt).format("DD-MMM-YYYY HH:mm"),
              fields: [
                { label: "Entity ID", render: (r) => r.entityId },
                { label: "IP", render: (r) => r.ipAddress ?? "—" },
              ],
              actions: (r) => (
                <Button block onClick={() => setDetail(r)}>
                  Details
                </Button>
              ),
            }}
          />
        </Panel>
      </Stack>

      <SideDrawer open={!!detail} onClose={() => setDetail(null)} title="Audit entry" status={detail ? <StatusChip tone="neutral">{detail.entityType}</StatusChip> : undefined} size="wide" footer={null}>
        {detail && (
          <Stack gap={space[5]}>
            <Timeline
              items={[
                {
                  key: detail.id,
                  marker: <InitialsAvatar name={detail.actorName ?? "System"} size={32} />,
                  content: <Sentence r={detail} />,
                  time: dayjs(detail.createdAt).format("DD-MMM-YYYY HH:mm:ss"),
                },
              ]}
            />
            <KeyValueGrid
              columns={1}
              items={[
                { label: "Actor", value: actorText(detail) },
                { label: "Action", value: detail.action },
                { label: "Entity", value: `${detail.entityType} (${detail.entityId})` },
                { label: "When", value: dayjs(detail.createdAt).format("DD-MMM-YYYY HH:mm:ss") },
                ...(detail.ipAddress ? [{ label: "IP address", value: detail.ipAddress }] : []),
              ]}
            />
            {detail.before !== null && <JsonBlock label="Before" value={detail.before} />}
            {detail.after !== null && <JsonBlock label="After" value={detail.after} />}
            <Button onClick={() => setDetail(null)} style={{ alignSelf: "flex-start" }}>
              Close
            </Button>
          </Stack>
        )}
      </SideDrawer>
    </>
  );
}

/** The Payroll audit trail: the same viewer, restricted to payroll's own rows. */
export function PayrollAuditPage() {
  return <AuditLogPage payroll />;
}
