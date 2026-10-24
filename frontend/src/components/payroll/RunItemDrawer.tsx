import { useQuery } from "@tanstack/react-query";
import { Alert, Descriptions, Space, Table, Typography } from "antd";
import { EmptyState, SideDrawer, SkeletonCard, StatusChip } from "../../ui";
import { HOLD_REASON_LABEL } from "@shared/constants/payrollRun";
import * as payrollApi from "../../api/payroll";
import type { RunItemDetail, RunLine } from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { formatRupees } from "../../lib/money";
import { LINE_KIND_LABEL } from "../../pages/admin/payroll/runText";
import { fs } from "../../theme/tokens";

const { Text } = Typography;

const BASIS_LABEL: Record<string, string> = {
  wages: "Wages counted",
  cappedWages: "Wages after the ceiling",
  ceiling: "Ceiling",
  ceilingMode: "Ceiling mode",
  rate: "Rate (%)",
  entitlement: "Full-month ESI wages",
  periodRule: "Coverage period rule",
  state: "State",
  gross: "Gross for the slab",
  month: "Month",
  monthOverride: "Month exception applied",
  reason: "Why",
  pfApplicable: "PF applies",
  pfEsi: "PF and ESI on arrears",
  committedAmount: "Amount committed at year end",
  before: "Before rounding",
};

function shown(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return /^-?\d+(\.\d+)?$/.test(v) ? formatRupees(v, 0).replace("₹", "") : v;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "object" && "mode" in (v as object) && "scale" in (v as object)) return `${(v as { mode: string }).mode.toLowerCase().replace("_", " ")}, ${(v as { scale: number }).scale} places`;
  if (typeof v === "object" && "fromGross" in (v as object)) {
    const s = v as { fromGross: string; toGross: string | null; monthlyAmount: string };
    return `${formatRupees(s.fromGross)} to ${s.toGross ? formatRupees(s.toGross) : "no limit"}: ${formatRupees(s.monthlyAmount)}`;
  }
  return JSON.stringify(v);
}

/** How one line was worked out, from what was stored with it: the segments of a salary, or the inputs of a statutory figure. */
function LineBasis({ line, nameOf }: { line: RunLine; nameOf: (code: string) => string }) {
  const b = line.basis as { parts?: Array<{ from: string; to: string; monthly: string; factor: string }>; unrounded?: string; rounding?: unknown; prorates?: boolean; breakdown?: Array<{ component: string; amount: string }> };
  if (line.source === "COMPONENT" && b.parts) {
    return (
      <Space orientation="vertical" size={2}>
        {b.parts.map((p) => (
          <Text key={`${p.from}-${p.to}`}>
            {formatDate(p.from)} to {formatDate(p.to)}: {formatRupees(p.monthly, 2)} a month {b.prorates ? `for ${p.factor.slice(0, 8)} of the month` : "(does not pro-rate: paid in full if paid at all)"}
          </Text>
        ))}
        <Text type="secondary">Sum {b.unrounded ? formatRupees(b.unrounded, 4) : ""}, rounded: {shown(b.rounding)}</Text>
      </Space>
    );
  }
  const entries = Object.entries(line.basis).filter(([k]) => k !== "breakdown" && k !== "parts");
  return (
    <Space orientation="vertical" size={2}>
      {entries.map(([k, v]) => (
        <Text key={k}>
          <Text type="secondary">{BASIS_LABEL[k] ?? k}: </Text>
          {shown(v)}
        </Text>
      ))}
      {b.breakdown?.map((p) => (
        <Text key={p.component}>
          <Text type="secondary">{nameOf(p.component)}: </Text>
          {formatRupees(p.amount)}
        </Text>
      ))}
    </Space>
  );
}

/** "Why is this ₹4,617?": the days, the shares and every line with the basis it was worked out from, all read from what the run stored. */
export function RunItemDrawer({ runId, employeeId, onClose }: { runId: string; employeeId: string; onClose: () => void }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "run-item", runId, employeeId], queryFn: () => payrollApi.getRunItem(runId, employeeId) });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const nameOf = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  return (
    <SideDrawer open size="wide" title={data ? `${data.name} (${data.employeeCode})` : "Why this figure"} subtitle="How each figure was worked out" onClose={onClose} footer={null}>
      {isLoading && <SkeletonCard lines={8} />}
      {error && <EmptyState kind="error" compact title="Could not load this person" description={apiErrorMessage(error, "Could not load this person.")} />}
      {data && <Body d={data} nameOf={nameOf} />}
    </SideDrawer>
  );
}

function Body({ d, nameOf }: { d: RunItemDetail; nameOf: (code: string) => string }) {
  const days = d.inputs.days;
  const money = (a: string) => formatRupees(a, 2);
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      {d.isYou && <Alert type="warning" showIcon title="This is your own pay" description="You can see it here, but nobody changes their own pay, whatever their role." />}
      {d.status !== "PAYABLE" && d.holdReason && <Alert type={d.status === "EXCLUDED" ? "error" : "warning"} showIcon title={d.status === "EXCLUDED" ? `Not calculated: ${HOLD_REASON_LABEL[d.holdReason]}` : `Held: ${HOLD_REASON_LABEL[d.holdReason]}`} description={d.holdDetail} />}
      {d.exceptions.map((x) => <Alert key={x.code} type={x.severity === "BLOCKING" ? "error" : "warning"} showIcon title={x.severity === "BLOCKING" ? "Has to be resolved before the run can be submitted" : "Worth a look"} description={x.message} />)}
      {d.notices.map((n) => <Alert key={n} type="info" showIcon title={n} />)}
      {days && (
        <Descriptions
          size="small"
          bordered
          column={{ xs: 1, sm: 2 }}
          title="The days"
          items={[
            { key: "e", label: "Employed", children: `${days.employedDays} of the ${days.cycleDays} days of the cycle${d.employedFrom ? ` (${formatDate(d.employedFrom)} to ${formatDate(d.employedTo!)})` : ""}` },
            { key: "b", label: "A month counts as", children: `${days.basisDays} days (${days.payBasis.toLowerCase().replaceAll("_", " ")})` },
            { key: "l", label: "Loss of pay", children: `${days.lopDays} ${days.lopDays === "1" ? "day" : "days"}; each day costs 1/${days.lopDivisorDays} of a month` },
            { key: "p", label: "Paid for", children: `${d.days.paid.slice(0, 8)} of ${days.basisDays} days` },
            ...(days.lopByDay.length ? [{ key: "d", label: "Loss of pay on", span: 2, children: days.lopByDay.map((x) => `${formatDate(x.date)}${x.lop === "1" ? "" : ` (${x.lop})`}`).join(", ") }] : []),
          ]}
        />
      )}
      {d.inputs.segments && d.inputs.segments.length > 1 && (
        <Alert type="info" showIcon title="Their salary changed during the month" description={d.inputs.segments.map((s) => `${formatDate(s.from)} to ${formatDate(s.to)}: ${s.structure}, ${s.days} days${s.lop !== "0" ? `, ${s.lop} of loss of pay` : ""}`).join("; ")} />
      )}
      <Table<RunLine>
        size="small"
        pagination={false}
        rowKey={(l) => `${l.code}-${l.sourceRef ?? ""}`}
        dataSource={d.lines}
        columns={[
          { title: "Line", render: (_, l) => <div>{l.source === "COMPONENT" ? nameOf(l.code) : l.label}<div><Text type="secondary" style={{ fontSize: fs.sm }}>{LINE_KIND_LABEL[l.kind]}</Text></div></div> },
          { title: "Amount", align: "right", className: "ws-num", render: (_, l) => <Text type={l.kind === "DEDUCTION" ? "danger" : undefined}>{l.kind === "DEDUCTION" ? "-" : ""}{money(l.amount)}</Text> },
        ]}
        expandable={{ expandedRowRender: (l) => <LineBasis line={l} nameOf={nameOf} />, rowExpandable: () => true }}
        summary={() => (
          <Table.Summary>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><Text strong>Gross earnings</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right" className="ws-num"><Text strong>{money(d.totals.gross)}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><Text strong>Deductions</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right" className="ws-num"><Text strong>-{money(d.totals.deductions)}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
            {d.totals.roundingAdjustment !== "0" && (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}><Text>Rounding of net pay</Text></Table.Summary.Cell>
                <Table.Summary.Cell index={1} align="right" className="ws-num">{money(d.totals.roundingAdjustment)}</Table.Summary.Cell>
              </Table.Summary.Row>
            )}
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><Text strong>Net pay</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right" className="ws-num"><Text strong>{money(d.totals.net)}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
            <Table.Summary.Row>
              <Table.Summary.Cell index={0}><Text type="secondary">Employer contributions (not part of net pay)</Text></Table.Summary.Cell>
              <Table.Summary.Cell index={1} align="right" className="ws-num"><Text type="secondary">{money(d.totals.employerContributions)}</Text></Table.Summary.Cell>
            </Table.Summary.Row>
          </Table.Summary>
        )}
      />
      <Text type="secondary">
        <StatusChip tone="neutral">{d.employmentType.toLowerCase()}</StatusChip> {d.structure ? `Salary structure ${d.structure.key}, version ${d.structure.version}. ` : ""}Open a line to see how it was worked out. Everything here is read from what the run stored; nothing is recalculated to show it.
      </Text>
    </Space>
  );
}
