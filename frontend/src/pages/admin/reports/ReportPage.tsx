import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Button, DatePicker, Segmented, Select, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { DownloadOutlined, TeamOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { REPORT_CATALOG, type ReportColumn, type ReportColumnType, type ReportKey } from "@shared/constants/reports";
import * as reportsApi from "../../../api/reports";
import type { ReportQuery } from "../../../api/reports";
import * as orgApi from "../../../api/org";
import * as leaveApi from "../../../api/leave";
import { ProvisionalRateAlert } from "../../../components/leave/ProvisionalRateAlert";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, CardGrid, DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, Skel, SkeletonStats, Stack, StatCard, StatusChip, toast, toneForStatus, useIsPhone, type ChipTone, type MobileCardSpec } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { BreakdownChart } from "./ReportCharts";
import { CHART_HEIGHT, chartKindOf } from "./reportChartKinds";

const { Text } = Typography;

type Row = Record<string, string | number | null>;

const ymd = (d: Dayjs) => d.format("YYYY-MM-DD");

// The same defaults the server applies when a filter is left out — set
// explicitly here so the pickers show what's being reported.
function defaultQuery(key: ReportKey): ReportQuery {
  const today = dayjs();
  switch (key) {
    case "joiners":
    case "lop":
    case "late-coming":
    case "excess-hours":
    case "exception-summary":
    case "attendance-muster":
      return { from: ymd(today.startOf("month")), to: ymd(today) };
    case "leavers":
      return { from: ymd(today.startOf("year")), to: ymd(today) };
    case "celebrations":
      return { from: ymd(today), to: ymd(today.add(30, "day")), kind: "all" };
    default:
      return { asOf: ymd(today) };
  }
}

const EMPLOYMENT_TYPES = [
  { value: "PERMANENT", label: "Permanent" },
  { value: "CONTRACT", label: "Contract" },
  { value: "INTERN", label: "Intern" },
  { value: "CONSULTANT", label: "Consultant" },
  { value: "PROBATION", label: "Probation" },
];

const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function formatValue(val: unknown, type: ReportColumnType | undefined): string {
  if (val === null || val === undefined || val === "") return "—";
  switch (type) {
    case "date":
      return dayjs(val as string).format("DD MMM YYYY");
    case "money":
      return money(val as number);
    case "percent":
      return `${((val as number) * 100).toFixed(1)}%`;
    case "number":
      return (val as number).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    default:
      return String(val);
  }
}

const isNumeric = (t: ReportColumnType | undefined) => t === "number" || t === "money" || t === "percent";

// Text columns that read as a status word: shown as chips (always with the word, never colour alone).
const CHIP_COLUMNS = new Set(["status", "kind", "origin"]);
function chipTone(key: string, val: string): ChipTone {
  if (key === "kind") return val === "Birthday" ? "purple" : "info";
  if (key === "origin") return /device/i.test(val) ? "success" : "neutral";
  if (val === "Separated") return "danger";
  return toneForStatus(val.toUpperCase().replace(/[\s-]+/g, "_"));
}

function renderCell(c: ReportColumn, val: unknown, row: Row) {
  if (c.key === "name" && typeof val === "string" && val) {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
        <InitialsAvatar name={val} size={32} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontWeight: fw.semibold, color: v.textPrimary, whiteSpace: "nowrap" }}>{val}</span>
          {typeof row.employeeCode === "string" && <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{row.employeeCode}</span>}
        </span>
      </span>
    );
  }
  if (CHIP_COLUMNS.has(c.key) && typeof val === "string" && val) return <StatusChip tone={chipTone(c.key, val)}>{val}</StatusChip>;
  const text = formatValue(val, c.type);
  return isNumeric(c.type) ? <span style={{ fontVariantNumeric: "tabular-nums" }}>{text}</span> : text;
}

function tableColumns(columns: ReportColumn[]): ColumnsType<Row> {
  return columns.map((c) => ({
    title: c.header,
    dataIndex: c.key,
    key: c.key,
    align: isNumeric(c.type) ? ("right" as const) : undefined,
    render: (val: unknown, row: Row) => renderCell(c, val, row),
    sorter: (a: Row, b: Row) => {
      const x = a[c.key];
      const y = b[c.key];
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x ?? "").localeCompare(String(y ?? ""));
    },
  }));
}

/** How a report row reads as a stacked card on phones: the person (or first column) as the title, a status chip, then up to four fields. */
function mobileSpec(columns: ReportColumn[]): MobileCardSpec<Row> {
  const hasName = columns.some((c) => c.key === "name");
  const statusCol = columns.find((c) => CHIP_COLUMNS.has(c.key) && c.key !== "origin");
  const first = columns[0];
  const skip = new Set([hasName ? "name" : first?.key, "employeeCode", statusCol?.key]);
  const fields = columns.filter((c) => !skip.has(c.key)).slice(0, 4);
  return {
    avatar: hasName ? (r) => (typeof r.name === "string" ? <InitialsAvatar name={r.name} size={36} /> : null) : undefined,
    title: (r) => (hasName ? (r.name ?? "—") : first ? formatValue(r[first.key], first.type) : "—"),
    subtitle: (r) => (hasName ? [r.employeeCode, r.department].filter(Boolean).join(" · ") : null),
    status: statusCol ? (r) => (typeof r[statusCol.key] === "string" && r[statusCol.key] ? <StatusChip tone={chipTone(statusCol.key, String(r[statusCol.key]))}>{r[statusCol.key]}</StatusChip> : null) : undefined,
    fields: fields.map((c) => ({ label: c.header, render: (r) => renderCell(c, r[c.key], r) })),
  };
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// One page per report (Phase 5 commit F): its filters, summary tiles,
// breakdowns, the list and an Excel export of exactly those rows. Everything
// is computed server-side over the viewer's data scope.
export function ReportPage({ reportKey }: { reportKey: ReportKey }) {
  const info = REPORT_CATALOG[reportKey];
  const phone = useIsPhone();
  const { hasPermission } = useAuth();
  const allowed = hasPermission("reports.view") && (!info.extraPermission || hasPermission(info.extraPermission));
  const [query, setQuery] = useState<ReportQuery>(() => defaultQuery(reportKey));
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState({ current: 1, pageSize: 25 });
  const has = (f: (typeof info.filters)[number]) => info.filters.includes(f);

  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["reports", reportKey, query],
    queryFn: () => reportsApi.run(reportKey, query),
    enabled: allowed,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, enabled: allowed, staleTime: 30_000 });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true), enabled: allowed, staleTime: 30_000 });
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes, enabled: allowed && has("leaveType"), staleTime: 30_000 });
  const columns = useMemo(() => tableColumns(data?.columns ?? []), [data?.columns]);
  const mobile = useMemo(() => mobileSpec(data?.columns ?? []), [data?.columns]);

  if (!allowed)
    return (
      <EmptyState
        kind="forbidden"
        title={`You can't open ${info.title}`}
        description={info.extraPermission ? "This report is limited to people who can see salary-derived figures." : undefined}
      />
    );

  // A new filter is a new result: back to its first page.
  const update = (next: (q: ReportQuery) => ReportQuery) => {
    setQuery(next);
    setPage((p) => ({ ...p, current: 1 }));
  };
  const set = (patch: Partial<ReportQuery>) => update((q) => ({ ...q, ...patch }));
  const reset = () => update(() => defaultQuery(reportKey));
  async function doExport() {
    setExporting(true);
    try {
      saveBlob(await reportsApi.exportXlsx(reportKey, query), `${reportKey}-${ymd(dayjs())}.xlsx`);
    } catch (e) {
      toast.error(apiErrorMessage(e, "Couldn't export the report."));
    } finally {
      setExporting(false);
    }
  }

  const rows = data?.rows ?? [];
  const rateMissing = (data?.warnings ?? []).some((w) => w.startsWith("No encashment daily rate"));
  const activeFilters = [query.departmentId, query.locationId, query.employmentType, query.leaveTypeId].filter(Boolean).length;
  const charts = (data?.breakdowns ?? []).map((b) => ({ b, kind: chartKindOf(b) }));
  const selectWidth = phone ? "100%" : 180;

  const filters = (
    <>
      {has("asOf") && <DatePicker allowClear={false} format="DD MMM YYYY" value={dayjs(query.asOf)} onChange={(d) => d && set({ asOf: ymd(d) })} prefix={<Text type="secondary">As of</Text>} style={{ width: phone ? "100%" : undefined }} />}
      {has("range") && (
        <DatePicker.RangePicker
          allowClear={false}
          format="DD MMM YYYY"
          value={[dayjs(query.from), dayjs(query.to)]}
          onChange={(r) => r?.[0] && r[1] && set({ from: ymd(r[0]), to: ymd(r[1]) })}
          style={{ width: phone ? "100%" : undefined }}
        />
      )}
      {has("celebrationKind") && (
        <Segmented
          value={query.kind ?? "all"}
          onChange={(val) => set({ kind: val as ReportQuery["kind"] })}
          options={[
            { value: "all", label: "Both" },
            { value: "birthday", label: "Birthdays" },
            { value: "anniversary", label: "Anniversaries" },
          ]}
        />
      )}
      {has("department") && (
        <Select allowClear showSearch optionFilterProp="label" placeholder="All departments" aria-label="Department" style={{ width: selectWidth }} value={query.departmentId} onChange={(val) => set({ departmentId: val })} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
      )}
      {has("location") && (
        <Select allowClear showSearch optionFilterProp="label" placeholder="All branches" aria-label="Branch" style={{ width: selectWidth }} value={query.locationId} onChange={(val) => set({ locationId: val })} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
      )}
      {has("employmentType") && <Select allowClear placeholder="All employment types" aria-label="Employment type" style={{ width: phone ? "100%" : 200 }} value={query.employmentType} onChange={(val) => set({ employmentType: val })} options={EMPLOYMENT_TYPES} />}
      {has("leaveType") && <Select allowClear placeholder="All leave types" aria-label="Leave type" style={{ width: selectWidth }} value={query.leaveTypeId} onChange={(val) => set({ leaveTypeId: val })} options={leaveTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))} />}
      {!phone && (
        <Button type="link" onClick={() => reset()}>
          Reset
        </Button>
      )}
    </>
  );

  return (
    <>
      <PageHeader
        title={info.title}
        breadcrumb={[{ label: "Reports", to: "/admin/reports" }, { label: info.title }]}
        tags={
          data?.scope === "team" && (
            <StatusChip tone="info" icon={<TeamOutlined />}>
              Showing your team only
            </StatusChip>
          )
        }
        actions={
          <Button type="primary" size="large" icon={<DownloadOutlined />} onClick={() => void doExport()} loading={exporting} disabled={!data} block={phone}>
            Export to Excel
          </Button>
        }
      />
      <Stack>
        {reportKey === "leave-liability" && data?.rateProvisional && <ProvisionalRateAlert rateMissing={rateMissing} />}

        <Panel title="Overview" subtitle={info.description}>
          <FilterBar filters={filters} activeCount={activeFilters} onClear={() => reset()} />

          {(data?.warnings ?? [])
            .filter((w) => !(reportKey === "leave-liability" && w.startsWith("No encashment daily rate")))
            .map((w) => (
              <ApprovalBanner key={w} tone="warning" title={w} style={{ marginBottom: space[5] }} />
            ))}

          {isLoading && !data ? (
            <>
              <SkeletonStats count={3} />
              <div style={{ marginTop: space[6] }}>
                <Skel h={CHART_HEIGHT} r={radius.lg} />
              </div>
            </>
          ) : (
            data && (
              <div style={{ opacity: isFetching ? 0.6 : 1, transition: "opacity 0.15s" }} aria-busy={isFetching}>
                {data.summary.length > 0 && (
                  <CardGrid min={180} gap={space[4]}>
                    {data.summary.map((s) => (
                      <StatCard key={s.label} variant="compact" label={s.label} value={<span style={{ fontVariantNumeric: "tabular-nums" }}>{formatValue(s.value, s.type)}</span>} />
                    ))}
                  </CardGrid>
                )}
                {charts.length > 0 && (
                  <CardGrid min={320} gap={space[4]} style={{ marginTop: data.summary.length > 0 ? space[6] : 0 }}>
                    {charts.map(({ b, kind }) => (
                      <section key={b.title} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: space[5], minWidth: 0 }}>
                        <h3 style={{ margin: `0 0 ${space[4]}px`, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{b.title}</h3>
                        {kind ? (
                          <BreakdownChart breakdown={b} kind={kind} />
                        ) : b.rows.length === 0 ? (
                          <div style={{ height: CHART_HEIGHT, display: "flex", alignItems: "center", justifyContent: "center", color: v.textSecondary, fontSize: fs.sm }}>Nothing to break down.</div>
                        ) : (
                          <DataTable<Row> density="compact" rowKey="label" pagination={false} scroll={{ y: CHART_HEIGHT }} dataSource={b.rows} columns={tableColumns(b.columns)} />
                        )}
                      </section>
                    ))}
                  </CardGrid>
                )}
              </div>
            )
          )}
        </Panel>

        <Panel title={data ? `${data.rows.length} row${data.rows.length === 1 ? "" : "s"}` : "Rows"}>
          <DataTable<Row>
            density={(data?.columns.length ?? 0) > 9 ? "compact" : "comfortable"}
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            rowKey={(r) => (data?.columns ?? []).map((c) => String(r[c.key] ?? "")).join("|")}
            dataSource={phone ? rows.slice((page.current - 1) * page.pageSize, page.current * page.pageSize) : rows}
            columns={columns}
            mobile={mobile}
            empty={<EmptyState kind="no-results" compact title="Nothing in this report" description="Try a wider date range or clear a filter." />}
            pagination={{ current: page.current, pageSize: page.pageSize, total: rows.length, hideOnSinglePage: true, onChange: (current, pageSize) => setPage({ current, pageSize }) }}
          />
        </Panel>

        {data && data.notes.length > 0 && (
          <div>
            {data.notes.map((n) => (
              <p key={n} style={{ margin: `0 0 ${space[1]}px`, color: v.textSecondary, fontSize: fs.sm }}>
                {n}
              </p>
            ))}
          </div>
        )}
      </Stack>
    </>
  );
}
