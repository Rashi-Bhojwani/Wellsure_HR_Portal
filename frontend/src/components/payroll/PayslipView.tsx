import { Alert } from "antd";
import type { PayslipContent, PayslipLine } from "../../api/payroll";
import { formatRupees } from "../../lib/money";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { KeyValueGrid } from "../../ui";

// A payslip as the person reads it. Every figure is the stored decimal string, shown with Indian grouping and never converted to a number. Used for the employee's own
// payslip, for HR reading one, and for the draft preview (which carries a TEST banner).

const box = { border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, background: v.bgSurface, padding: space[5], minWidth: 0 } as const;

function Lines({ title, lines, total, totalLabel }: { title: string; lines: PayslipLine[]; total: string; totalLabel: string }) {
  return (
    <section style={{ ...box, flex: "1 1 280px" }} aria-label={title}>
      <h3 style={{ margin: 0, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{title}</h3>
      <dl style={{ margin: `${space[3]}px 0 0` }}>
        {lines.length === 0 && <div style={{ color: v.textSecondary, padding: `${space[2]}px 0` }}>None</div>}
        {lines.map((r) => (
          <div key={r.code} style={{ display: "flex", justifyContent: "space-between", gap: space[3], padding: `${space[2]}px 0`, borderBottom: `1px solid ${v.borderDefault}` }}>
            <dt style={{ color: v.textBody }}>{r.label}</dt>
            <dd className="ws-num" style={{ margin: 0, color: v.textPrimary, whiteSpace: "nowrap" }}>{formatRupees(r.amount, 2)}</dd>
          </div>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", gap: space[3], paddingTop: space[3] }}>
          <dt style={{ fontWeight: fw.bold, color: v.textPrimary }}>{totalLabel}</dt>
          <dd className="ws-num" style={{ margin: 0, fontWeight: fw.bold, color: v.textPrimary, whiteSpace: "nowrap" }}>{formatRupees(total, 2)}</dd>
        </div>
      </dl>
    </section>
  );
}

const esiLast4Of = (c: PayslipContent): string | null => c.statutory.esiLast4 ?? (c.statutory.esiNumber ? c.statutory.esiNumber.slice(-4) : null);

export function PayslipView({ content: c, watermark }: { content: PayslipContent; watermark?: string | null }) {
  const ids = [c.statutory.panLast4 ? `PAN ending ${c.statutory.panLast4}` : null, c.statutory.uanLast4 ? `UAN ending ${c.statutory.uanLast4}` : null, esiLast4Of(c) ? `ESI ending ${esiLast4Of(c)}` : null].filter(Boolean).join(" · ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }} data-testid="payslip">
      {watermark && <Alert type="error" showIcon title={watermark} description="This is a preview of a draft. It is not a payslip and nobody else can see it." />}
      <section style={box}>
        <h2 style={{ margin: 0, fontSize: fs.h2, fontWeight: fw.bold, color: v.textPrimary }}>{c.company.legalName || "Payslip"}</h2>
        <div style={{ color: v.textSecondary, marginTop: 2, marginBottom: space[4] }}>
          Payslip for {c.period.label} ({c.period.start} to {c.period.end})
        </div>
        <KeyValueGrid
          items={[
            { key: "e", label: "Employee", value: `${c.employee.name} (${c.employee.code})` },
            { key: "j", label: "Date of joining", value: c.employee.dateOfJoining },
            { key: "d", label: "Designation", value: c.employee.designation || "—" },
            { key: "dp", label: "Department", value: c.employee.department || "—" },
            { key: "l", label: "Location", value: c.employee.location || "—" },
            { key: "days", label: "Days paid / loss of pay", value: <span className="ws-num">{c.days.paid} / {c.days.lop}</span> },
            { key: "b", label: "Bank", value: c.bank ? `${c.bank.bankName}, account ending ${c.bank.accountLast4}` : "—" },
            { key: "i", label: "Identifiers", value: ids || "—" },
          ]}
        />
      </section>
      <div style={{ display: "flex", gap: space[4], flexWrap: "wrap" }}>
        <Lines title="Earnings" lines={c.earnings} total={c.totals.gross} totalLabel="Gross" />
        <Lines title="Deductions" lines={c.rounding ? [...c.deductions, { code: "ROUNDING", label: "Rounding", amount: c.rounding }] : c.deductions} total={c.totals.deductions} totalLabel="Total deductions" />
      </div>
      <section style={{ ...box, background: v.accentSubtle, borderColor: v.accent }} aria-label="Net pay">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: space[3], flexWrap: "wrap" }}>
          <span style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>Net pay</span>
          <span className="ws-num" style={{ fontSize: fs.h1, fontWeight: fw.bold, color: v.textPrimary }}>{formatRupees(c.totals.net, 2)}</span>
        </div>
        <div style={{ color: v.textBody, marginTop: space[1] }}>{c.netInWords}</div>
      </section>
      {c.employerContributions.length > 0 && (
        <div style={{ color: v.textSecondary, fontSize: fs.md }}>
          Employer contributions, for information and not part of your pay: {c.employerContributions.map((l) => `${l.label} ${formatRupees(l.amount, 2)}`).join(" · ")}
        </div>
      )}
    </div>
  );
}
