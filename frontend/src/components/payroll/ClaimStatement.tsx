import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useQuery } from "@tanstack/react-query";
import { DatePicker } from "antd";
import * as api from "../../api/reimbursements";
import type { StatementRun } from "../../api/reimbursements";
import { formatRupees } from "../../lib/money";
import { DataTable, Panel } from "../../ui";
import { space } from "../../theme/tokens";

// PY-24 (docs/plans/A_PARITY_ROWS.md): the reimbursement statement per run. `mine`: the signed-in person's own runs. `month`: directors, everyone's claims a month's
// finalised run paid. Amounts are exact strings from the API.
type Line = StatementRun["lines"][number] & { key: string; cycle: string };

export function ClaimStatement({ scope }: { scope: "mine" | "month" }) {
  const [month, setMonth] = useState<Dayjs>(() => dayjs().subtract(1, "month"));
  const m = month.format("YYYY-MM");
  const q = useQuery({ queryKey: ["claims", "statement", scope, scope === "month" ? m : ""], queryFn: () => (scope === "mine" ? api.myClaimStatement() : api.monthClaimStatement(m)) });
  const lines: Line[] = (q.data ?? []).flatMap((r) => r.lines.map((l, i) => ({ ...l, key: `${r.runId}-${l.claimId}-${i}`, cycle: r.cycle })));
  const total = (q.data ?? []).length === 1 ? q.data![0]!.total : null;
  return (
    <Panel
      title="Statement by payroll run"
      subtitle={scope === "mine" ? "Each claim a finalised payroll run paid you." : "Every claim the month's finalised run paid."}
      extra={scope === "month" ? <DatePicker picker="month" aria-label="Month" allowClear={false} format="MMM YYYY" value={month} onChange={(d) => d && setMonth(d)} /> : undefined}
      style={{ marginTop: space[4] }}
    >
      <DataTable<Line>
        rowKey="key"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={lines}
        empty={scope === "mine" ? "No payroll run has paid you a claim yet." : "The run for this month paid no claims (or is not finalised)."}
        pagination={{ pageSize: 25 }}
        mobile={{ title: (l) => `${l.type} · ${formatRupees(l.amount, 2)}`, subtitle: (l) => `${l.cycle}${l.name ? ` · ${l.name}` : ""} · spent ${dayjs(l.spentOn).format("D MMM YYYY")}` }}
        columns={[
          { title: "Run", dataIndex: "cycle" },
          ...(scope === "month" ? [{ title: "Employee", key: "e", render: (_: unknown, l: Line) => `${l.name ?? ""} (${l.employeeCode ?? ""})` }] : []),
          { title: "Claim type", dataIndex: "type" },
          { title: "Spent on", dataIndex: "spentOn", render: (x: string) => dayjs(x).format("D MMM YYYY") },
          { title: "Paid", dataIndex: "amount", align: "right" as const, render: (x: string) => formatRupees(x, 2) },
        ]}
        footer={total ? () => <div style={{ textAlign: "right" }}><strong>Total {formatRupees(total, 2)}</strong></div> : undefined}
      />
    </Panel>
  );
}
