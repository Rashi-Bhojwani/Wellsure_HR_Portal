import { useQuery } from "@tanstack/react-query";
import * as taxApi from "../../../api/tax";
import { Caption } from "../../../components/payroll/payrollUi";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SkeletonCard, Stack } from "../../../ui";

// Salary > YTD Reports (P7-3): the person's own pay this financial year, line by line and month by month, from finished payroll runs in this system.
type Row = taxApi.YtdReport["earnings"][number];

function Table({ title, rows, months, total }: { title: string; rows: Row[]; months: taxApi.YtdReport["months"]; total: string }) {
  return (
    <Panel title={title} subtitle={`Total ${formatRupees(total, 2)}`}>
      <DataTable<Row>
        rowKey="code"
        density="compact"
        dataSource={rows}
        pagination={false}
        scroll={{ x: true }}
        empty={<EmptyState compact title="Nothing yet" description="No payroll run for this year is finished yet." />}
        mobile={{ title: (r) => r.label, fields: [{ label: "Year to date", render: (r) => formatRupees(r.total, 2) }, ...months.map((m) => ({ label: m.label, render: (r: Row) => formatRupees(r.byMonth[m.end] ?? "0", 2) }))] }}
        columns={[
          { title: "Line", dataIndex: "label", fixed: "left" },
          ...months.map((m) => ({ title: m.label, key: m.end, align: "right" as const, render: (_: unknown, r: Row) => <span className="ws-num">{formatRupees(r.byMonth[m.end] ?? "0", 2)}</span> })),
          { title: "Year to date", key: "t", align: "right" as const, render: (_: unknown, r: Row) => <strong className="ws-num">{formatRupees(r.total, 2)}</strong> },
        ]}
      />
    </Panel>
  );
}

export function YtdReportsPage() {
  const q = useQuery({ queryKey: ["tax", "ytd"], queryFn: () => taxApi.myYtd() });
  const r = q.data;
  return (
    <>
      <PageHeader title="YTD Reports" subtitle={r ? `Financial year ${r.year}` : "Your pay this year"} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={5} />}
        {q.error && <ApprovalBanner tone="danger" title="Could not load your report" description={apiErrorMessage(q.error, "Try again in a moment.")} />}
        {r && (
          <>
            <Table title="Earnings" rows={r.earnings} months={r.months} total={r.totals.earnings} />
            <Table title="Deductions" rows={r.deductions} months={r.months} total={r.totals.deductions} />
            <Caption>{r.note}</Caption>
          </>
        )}
      </Stack>
    </>
  );
}
