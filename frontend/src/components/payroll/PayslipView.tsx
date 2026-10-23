import { Alert, Descriptions, Flex, Table, Typography } from "antd";
import type { PayslipContent, PayslipLine } from "../../api/payroll";
import { formatRupees } from "../../lib/money";

const { Text, Title } = Typography;

// A payslip as the person reads it. Every figure is the stored decimal string, shown with Indian grouping and never converted to a number. Used for the employee's own
// payslip, for HR reading one, and for the draft preview (which carries a TEST banner).

function Lines({ title, lines, total, totalLabel }: { title: string; lines: PayslipLine[]; total: string; totalLabel: string }) {
  return (
    <Table<PayslipLine>
      size="small"
      rowKey="code"
      pagination={false}
      dataSource={lines}
      locale={{ emptyText: "None" }}
      columns={[
        { title, dataIndex: "label" },
        { title: "", align: "right", width: 130, render: (_, r) => formatRupees(r.amount, 2) },
      ]}
      summary={() => (
        <Table.Summary.Row>
          <Table.Summary.Cell index={0}>
            <Text strong>{totalLabel}</Text>
          </Table.Summary.Cell>
          <Table.Summary.Cell index={1} align="right">
            <Text strong>{formatRupees(total, 2)}</Text>
          </Table.Summary.Cell>
        </Table.Summary.Row>
      )}
    />
  );
}

const esiLast4Of = (c: PayslipContent): string | null => c.statutory.esiLast4 ?? (c.statutory.esiNumber ? c.statutory.esiNumber.slice(-4) : null);

export function PayslipView({ content: c, watermark }: { content: PayslipContent; watermark?: string | null }) {
  const ids = [c.statutory.panLast4 ? `PAN ending ${c.statutory.panLast4}` : null, c.statutory.uanLast4 ? `UAN ending ${c.statutory.uanLast4}` : null, esiLast4Of(c) ? `ESI ending ${esiLast4Of(c)}` : null].filter(Boolean).join(" · ");
  return (
    <Flex vertical gap={12} data-testid="payslip">
      {watermark && <Alert type="error" showIcon title={watermark} description="This is a preview of a draft. It is not a payslip and nobody else can see it." />}
      <div>
        <Title level={4} style={{ margin: 0 }}>
          {c.company.legalName || "Payslip"}
        </Title>
        <Text type="secondary">Payslip for {c.period.label} ({c.period.start} to {c.period.end})</Text>
      </div>
      <Descriptions size="small" bordered column={{ xs: 1, sm: 2 }}>
        <Descriptions.Item label="Employee">{c.employee.name} ({c.employee.code})</Descriptions.Item>
        <Descriptions.Item label="Date of joining">{c.employee.dateOfJoining}</Descriptions.Item>
        <Descriptions.Item label="Designation">{c.employee.designation || "—"}</Descriptions.Item>
        <Descriptions.Item label="Department">{c.employee.department || "—"}</Descriptions.Item>
        <Descriptions.Item label="Location">{c.employee.location || "—"}</Descriptions.Item>
        <Descriptions.Item label="Days paid / loss of pay">{c.days.paid} / {c.days.lop}</Descriptions.Item>
        <Descriptions.Item label="Bank">{c.bank ? `${c.bank.bankName}, account ending ${c.bank.accountLast4}` : "—"}</Descriptions.Item>
        <Descriptions.Item label="Identifiers">{ids || "—"}</Descriptions.Item>
      </Descriptions>
      <Flex gap={16} wrap>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <Lines title="Earnings" lines={c.earnings} total={c.totals.gross} totalLabel="Gross" />
        </div>
        <div style={{ flex: "1 1 280px", minWidth: 0 }}>
          <Lines title="Deductions" lines={c.rounding ? [...c.deductions, { code: "ROUNDING", label: "Rounding", amount: c.rounding }] : c.deductions} total={c.totals.deductions} totalLabel="Total deductions" />
        </div>
      </Flex>
      <Alert type="success" showIcon={false} title={<Text strong style={{ fontSize: 18 }}>Net pay {formatRupees(c.totals.net, 2)}</Text>} description={c.netInWords} />
      {c.employerContributions.length > 0 && (
        <Text type="secondary">
          Employer contributions, for information and not part of your pay: {c.employerContributions.map((l) => `${l.label} ${formatRupees(l.amount, 2)}`).join(" · ")}
        </Text>
      )}
    </Flex>
  );
}
