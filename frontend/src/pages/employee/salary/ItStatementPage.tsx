import { useQuery } from "@tanstack/react-query";
import * as taxApi from "../../../api/tax";
import { RegimeCompare } from "../../../components/tax/RegimeCompare";
import { Caption } from "../../../components/payroll/payrollUi";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SkeletonCard, Stack } from "../../../ui";

// Salary > IT Statement. The person's own year of income tax: what has been paid and deducted so far (finalised runs only), what is left to deduct, and the two regimes side by side.
// Every figure is a draft while the directors' tax values for the year are not confirmed.
export function ItStatementPage() {
  const q = useQuery({ queryKey: ["tax", "statement"], queryFn: () => taxApi.myStatement() });
  const s = q.data;
  return (
    <>
      <PageHeader title="IT Statement" subtitle={s ? `Financial year ${s.year}` : "Your income tax for the year"} />
      <Stack>
        {q.isLoading && <SkeletonCard lines={5} />}
        {q.error && <ApprovalBanner tone="danger" title="Could not load your statement" description={apiErrorMessage(q.error, "Try again in a moment.")} />}
        {s && (
          <>
            {s.watermark && <ApprovalBanner tone="warning" title="DRAFT" description={s.watermark} />}
            <Panel title="So far this year" subtitle="From finalised payroll runs">
              <DataTable<taxApi.Statement["paidSoFar"]["months"][number]>
                rowKey="month"
                density="compact"
                dataSource={s.paidSoFar.months}
                pagination={false}
                empty={<EmptyState compact title="Nothing paid yet" description="No payroll run for this year is final yet." />}
                mobile={{ title: (m) => formatDate(m.month), fields: [{ label: "Taxable pay", render: (m) => formatRupees(m.taxablePay, 2) }, { label: "Tax deducted", render: (m) => formatRupees(m.tds, 2) }] }}
                columns={[
                  { title: "Month ending", key: "m", render: (_, m) => formatDate(m.month) },
                  { title: "Taxable pay", key: "t", align: "right", render: (_, m) => <span className="ws-num">{formatRupees(m.taxablePay, 2)}</span> },
                  { title: "Tax deducted", key: "d", align: "right", render: (_, m) => <span className="ws-num">{formatRupees(m.tds, 2)}</span> },
                ]}
              />
              <Caption>Total taxable pay {formatRupees(s.paidSoFar.taxable, 2)}; tax deducted {formatRupees(s.paidSoFar.tds, 2)}.</Caption>
            </Panel>
            {s.toCome && (
              <Panel title="To come" subtitle="A projection, not a promise">
                <Caption>With {s.toCome.monthsLeft} month{s.toCome.monthsLeft === 1 ? "" : "s"} left, {formatRupees(s.toCome.remaining, 2)} is still to be deducted, about {formatRupees(s.toCome.perMonth, 2)} a month, under your {s.chosenRegime === "OLD" ? "old" : "new"} regime.</Caption>
              </Panel>
            )}
            <Panel title="The two regimes" subtitle="Side by side, on your pay and your declaration">
              <RegimeCompare comparison={{ available: s.available, missing: s.missing, draft: s.draft, basis: s.basis, taxablePay: s.taxablePayProjected, results: s.regimes, chosen: s.chosenRegime, defaultRegime: s.defaultRegime }} />
            </Panel>
            <Caption>{s.note}</Caption>
          </>
        )}
      </Stack>
    </>
  );
}
