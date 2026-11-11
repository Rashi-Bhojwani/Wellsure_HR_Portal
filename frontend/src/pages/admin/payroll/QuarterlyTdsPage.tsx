import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Select } from "antd";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import type { QuarterlyData } from "../../../api/tax";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, PageHeader, Panel } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Quarterly TDS data (item 3, 2026-11-11), directors only: what finished runs paid and deducted per person per month of a quarter, with the confirmed challans
// (serials by their last digits) and PAN by its last four. Our own layout: the government utility's format is not built.
function years(): string[] {
  const now = Number(financialYearOf(new Date().toISOString().slice(0, 10)).label.slice(0, 4));
  return [now - 2, now - 1, now].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}
type Row = QuarterlyData["rows"][number];

export function QuarterlyTdsPage() {
  const [fy, setFy] = useState(years()[1]!);
  const [quarter, setQuarter] = useState(1);
  const q = useQuery({ queryKey: ["tax", "quarterly", fy, quarter], queryFn: () => taxApi.quarterlyData(fy, quarter) });
  const months = q.data?.months ?? [];
  return (
    <>
      <PageHeader
        title="Quarterly TDS data"
        subtitle="Paid and deducted by finished payroll runs, per person and month, with the confirmed challans."
        actions={
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            <Select aria-label="Financial year" value={fy} onChange={setFy} options={years().map((y) => ({ value: y, label: y }))} style={{ minWidth: 120 }} />
            <Select aria-label="Quarter" value={quarter} onChange={setQuarter} options={[1, 2, 3, 4].map((n) => ({ value: n, label: `Quarter ${n}` }))} style={{ minWidth: 120 }} />
          </div>
        }
      />
      <ApprovalBanner tone="info" title="Not the official return format" description={q.data?.note ?? "The government utility's input format is not built: its format has not been confirmed."} style={{ marginBottom: space[4] }} />
      <Panel title="People" style={{ marginBottom: space[4] }}>
        <DataTable<Row>
          rowKey="employeeCode"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data?.rows ?? []}
          empty="No finished payroll run paid anyone in this quarter."
          pagination={{ pageSize: 50 }}
          mobile={{ title: (r) => r.name, subtitle: (r) => `${r.employeeCode} · PAN ${r.panLast4 ? `…${r.panLast4}` : "not on record"}`, fields: months.map((m) => ({ label: m, render: (r: Row) => `${formatRupees(r.byMonth[m]?.paid ?? "0", 2)} paid · ${formatRupees(r.byMonth[m]?.tds ?? "0", 2)} TDS` })) }}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
            { title: "PAN", key: "p", render: (_, r) => (r.panLast4 ? `…${r.panLast4}` : "Not on record") },
            ...months.flatMap((m) => [
              { title: `${m} paid`, key: `${m}p`, align: "right" as const, render: (_: unknown, r: Row) => formatRupees(r.byMonth[m]?.paid ?? "0", 2) },
              { title: `${m} TDS`, key: `${m}t`, align: "right" as const, render: (_: unknown, r: Row) => formatRupees(r.byMonth[m]?.tds ?? "0", 2) },
            ]),
          ]}
        />
      </Panel>
      <Panel title="Confirmed challans">
        <DataTable<QuarterlyData["challans"][number]>
          rowKey={(c) => `${c.month}-${c.serial}`}
          loading={q.isLoading}
          dataSource={q.data?.challans ?? []}
          empty="No confirmed challan for this quarter."
          pagination={false}
          columns={[
            { title: "Month", dataIndex: "month" },
            { title: "Serial", dataIndex: "serial" },
            { title: "Deposited on", dataIndex: "depositedOn" },
          ]}
        />
      </Panel>
    </>
  );
}
