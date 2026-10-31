import { Table, Typography } from "antd";
import type { EngineResult, Regime, RegimeComparison } from "../../api/tax";
import { formatRupees } from "../../lib/money";
import { ApprovalBanner, Stack, StatusChip } from "../../ui";

const { Text } = Typography;

const ROWS: Array<{ key: string; label: string; of: (r: EngineResult) => string }> = [
  { key: "pay", label: "Taxable pay for the year (projected)", of: (r) => r.taxablePay },
  { key: "std", label: "Standard deduction", of: (r) => r.standardDeduction },
  { key: "sections", label: "Deductions that count", of: (r) => r.sectionsTotal },
  { key: "income", label: "Taxable income", of: (r) => r.taxableIncome },
  { key: "slab", label: "Tax by the slabs", of: (r) => r.slabTax },
  { key: "rebate", label: "Rebate", of: (r) => r.rebate },
  { key: "surcharge", label: "Surcharge", of: (r) => r.surcharge },
  { key: "cess", label: "Cess", of: (r) => r.cess },
  { key: "tax", label: "Tax for the year", of: (r) => r.annualTax },
];
const NAME: Record<Regime, string> = { NEW: "New regime", OLD: "Old regime" };

/** The two regimes side by side. It never chooses: the person does, and what they chose (and the year's default) are shown as plain facts. */
export function RegimeCompare({ comparison }: { comparison: RegimeComparison }) {
  if (!comparison.available) {
    return <ApprovalBanner tone="warning" title="The two regimes cannot be shown yet" description={comparison.missing.length > 0 ? `The directors have not entered ${comparison.missing.slice(0, 6).join(", ")}${comparison.missing.length > 6 ? ` and ${comparison.missing.length - 6} more` : ""}.` : "Nothing is available yet."} />;
  }
  const rows = ROWS.map((row) => ({ key: row.key, label: row.label, NEW: comparison.results.NEW ? row.of(comparison.results.NEW) : "", OLD: comparison.results.OLD ? row.of(comparison.results.OLD) : "" }));
  return (
    <Stack>
      {comparison.draft && <ApprovalBanner tone="warning" title="Draft" description="The tax values for this year have not been confirmed by a second director, so these figures are a draft and not to be relied on." />}
      <Table
        size="small"
        pagination={false}
        rowKey="key"
        dataSource={rows}
        scroll={{ x: true }}
        columns={[
          { title: "", dataIndex: "label", key: "label" },
          ...(["NEW", "OLD"] as const).map((r) => ({
            title: <span>{NAME[r]} {comparison.chosen === r && <StatusChip tone="success">You chose this</StatusChip>}</span>,
            dataIndex: r,
            key: r,
            align: "right" as const,
            render: (v: string) => <span className="ws-num">{formatRupees(v, 2)}</span>,
          })),
        ]}
      />
      <Text type="secondary">
        Deductions count as {comparison.basis === "VERIFIED" ? "verified by a director" : "declared"}. {comparison.chosen ? "" : comparison.defaultRegime ? `You have not chosen: if you do not, the year's default (${NAME[comparison.defaultRegime].toLowerCase()}) applies.` : "You have not chosen, and the directors have not set a default."} Marginal relief is not worked out here.
      </Text>
    </Stack>
  );
}
