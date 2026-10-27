import { Alert, Space, Table, Typography } from "antd";
import { StatusChip } from "../../ui";
import { COMPONENT_TYPE_LABEL } from "@shared/constants/payrollSalary";
import type { PlanPerson } from "../../api/payroll";
import { formatDifference, formatRupees } from "../../lib/money";
import { PersonCell } from "./payrollUi";

const { Text } = Typography;

/** What a salary revision would write, person by person: old, new, the difference, and the arrears if it is dated inside a finalised period. */
export function RevisionPlanTable({ people, componentName }: { people: PlanPerson[]; componentName: (code: string) => string }) {
  return (
    <Table<PlanPerson>
      size="small"
      rowKey="employeeId"
      scroll={{ x: "max-content" }}
      pagination={people.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
      dataSource={people}
      expandable={{
        defaultExpandedRowKeys: people.length === 1 ? [people[0]!.employeeId] : [],
        expandedRowRender: (p) => (
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            {p.problems.map((m) => <Alert key={m} type="error" showIcon title={m} />)}
            <Table
              size="small"
              pagination={false}
              rowKey="component"
              dataSource={p.differences}
              columns={[
                { title: "Line", render: (_, d) => componentName(d.component) },
                { title: "Now", align: "right", className: "ws-num", render: (_, d) => formatRupees(d.old) },
                { title: "After", align: "right", className: "ws-num", render: (_, d) => formatRupees(d.next) },
                { title: "Difference", align: "right", className: "ws-num", render: (_, d) => <Text type={d.difference.startsWith("-") ? "danger" : /^0(\.0+)?$/.test(d.difference) ? "secondary" : "success"}>{formatDifference(d.difference)}</Text> },
              ]}
            />
            {p.next && <Text type="secondary">{COMPONENT_TYPE_LABEL.EARNING} lines add up to {formatRupees(p.next.monthlyCtc)} a month ({formatRupees(p.next.annualCtc)} a year) on {p.next.structure}.</Text>}
            {p.arrears.length > 0 && (
              <Alert
                type="warning"
                showIcon
                title="Dated inside a finalised payroll period: the difference is paid as arrears in the next run"
                description={
                  <Space orientation="vertical" size={2}>
                    {p.arrears.map((a) => (
                      <Text key={a.cycleStart}>
                        {a.cycle}: <Text strong>{formatDifference(a.total)}</Text> ({a.lines.map((l) => `${componentName(l.component)} ${formatDifference(l.amount)}`).join(", ")})
                      </Text>
                    ))}
                    <Text type="secondary">The closed period is not rewritten; the salary timeline keeps the date you chose.</Text>
                  </Space>
                }
              />
            )}
          </Space>
        ),
      }}
      columns={[
        { title: "Employee", render: (_, p) => <PersonCell name={p.name} code={p.employeeCode} /> },
        { title: "Kind", render: (_, p) => <StatusChip tone={p.rowReason === "JOINING" ? "info" : "neutral"}>{p.rowReason === "JOINING" ? "First salary" : p.rowReason === "CORRECTION" ? "Correction" : "Revision"}</StatusChip> },
        { title: "A month now", align: "right", className: "ws-num", render: (_, p) => (p.previous ? formatRupees(p.previous.monthlyCtc) : "None") },
        { title: "A month after", align: "right", className: "ws-num", render: (_, p) => (p.next ? formatRupees(p.next.monthlyCtc) : <StatusChip tone="danger">Cannot be worked out</StatusChip>) },
        { title: "Difference", align: "right", className: "ws-num", render: (_, p) => (p.next ? formatDifference(String(subtract(p.next.monthlyCtc, p.previous?.monthlyCtc ?? "0"))) : null) },
        { title: "First cycle", render: (_, p) => p.firstCycle },
        { title: "Arrears", render: (_, p) => (p.arrears.length ? <StatusChip tone="warning">Arrears</StatusChip> : null) },
      ]}
    />
  );
}

/** a - b on decimal strings of at most 6 places, by scaling to integers: display only, never fed back to the server. */
function subtract(a: string, b: string): string {
  const scale = (s: string) => {
    const [w = "0", f = ""] = s.split(".");
    return { n: BigInt(w + f.padEnd(6, "0").slice(0, 6)) };
  };
  const diff = scale(a).n - scale(b).n;
  const neg = diff < 0n;
  const abs = (neg ? -diff : diff).toString().padStart(7, "0");
  const whole = abs.slice(0, -6);
  const frac = abs.slice(-6).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}
