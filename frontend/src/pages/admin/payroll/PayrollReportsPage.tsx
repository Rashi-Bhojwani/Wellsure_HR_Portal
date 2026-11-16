import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Input, Select, Table, Typography } from "antd";
import { DownloadOutlined, SettingOutlined } from "@ant-design/icons";
import dayjs, { type Dayjs } from "dayjs";
import { PAYROLL_REPORT_KEYS, PAYROLL_REPORTS, type PayrollReportBranchGroup, type PayrollReportColumnDef, type PayrollReportFilter, type PayrollReportKey } from "@shared/constants/payrollReports";
import * as reportsApi from "../../../api/payrollReports";
import type { ReportFilters } from "../../../api/payrollReports";
import { departments, listLocations } from "../../../api/org";
import { listEntities } from "../../../api/legalEntities";
import { saveBlob } from "../../../api/muster";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, FilterBar, PageHeader, Panel, SideDrawer, StatusChip, toast } from "../../../ui";
import { space, fs, v } from "../../../theme/tokens";

// Payroll > Reports (Stage 6, docs/plans/STAGE_6_PAYROLL_REPORTS.md), directors only. Every figure is an exact decimal string the API added up from finalised runs; the
// screen only formats it. Columns: the report's conventional set ("Default, change in settings") until a director saves a company layout (with a reason, audited).
type Row = Record<string, string | number | null>;

function startingFilters(): Required<Pick<ReportFilters, "month" | "compareMonth" | "fromMonth" | "toMonth" | "fromDate" | "toDate" | "asOf">> {
  const last = dayjs().subtract(1, "month");
  return {
    month: last.format("YYYY-MM"),
    compareMonth: last.subtract(1, "month").format("YYYY-MM"),
    fromMonth: dayjs().startOf("year").format("YYYY-MM"),
    toMonth: dayjs().format("YYYY-MM"),
    fromDate: dayjs().startOf("year").format("YYYY-MM-DD"),
    toDate: dayjs().format("YYYY-MM-DD"),
    asOf: dayjs().format("YYYY-MM-DD"),
  };
}

function show(value: string | number | null | undefined, type: PayrollReportColumnDef["type"]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (type === "money") return formatRupees(String(value), 2);
  if (type === "percent") return `${value}%`;
  if (type === "date") return dayjs(String(value)).isValid() ? dayjs(String(value)).format("D MMM YYYY") : String(value);
  return String(value);
}
const numeric = (t: PayrollReportColumnDef["type"]) => t === "money" || t === "number" || t === "percent";

const MONTH_FILTERS: Partial<Record<PayrollReportFilter, string>> = { month: "Month", compareMonth: "Compare with", fromMonth: "From month", toMonth: "To month" };
const DATE_FILTERS: Partial<Record<PayrollReportFilter, string>> = { fromDate: "From", toDate: "To", asOf: "As of" };

export function PayrollReportsPage() {
  const queryClient = useQueryClient();
  const [key, setKey] = useState<PayrollReportKey>("payroll-summary");
  const [filters, setFilters] = useState<ReportFilters>(startingFilters);
  const [chosenByReport, setChosenByReport] = useState<Partial<Record<PayrollReportKey, string[]>>>({});
  const [drawer, setDrawer] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);

  const def = PAYROLL_REPORTS[key];
  const applied: ReportFilters = useMemo(() => Object.fromEntries(def.filters.map((f) => [f, filters[f]]).filter(([, val]) => val)), [def, filters]);
  const cat = useQuery({ queryKey: ["payroll-reports", "catalog"], queryFn: reportsApi.catalog });
  const report = useQuery({ queryKey: ["payroll-reports", key, applied], queryFn: () => reportsApi.runReport(key, applied) });
  const deps = useQuery({ queryKey: ["org", "departments"], queryFn: departments.list, enabled: def.filters.includes("department") });
  const locs = useQuery({ queryKey: ["org", "locations"], queryFn: () => listLocations(), enabled: def.filters.includes("location") });
  const companies = useQuery({ queryKey: ["legal-entities"], queryFn: listEntities, enabled: def.filters.includes("company") }); // part 3 B1

  const layout = report.data?.layout ?? cat.data?.find((r) => r.key === key)?.layout;
  const chosen = chosenByReport[key] ?? layout?.columns ?? def.columns.filter((c) => c.on).map((c) => c.key);
  // Part 3 B3: a register's head columns come from the data (one per pay head) and are always shown.
  const columns = (report.data?.key === key ? report.data.columns : def.columns).filter((c) => chosen.includes(c.key) || !def.columns.some((d) => d.key === c.key));
  const totals = report.data?.totals ?? {};
  const hasTotals = columns.some((c) => totals[c.key] !== undefined);

  const save = useMutation({
    mutationFn: () => reportsApi.saveLayout(key, draft, reason.trim()),
    onSuccess: () => {
      toast.success("Saved as the company layout for this report.");
      setChosenByReport((s) => ({ ...s, [key]: undefined }));
      setDrawer(false);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["payroll-reports"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the layout.")),
  });

  const doExport = async (format: "xlsx" | "csv") => {
    setExporting(format);
    try {
      const blob = await reportsApi.exportReport(key, applied, format, chosen);
      saveBlob(blob, `${key}-${dayjs().format("YYYY-MM-DD")}.${format}`);
      toast.success(`Exported as .${format}.`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not export the report."));
    } finally {
      setExporting(null);
    }
  };

  const setFilter = (f: PayrollReportFilter, value: string | undefined) => setFilters((s) => ({ ...s, [f]: value }));
  const filterControls = def.filters.map((f) => {
    if (MONTH_FILTERS[f])
      return (
        <DatePicker key={f} picker="month" aria-label={MONTH_FILTERS[f]} placeholder={MONTH_FILTERS[f]} allowClear={false} format="MMM YYYY" value={filters[f] ? dayjs(`${filters[f]}-01`) : null} onChange={(d: Dayjs | null) => setFilter(f, d?.format("YYYY-MM"))} style={{ minWidth: 140 }} />
      );
    if (DATE_FILTERS[f])
      return <DatePicker key={f} aria-label={DATE_FILTERS[f]} placeholder={DATE_FILTERS[f]} allowClear={false} format="D MMM YYYY" value={filters[f] ? dayjs(filters[f]) : null} onChange={(d: Dayjs | null) => setFilter(f, d?.format("YYYY-MM-DD"))} style={{ minWidth: 150 }} />;
    if (f === "company")
      return (
        <Select key={f} aria-label="Company" placeholder="All companies" allowClear value={filters.company} onChange={(val?: string) => setFilter(f, val)} loading={companies.isLoading} style={{ minWidth: 170 }} options={[{ value: "MAIN", label: companies.data?.main.name ? `${companies.data.main.name} (main)` : "Main company" }, ...(companies.data?.entities ?? []).map((e) => ({ value: e.id, label: e.name }))]} />
      );
    // Cleanup C1: group by branch (Organisation Setup, Branches); the report's rows and totals stay as they are, each branch's totals are added below.
    if (f === "groupBy")
      return (
        <Checkbox key={f} checked={filters.groupBy === "branch"} onChange={(e) => setFilter(f, e.target.checked ? "branch" : undefined)} style={{ alignSelf: "center", minHeight: 44, display: "inline-flex", alignItems: "center" }}>
          Group by branch
        </Checkbox>
      );
    const isDep = f === "department";
    const items = isDep ? (deps.data ?? []).map((d) => ({ value: d.id, label: d.name })) : [...(locs.data ?? []).map((l) => ({ value: l.id, label: l.name })), { value: "NONE", label: "No branch" }];
    return (
      <Select key={f} aria-label={isDep ? "Department" : "Branch"} placeholder={isDep ? "All departments" : "All branches"} allowClear showSearch optionFilterProp="label" value={filters[f]} onChange={(val?: string) => setFilter(f, val)} options={items} loading={isDep ? deps.isLoading : locs.isLoading} style={{ minWidth: 170 }} />
    );
  });
  const activeOrg = (def.filters.includes("department") && filters.department ? 1 : 0) + (def.filters.includes("location") && filters.location ? 1 : 0) + (def.filters.includes("company") && filters.company ? 1 : 0) + (def.filters.includes("groupBy") && filters.groupBy ? 1 : 0);
  // C1: the columns that have a total, for the branch table.
  const groups = report.data?.key === key ? report.data.groups : undefined;
  const groupColumns = columns.filter((c) => totals[c.key] !== undefined);

  return (
    <>
      <PageHeader
        title="Payroll reports"
        subtitle="Added up from finalised payroll runs, to the paisa. Directors only; every export is recorded."
        actions={<Select aria-label="Report" value={key} onChange={(k: PayrollReportKey) => setKey(k)} options={PAYROLL_REPORT_KEYS.map((k) => ({ value: k, label: PAYROLL_REPORTS[k].title }))} style={{ minWidth: 240 }} />}
      />
      <Panel
        title={def.title}
        extra={layout?.isDefault ? <StatusChip tone="neutral">{layout.label ?? "Default, change in settings"}</StatusChip> : layout ? <StatusChip tone="info">Company layout</StatusChip> : null}
        style={{ marginBottom: space[4] }}
      >
        <Typography.Paragraph style={{ color: v.textSecondary, fontSize: fs.sm, marginBottom: space[3] }}>{def.description}</Typography.Paragraph>
        {layout && !layout.isDefault && layout.savedAt && (
          <Typography.Paragraph style={{ color: v.textSecondary, fontSize: fs.sm, marginBottom: space[3] }}>
            Columns saved {dayjs(layout.savedAt).format("D MMM YYYY")}: {layout.reason}
          </Typography.Paragraph>
        )}
        <FilterBar
          filters={<>{filterControls}</>}
          activeCount={activeOrg}
          onClear={activeOrg ? () => setFilters((s) => ({ ...s, department: undefined, location: undefined, company: undefined, groupBy: undefined })) : undefined}
          actions={
            <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
              <Button icon={<SettingOutlined />} onClick={() => { setDraft(chosen); setDrawer(true); }}>Columns</Button>
              <Button icon={<DownloadOutlined />} loading={exporting === "xlsx"} disabled={!report.data || exporting !== null} onClick={() => void doExport("xlsx")}>Export .xlsx</Button>
              <Button icon={<DownloadOutlined />} loading={exporting === "csv"} disabled={!report.data || exporting !== null} onClick={() => void doExport("csv")}>Export .csv</Button>
            </div>
          }
          style={{ marginBottom: space[3] }}
        />
        {(report.data?.notes ?? []).map((n) => (
          <ApprovalBanner key={n} tone="info" title={n} style={{ marginBottom: space[3] }} />
        ))}
        <DataTable<Row>
          rowKey={(r) => columns.map((c) => String(r[c.key] ?? "")).join("|") + String(r.employeeCode ?? r.cycle ?? r.code ?? r.kind ?? "")}
          loading={report.isLoading}
          error={report.error}
          onRetry={() => void report.refetch()}
          dataSource={report.data?.rows ?? []}
          empty="Nothing to show for these filters. Reports read finalised runs only."
          pagination={{ pageSize: 50 }}
          scroll={{ x: "max-content" }}
          mobile={{
            title: (r) => show(r[columns[0]?.key ?? ""], columns[0]?.type ?? "text"),
            fields: columns.slice(1).map((c) => ({ label: c.header, render: (r: Row) => show(r[c.key], c.type) })),
          }}
          columns={columns.map((c) => ({ title: c.header, key: c.key, align: numeric(c.type) ? ("right" as const) : undefined, render: (_: unknown, r: Row) => show(r[c.key], c.type) }))}
          summary={() =>
            hasTotals && (report.data?.rows.length ?? 0) > 0 ? (
              <Table.Summary.Row>
                {columns.map((c, i) => (
                  <Table.Summary.Cell key={c.key} index={i} align={numeric(c.type) ? "right" : undefined}>
                    <strong>{totals[c.key] !== undefined ? show(totals[c.key], c.type) : i === 0 ? "Total" : ""}</strong>
                  </Table.Summary.Cell>
                ))}
              </Table.Summary.Row>
            ) : null
          }
        />
      </Panel>
      {groups && (
        <Panel title="By branch" subtitle="Each branch's totals, from Organisation Setup, Branches. They add up to the report's total; people with no branch are under No branch." style={{ marginBottom: space[4] }}>
          <DataTable<PayrollReportBranchGroup>
            rowKey="key"
            dataSource={groups}
            empty="No branch has anything for these filters."
            pagination={false}
            scroll={{ x: "max-content" }}
            mobile={{ title: (g) => g.branch, fields: groupColumns.map((c) => ({ label: c.header, render: (g: PayrollReportBranchGroup) => show(g.totals[c.key], c.type) })) }}
            columns={[
              { title: "Branch", key: "branch", render: (_: unknown, g: PayrollReportBranchGroup) => g.branch },
              ...groupColumns.map((c) => ({ title: c.header, key: c.key, align: "right" as const, render: (_: unknown, g: PayrollReportBranchGroup) => show(g.totals[c.key], c.type) })),
            ]}
            summary={() =>
              groups.length > 0 ? (
                <Table.Summary.Row>
                  <Table.Summary.Cell index={0}><strong>Total</strong></Table.Summary.Cell>
                  {groupColumns.map((c, i) => (
                    <Table.Summary.Cell key={c.key} index={i + 1} align="right"><strong>{show(totals[c.key], c.type)}</strong></Table.Summary.Cell>
                  ))}
                </Table.Summary.Row>
              ) : null
            }
          />
        </Panel>
      )}

      <SideDrawer
        open={drawer}
        onClose={() => setDrawer(false)}
        title="Columns"
        subtitle={def.title}
        primaryLabel="Use these columns"
        primaryDisabled={draft.length === 0}
        onPrimary={() => { setChosenByReport((s) => ({ ...s, [key]: def.columns.map((c) => c.key).filter((k) => draft.includes(k)) })); setDrawer(false); }}
        secondaryAction={
          <Button loading={save.isPending} disabled={draft.length === 0 || reason.trim().length < 3} onClick={() => save.mutate()}>
            Save as company layout
          </Button>
        }
      >
        <Typography.Paragraph style={{ color: v.textSecondary, fontSize: fs.sm }}>
          Choose what to see and export. "Use these columns" is for you, now. "Save as company layout" makes it the starting layout for every director (needs a reason; recorded).
        </Typography.Paragraph>
        <Checkbox.Group value={draft} onChange={(vals) => setDraft(vals as string[])} style={{ display: "flex", flexDirection: "column", gap: space[2], marginBottom: space[4] }}>
          {def.columns.map((c) => (
            <Checkbox key={c.key} value={c.key} style={{ minHeight: 32 }}>
              {c.header}
              {c.on ? "" : " (off by default)"}
            </Checkbox>
          ))}
        </Checkbox.Group>
        <label htmlFor="layout-reason" style={{ display: "block", fontSize: fs.sm, marginBottom: space[1] }}>Reason, to save as the company layout</label>
        <Input.TextArea id="layout-reason" rows={2} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this layout suits the company" />
      </SideDrawer>
    </>
  );
}

export default PayrollReportsPage;
