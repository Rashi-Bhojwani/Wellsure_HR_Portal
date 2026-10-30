import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import type { PayslipWhy, WhyLine, WhyRule } from "../../api/payroll";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { formatRupees } from "../../lib/money";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { EmptyState, SideDrawer, SkeletonCard, Stack, StatusChip } from "../../ui";

// The payslip "Why?": every line, in words, with the rules the run read to get it. For each rule: its value, where the number came from (the source note the
// directors wrote), the date it applies from, who confirmed it, and whether it came from an override. When the employee has amounts hidden, the drawer hides them too.

const MASK = "₹ *****";

function Rule({ r }: { r: WhyRule }) {
  return (
    <li style={{ padding: `${space[2]}px 0`, borderTop: `1px solid ${v.borderDefault}`, listStyle: "none" }}>
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
        <strong style={{ color: v.textPrimary }}>{r.label}</strong>
        <StatusChip tone={r.status === "CONFIRMED" ? "success" : "warning"}>{r.status === "CONFIRMED" ? "Confirmed" : "Not yet confirmed"}</StatusChip>
        <StatusChip tone={r.overridden ? "info" : "neutral"}>{r.overridden ? `From an override (${r.level.toLowerCase()})` : "Company rule"}</StatusChip>
      </div>
      <div style={{ color: v.textBody, fontSize: fs.sm }}>
        Value: <span className="ws-num">{typeof r.value === "string" || typeof r.value === "number" || typeof r.value === "boolean" ? String(r.value) : JSON.stringify(r.value)}</span>
      </div>
      <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
        Where it came from: {r.sourceNote ?? "no source note recorded"}
        {r.effectiveFrom ? ` · applies from ${formatDate(r.effectiveFrom)}` : ""}
        {r.confirmedBy ? ` · confirmed by ${r.confirmedBy}${r.confirmedOn ? ` on ${formatDate(r.confirmedOn)}` : ""}` : ""}
        {r.registrationRef ? ` · registration ${r.registrationRef}` : ""}
      </div>
    </li>
  );
}

function Line({ l, masked }: { l: WhyLine; masked?: boolean }) {
  return (
    <section style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, background: v.bgSurface, padding: space[4], minWidth: 0 }} aria-label={l.label}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: space[3] }}>
        <h4 style={{ margin: 0, fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary }}>{l.label}</h4>
        <span className="ws-num" style={{ color: v.textPrimary, whiteSpace: "nowrap" }}>{masked ? MASK : formatRupees(l.amount, 2)}</span>
      </div>
      {l.explanation.map((s) => (
        <p key={s} style={{ margin: `${space[2]}px 0 0`, color: v.textBody }}>{s}</p>
      ))}
      {!masked && l.working.length > 0 && (
        <dl style={{ margin: `${space[2]}px 0 0`, color: v.textSecondary, fontSize: fs.sm }}>
          {l.working.map((w) => (
            <div key={w.name} style={{ display: "flex", gap: space[2] }}>
              <dt>{w.name}:</dt>
              <dd style={{ margin: 0 }} className="ws-num">{w.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {l.rules.length > 0 && <ul style={{ margin: `${space[3]}px 0 0`, padding: 0 }}>{l.rules.map((r) => <Rule key={r.key} r={r} />)}</ul>}
    </section>
  );
}

export function PayslipWhyButton({ queryKey, load, masked }: { queryKey: readonly unknown[]; load: () => Promise<PayslipWhy>; masked?: boolean }) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, error } = useQuery({ queryKey, queryFn: load, enabled: open });
  return (
    <>
      <Button icon={<QuestionCircleOutlined />} onClick={() => setOpen(true)} style={{ marginBottom: space[3] }}>
        Why?
      </Button>
      <SideDrawer open={open} onClose={() => setOpen(false)} size="wide" title="Why is my payslip this way?" subtitle={data?.cycleLabel} footer={null}>
        {isLoading && <SkeletonCard lines={8} />}
        {error && <EmptyState kind="error" compact title="Could not load the explanation" description={apiErrorMessage(error, "Could not load the explanation.")} />}
        {data && (
          <Stack gap={space[3]}>
            {data.lines.map((l, i) => (
              <Line key={`${l.code}-${i}`} l={l} masked={masked} />
            ))}
          </Stack>
        )}
      </SideDrawer>
    </>
  );
}
