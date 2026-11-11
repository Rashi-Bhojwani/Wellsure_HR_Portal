import { useQuery } from "@tanstack/react-query";
import * as taxApi from "../../../api/tax";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatDifference, formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SkeletonCard, Stack, StatusChip } from "../../../ui";

// Salary > Salary Revision (P7-3): the person's own salary rows as applied (past, current, scheduled), with the CTC, the change from the row before, and the breakup.
// Their own pay is theirs to see; nobody else's is reachable from here.
type Line = taxApi.MyRevision["breakup"][number];

export function SalaryRevisionPage() {
  const q = useQuery({ queryKey: ["tax", "salary-revisions"], queryFn: taxApi.mySalaryRevisions });
  const rows = q.data?.revisions ?? [];
  return (
    <>
      <PageHeader title="Salary Revision" subtitle="Your salary as it was set, each time it changed" />
      <Stack>
        {q.isLoading && <SkeletonCard lines={4} />}
        {q.error && <ApprovalBanner tone="danger" title="Could not load your salary" description={apiErrorMessage(q.error, "Try again in a moment.")} />}
        {q.data && rows.length === 0 && <EmptyState title="No salary set yet" description="When the company sets your salary, it shows here." />}
        {rows.map((r) => (
          <Panel
            key={r.effectiveFrom}
            title={`From ${formatDate(r.effectiveFrom)}${r.effectiveTo ? ` to ${formatDate(r.effectiveTo)}` : ""}`}
            subtitle={`Annual CTC ${formatRupees(r.annualCtc, 2)}${r.change ? ` (${formatDifference(r.change)} from before)` : ""}`}
            extra={<StatusChip tone={r.effectiveTo ? "neutral" : "success"}>{r.effectiveTo ? "Past" : "Current or scheduled"}</StatusChip>}
          >
            <DataTable<Line>
              rowKey="code"
              density="compact"
              dataSource={r.breakup}
              pagination={false}
              columns={[
                { title: "Pay head", dataIndex: "name" },
                { title: "Kind", dataIndex: "type", render: (x: string) => (x === "EARNING" ? "Earning" : x === "DEDUCTION" ? "Deduction" : "Employer contribution") },
                { title: "Each month", dataIndex: "monthly", align: "right", render: (x: string) => <span className="ws-num">{formatRupees(x, 2)}</span> },
              ]}
            />
          </Panel>
        ))}
      </Stack>
    </>
  );
}
