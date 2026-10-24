import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, DatePicker, Flex, Result, Row, Segmented, Select, Space, Statistic, Table, Tag, Typography, message } from "antd";
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
import { fs } from "../../../theme/tokens";

const { Title, Text, Paragraph } = Typography;

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

function formatValue(v: unknown, type: ReportColumnType | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  switch (type) {
    case "date":
      return dayjs(v as string).format("DD MMM YYYY");
    case "money":
      return money(v as number);
    case "percent":
      return `${((v as number) * 100).toFixed(1)}%`;
    case "number":
      return (v as number).toLocaleString("en-IN", { maximumFractionDigits: 2 });
    default:
      return String(v);
  }
}

function tableColumns(columns: ReportColumn[]) {
  return columns.map((c) => ({
    title: c.header,
    dataIndex: c.key,
    key: c.key,
    align: c.type === "number" || c.type === "money" || c.type === "percent" ? ("right" as const) : undefined,
    render: (v: unknown) => formatValue(v, c.type),
    sorter: (a: Record<string, unknown>, b: Record<string, unknown>) => {
      const x = a[c.key];
      const y = b[c.key];
      if (typeof x === "number" && typeof y === "number") return x - y;
      return String(x ?? "").localeCompare(String(y ?? ""));
    },
  }));
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
  const { hasPermission } = useAuth();
  const allowed = hasPermission("reports.view") && (!info.extraPermission || hasPermission(info.extraPermission));
  const [query, setQuery] = useState<ReportQuery>(() => defaultQuery(reportKey));
  const [exporting, setExporting] = useState(false);
  const has = (f: (typeof info.filters)[number]) => info.filters.includes(f);

  const { data, isLoading, isError, error } = useQuery({ queryKey: ["reports", reportKey, query], queryFn: () => reportsApi.run(reportKey, query), enabled: allowed, retry: false });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list, enabled: allowed });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true), enabled: allowed });
  const { data: leaveTypes = [] } = useQuery({ queryKey: ["leave", "types"], queryFn: leaveApi.listLeaveTypes, enabled: allowed && has("leaveType") });
  const columns = useMemo(() => tableColumns(data?.columns ?? []), [data?.columns]);

  if (!allowed) return <Result status="403" title={`You can't open ${info.title}`} subTitle={info.extraPermission ? "This report is limited to people who can see salary-derived figures." : undefined} />;

  const set = (patch: Partial<ReportQuery>) => setQuery((q) => ({ ...q, ...patch }));
  async function doExport() {
    setExporting(true);
    try {
      saveBlob(await reportsApi.exportXlsx(reportKey, query), `${reportKey}-${ymd(dayjs())}.xlsx`);
    } catch (e) {
      void message.error(apiErrorMessage(e, "Couldn't export the report."));
    } finally {
      setExporting(false);
    }
  }

  const rateMissing = (data?.warnings ?? []).some((w) => w.startsWith("No encashment daily rate"));
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Flex justify="space-between" align="start" wrap gap={12}>
        <div>
          <Space size={8} align="center">
            <Title level={3} style={{ margin: 0 }}>
              {info.title}
            </Title>
            {data?.scope === "team" && (
              <Tag icon={<TeamOutlined />} color="blue">
                Showing your team only
              </Tag>
            )}
          </Space>
          <div>
            <Text type="secondary">{info.description}</Text>
          </div>
        </div>
        <Button icon={<DownloadOutlined />} onClick={() => void doExport()} loading={exporting} disabled={!data}>
          Export to Excel
        </Button>
      </Flex>

      {reportKey === "leave-liability" && data?.rateProvisional && <ProvisionalRateAlert rateMissing={rateMissing} />}

      <Card size="small">
        <Flex wrap gap={8} align="center">
          {has("asOf") && <DatePicker allowClear={false} format="DD MMM YYYY" value={dayjs(query.asOf)} onChange={(d) => d && set({ asOf: ymd(d) })} prefix={<Text type="secondary">As of</Text>} />}
          {has("range") && (
            <DatePicker.RangePicker allowClear={false} format="DD MMM YYYY" value={[dayjs(query.from), dayjs(query.to)]} onChange={(r) => r?.[0] && r[1] && set({ from: ymd(r[0]), to: ymd(r[1]) })} />
          )}
          {has("celebrationKind") && (
            <Segmented
              value={query.kind ?? "all"}
              onChange={(v) => set({ kind: v as ReportQuery["kind"] })}
              options={[
                { value: "all", label: "Both" },
                { value: "birthday", label: "Birthdays" },
                { value: "anniversary", label: "Anniversaries" },
              ]}
            />
          )}
          {has("department") && (
            <Select allowClear showSearch optionFilterProp="label" placeholder="Department" style={{ minWidth: 180 }} value={query.departmentId} onChange={(v) => set({ departmentId: v })} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          )}
          {has("location") && <Select allowClear showSearch optionFilterProp="label" placeholder="Branch" style={{ minWidth: 180 }} value={query.locationId} onChange={(v) => set({ locationId: v })} options={locations.map((l) => ({ value: l.id, label: l.name }))} />}
          {has("employmentType") && <Select allowClear placeholder="Employment type" style={{ minWidth: 160 }} value={query.employmentType} onChange={(v) => set({ employmentType: v })} options={EMPLOYMENT_TYPES} />}
          {has("leaveType") && <Select allowClear placeholder="All leave types" style={{ minWidth: 180 }} value={query.leaveTypeId} onChange={(v) => set({ leaveTypeId: v })} options={leaveTypes.map((t) => ({ value: t.id, label: `${t.name} (${t.code})` }))} />}
          <Button type="link" onClick={() => setQuery(defaultQuery(reportKey))}>
            Reset
          </Button>
        </Flex>
      </Card>

      {isError && <Alert type="error" showIcon title={apiErrorMessage(error, "Couldn't load the report.")} />}
      {(data?.warnings ?? [])
        .filter((w) => !(reportKey === "leave-liability" && w.startsWith("No encashment daily rate")))
        .map((w) => (
          <Alert key={w} type="warning" showIcon title={w} />
        ))}

      {data && (
        <Row gutter={[12, 12]}>
          {data.summary.map((s) => (
            <Col key={s.label} xs={12} sm={8} md={6} lg={4}>
              <Card size="small">
                <Statistic title={s.label} value={formatValue(s.value, s.type)} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {data && data.breakdowns.length > 0 && (
        <Row gutter={[12, 12]}>
          {data.breakdowns.map((b) => (
            <Col key={b.title} xs={24} md={12} xl={8}>
              <Card size="small" title={b.title}>
                <Table size="small" rowKey="label" pagination={false} scroll={{ y: 240 }} dataSource={b.rows} columns={tableColumns(b.columns)} />
              </Card>
            </Col>
          ))}
        </Row>
      )}

      <Card size="small" title={data ? `${data.rows.length} row${data.rows.length === 1 ? "" : "s"}` : undefined}>
        <Table
          size="small"
          loading={isLoading}
          rowKey={(r) => columns.map((c) => String(r[c.key] ?? "")).join("|")}
          dataSource={data?.rows ?? []}
          columns={columns}
          scroll={{ x: true }}
          pagination={{ pageSize: 25, showSizeChanger: true, hideOnSinglePage: true }}
        />
      </Card>

      {data && data.notes.length > 0 && (
        <div>
          {data.notes.map((n) => (
            <Paragraph key={n} type="secondary" style={{ marginBottom: 4, fontSize: fs.sm }}>
              {n}
            </Paragraph>
          ))}
        </div>
      )}
    </Space>
  );
}
