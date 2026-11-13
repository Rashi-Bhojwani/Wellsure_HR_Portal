import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select } from "antd";
import * as api from "../../../api/behaviours";
import * as loansApi from "../../../api/loans";
import * as lettersApi from "../../../api/letters";
import * as payrollApi from "../../../api/payroll";
import type { Behaviour, BehaviourKey } from "../../../api/behaviours";
import { apiErrorMessage } from "../../../lib/apiError";
import { PageHeader, Panel, QueryState, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// System Settings > Default behaviours (D-37, docs/plans/D37_DEFAULTS.md; M task 1 adds the identity confirmation), directors only. Four behaviours have a common default, labelled "Default, change in settings";
// the max-deduction percentage has none (Not set). A change is proposed by one director with a reason and takes effect only when a different director confirms it.
const RULE_LABEL: Record<string, string> = { STOP_RUN: "Stop the run", SKIP_AND_CARRY: "Skip the instalment and carry it forward", PARTIAL_AND_CARRY: "Recover what is possible, carry the rest" };
const MODE_LABEL: Record<string, string> = { NONE: "None", FULL_MONTH: "A full month", PRO_RATA_DAYS_WORKED: "Pro-rata by days worked", FULL_IF_MIN_DAYS: "A full month only if at least N days were worked" };

function describe(b: Pick<Behaviour, "key" | "value">): string {
  const v = b.value as Record<string, unknown> | boolean | null;
  if (b.key === "access.developerSeesSwipes") return v === true ? "On: the Developer role sees Employee Swipes" : "Off: the Developer role does not see Employee Swipes";
  if (b.key === "letters.employeeMayAsk") return Array.isArray(v) && v.length ? `Employees may ask for: ${v.join(", ")}` : "None: employees cannot ask for a letter";
  if (b.key === "identity.directorConfirmsHrChanges") return v === true ? "On: a director confirms HR's bank and statutory changes before they take effect" : "Off: HR's bank and statutory changes take effect at once";
  if (b.key === "loan.maxTotalDeductionPercent") return v && typeof v === "object" ? `${String(v.percent)}% of gross (source: ${String(v.sourceNote)})` : "Not set: no percentage limit";
  if (b.key === "leave.proRataRounding") return v && typeof v === "object" ? `${ROUND_LABEL[String(v.mode)] ?? String(v.mode)} to ${String(v.scale)} decimal place(s)` : "Not set: a pro-rata result that needs rounding waits for this";
  // Part 3: pay mechanisms, Not set until two directors confirm them.
  if (b.key === "payroll.overtimePay") {
    if (!v || typeof v !== "object") return "Not set: approved overtime is not paid";
    const o = v as { payHead: string; rate: { mode: string; perHour?: string; multiplier?: string; basisHeads?: string[]; hoursPerMonth?: string }; rounding: { mode: string; scale: number } };
    return `${o.rate.mode === "FLAT_PER_HOUR" ? `₹${o.rate.perHour} an hour` : `${o.rate.multiplier} × (${(o.rate.basisHeads ?? []).join(" + ")}) ÷ ${o.rate.hoursPerMonth} hours`}, paid as ${o.payHead}; ${ROUND_LABEL[o.rounding.mode] ?? o.rounding.mode} to ${o.rounding.scale} place(s)`;
  }
  if (b.key === "payroll.leaveEncashment") {
    if (!v || typeof v !== "object") return "Not set: encashment requests are not paid; a settlement shows leave in days only";
    const e = v as { payHead: string; exitLeaveTypes: string[]; basisHeads: string[]; divisor: { kind: string; days?: string }; rounding: { mode: string; scale: number } };
    return `Days × (${e.basisHeads.join(" + ")}) ÷ ${e.divisor.kind === "FIXED_DAYS" ? e.divisor.days : "the month's calendar days"}, paid as ${e.payHead}; at exit: ${e.exitLeaveTypes.join(", ") || "no type"}; ${ROUND_LABEL[e.rounding.mode] ?? e.rounding.mode} to ${e.rounding.scale} place(s)`;
  }
  if (b.key === "leave.leavingMonthAccrual") {
    const m = v as { mode: string; minDays?: number };
    return m.mode === "FULL_IF_MIN_DAYS" ? `A full month only if at least ${m.minDays} days were worked` : MODE_LABEL[m.mode] ?? m.mode;
  }
  const map = (v ?? {}) as Record<string, string>;
  const named = Object.entries(map).map(([t, r]) => `${t}: ${RULE_LABEL[r] ?? r}`);
  return named.length ? `${named.join("; ")}. Every other loan type: skip and carry forward.` : "Every loan type: skip the instalment and carry it forward, with a warning naming the loan.";
}

const ROUND_LABEL: Record<string, string> = { HALF_UP: "Half up", HALF_EVEN: "Half even", UP: "Up", DOWN: "Down", CEIL: "Ceiling", FLOOR: "Floor" };

type FormValues = { reason: string; payHead?: string; rateMode?: string; perHour?: string; multiplier?: string; basisHeads?: string[]; hoursPerMonth?: string; exitLeaveTypes?: string[]; divisorKind?: string; divisorDays?: string; codes?: string[]; roundMode?: string; scale?: number; on?: string; mode?: string; minDays?: number; percent?: string; sourceNote?: string; rules?: Array<{ typeKey: string; rule: string }> };

export function DefaultBehavioursPage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Behaviour | null>(null);
  const [form] = Form.useForm<FormValues>();
  const q = useQuery({ queryKey: ["behaviours"], queryFn: api.listBehaviours });
  const types = useQuery({ queryKey: ["loans", "types"], queryFn: loansApi.loanTypes });
  const letterTemplates = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates });
  const comps = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const earningHeads = (comps.data ?? []).filter((c) => c.value?.type === "EARNING").map((c) => ({ value: c.code, label: c.value?.payslipLabel ? `${c.value.payslipLabel} (${c.code})` : c.code }));
  const PAY_ROUND = [{ value: "HALF_UP", label: "Half up" }, { value: "UP", label: "Up" }, { value: "DOWN", label: "Down" }];
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["behaviours"] });
  const propose = useMutation({
    mutationFn: (v: FormValues) => {
      const key = editing!.key as BehaviourKey;
      const value =
        key === "access.developerSeesSwipes" || key === "identity.directorConfirmsHrChanges" ? v.on === "on"
        : key === "letters.employeeMayAsk" ? (v.codes ?? [])
        : key === "leave.leavingMonthAccrual" ? (v.mode === "FULL_IF_MIN_DAYS" ? { mode: v.mode, minDays: v.minDays } : { mode: v.mode })
        : key === "loan.maxTotalDeductionPercent" ? { percent: v.percent, sourceNote: v.sourceNote }
        : key === "leave.proRataRounding" ? { mode: v.roundMode, scale: v.scale }
        : key === "payroll.overtimePay" ? { payHead: v.payHead, rate: v.rateMode === "FLAT_PER_HOUR" ? { mode: "FLAT_PER_HOUR", perHour: v.perHour } : { mode: "MULTIPLIER", multiplier: v.multiplier, basisHeads: v.basisHeads ?? [], hoursPerMonth: v.hoursPerMonth }, rounding: { mode: v.roundMode, scale: v.scale }, sourceNote: v.sourceNote }
        : key === "payroll.leaveEncashment" ? { payHead: v.payHead, exitLeaveTypes: v.exitLeaveTypes ?? [], basisHeads: v.basisHeads ?? [], divisor: v.divisorKind === "CALENDAR_DAYS" ? { kind: "CALENDAR_DAYS" } : { kind: "FIXED_DAYS", days: v.divisorDays }, rounding: { mode: v.roundMode, scale: v.scale }, sourceNote: v.sourceNote }
        : Object.fromEntries((v.rules ?? []).filter((r) => r?.typeKey && r?.rule).map((r) => [r.typeKey, r.rule]));
      return api.proposeBehaviour(key, value, v.reason);
    },
    onSuccess: () => { toast.success("Proposed. A different director confirms it before it takes effect."); setEditing(null); refresh(); },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not propose the change.")),
  });
  const confirm = useMutation({ mutationFn: api.confirmBehaviour, onSuccess: () => { toast.success("Confirmed. It is in effect now."); refresh(); }, onError: (err) => toast.error(apiErrorMessage(err, "Could not confirm it.")) });
  const open = (b: Behaviour) => {
    setEditing(b);
    form.resetFields();
    const v = b.value as Record<string, unknown> | boolean | null;
    if (b.key === "access.developerSeesSwipes" || b.key === "identity.directorConfirmsHrChanges") form.setFieldsValue({ on: v === true ? "on" : "off" });
    if (b.key === "letters.employeeMayAsk") form.setFieldsValue({ codes: Array.isArray(v) ? (v as string[]) : [] });
    if (b.key === "leave.leavingMonthAccrual") form.setFieldsValue({ mode: (v as { mode: string }).mode, minDays: (v as { minDays?: number }).minDays });
    if (b.key === "loan.shortfall") form.setFieldsValue({ rules: Object.entries((v ?? {}) as Record<string, string>).map(([typeKey, rule]) => ({ typeKey, rule })) });
  };
  const mode = Form.useWatch("mode", form);
  return (
    <>
      <PageHeader title="Default behaviours" subtitle="Some behaviours start from a common default; the rest start Not set. A change is proposed by one director and confirmed by a different one." />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        {(
          <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            {(q.data ?? []).map((b) => (
              <Panel key={b.key} title={b.title} subtitle={b.what} extra={<StatusChip tone={b.state === "CONFIRMED" ? "success" : b.state === "DEFAULT" ? "info" : "warning"}>{b.label ?? "Changed and confirmed"}</StatusChip>}>
                <p style={{ marginTop: 0 }}>In effect: {describe(b)}</p>
                {b.confirmed && <p>Proposed by {b.confirmed.proposedBy}, confirmed by {b.confirmed.confirmedBy}. Reason: {b.confirmed.reason}</p>}
                {b.pending.slice(0, 1).map((p) => (
                  <div key={p.id} style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center", marginBottom: space[2] }}>
                    <StatusChip tone="warning">Waiting for a different director</StatusChip>
                    <span>{describe({ key: b.key, value: p.value })} — proposed by {p.proposedBy}: {p.reason}</span>
                    {!p.mine && <Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(p.id)}>Confirm</Button>}
                  </div>
                ))}
                <Button onClick={() => open(b)}>Propose a change</Button>
              </Panel>
            ))}
          </div>
        )}
      </QueryState>
      <SideDrawer open={!!editing} title={editing ? editing.title : ""} subtitle="Takes effect only when a different director confirms it. Every change is audited." onClose={() => setEditing(null)} formId="behaviour-form" primaryLabel="Propose" primaryLoading={propose.isPending}>
        <Form id="behaviour-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => propose.mutate(v)}>
          {editing?.key === "access.developerSeesSwipes" && (
            <Form.Item name="on" label="The Developer role sees Employee Swipes" rules={[{ required: true }]}>
              <Select options={[{ value: "off", label: "Off" }, { value: "on", label: "On" }]} />
            </Form.Item>
          )}
          {editing?.key === "letters.employeeMayAsk" && (
            <Form.Item name="codes" label="Letters an employee may ask for (none = nobody can ask)">
              <Select mode="multiple" allowClear options={(letterTemplates.data ?? []).filter((t) => t.isActive).map((t) => ({ value: t.code, label: `${t.name} (${t.code})` }))} />
            </Form.Item>
          )}
          {editing?.key === "identity.directorConfirmsHrChanges" && (
            <Form.Item name="on" label="A director confirms HR's bank and statutory changes before they take effect" rules={[{ required: true }]}>
              <Select options={[{ value: "on", label: "On" }, { value: "off", label: "Off" }]} />
            </Form.Item>
          )}
          {editing?.key === "leave.leavingMonthAccrual" && (
            <>
              <Form.Item name="mode" label="Accrual in the month of leaving" rules={[{ required: true }]}>
                <Select options={Object.entries(MODE_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              {mode === "FULL_IF_MIN_DAYS" && (
                <Form.Item name="minDays" label="N: the least days worked for a full month (no default)" rules={[{ required: true, message: "Choose N" }]}>
                  <InputNumber min={1} max={31} style={{ width: "100%" }} />
                </Form.Item>
              )}
            </>
          )}
          {editing?.key === "leave.proRataRounding" && (
            <>
              <Form.Item name="roundMode" label="How a pro-rata leave figure is rounded" rules={[{ required: true }]}>
                <Select options={Object.entries(ROUND_LABEL).map(([value, label]) => ({ value, label }))} />
              </Form.Item>
              <Form.Item name="scale" label="Decimal places (0 to 2)" rules={[{ required: true }]}>
                <InputNumber min={0} max={2} style={{ width: "100%" }} />
              </Form.Item>
            </>
          )}
          {editing?.key === "loan.maxTotalDeductionPercent" && (
            <>
              <Form.Item name="percent" label="Most a month's deductions may take (% of gross)" rules={[{ required: true, pattern: /^\d{1,3}(\.\d{1,2})?$/, message: "A percentage" }]}>
                <Input inputMode="decimal" />
              </Form.Item>
              <Form.Item name="sourceNote" label="Source note (where the figure comes from)" rules={[{ required: true, min: 3 }]}>
                <Input />
              </Form.Item>
            </>
          )}
          {(editing?.key === "payroll.overtimePay" || editing?.key === "payroll.leaveEncashment") && (
            <>
              <Form.Item name="payHead" label="Paid as (pay head)" rules={[{ required: true, message: "Choose the pay head" }]}><Select options={earningHeads} /></Form.Item>
              {editing.key === "payroll.overtimePay" && (
                <>
                  <Form.Item name="rateMode" label="Rate" rules={[{ required: true }]}><Select options={[{ value: "FLAT_PER_HOUR", label: "A flat rate per hour" }, { value: "MULTIPLIER", label: "A multiplier of an hourly rate" }]} /></Form.Item>
                  <Form.Item noStyle shouldUpdate={(a, b) => a.rateMode !== b.rateMode}>
                    {({ getFieldValue }) =>
                      getFieldValue("rateMode") === "FLAT_PER_HOUR" ? (
                        <Form.Item name="perHour" label="Rupees per hour" rules={[{ required: true, pattern: /^\d{1,9}(\.\d{1,2})?$/, message: "Rupees, up to two decimals" }]}><Input inputMode="decimal" /></Form.Item>
                      ) : getFieldValue("rateMode") === "MULTIPLIER" ? (
                        <>
                          <Form.Item name="multiplier" label="Multiplier" rules={[{ required: true, pattern: /^\d{1,2}(\.\d{1,4})?$/, message: "For example 2" }]}><Input inputMode="decimal" /></Form.Item>
                          <Form.Item name="basisHeads" label="Hourly rate from these heads of the salary" rules={[{ required: true, message: "Choose the heads" }]}><Select mode="multiple" options={earningHeads} /></Form.Item>
                          <Form.Item name="hoursPerMonth" label="Divided by hours a month" rules={[{ required: true, pattern: /^\d{1,3}(\.\d{1,2})?$/, message: "Hours" }]}><Input inputMode="decimal" /></Form.Item>
                        </>
                      ) : null
                    }
                  </Form.Item>
                </>
              )}
              {editing.key === "payroll.leaveEncashment" && (
                <>
                  <Form.Item name="basisHeads" label="Per-day basis from these heads of the salary" rules={[{ required: true, message: "Choose the heads" }]}><Select mode="multiple" options={earningHeads} /></Form.Item>
                  <Form.Item name="divisorKind" label="Divided by" rules={[{ required: true }]}><Select options={[{ value: "FIXED_DAYS", label: "A fixed number of days" }, { value: "CALENDAR_DAYS", label: "The month's calendar days" }]} /></Form.Item>
                  <Form.Item noStyle shouldUpdate={(a, b) => a.divisorKind !== b.divisorKind}>
                    {({ getFieldValue }) => getFieldValue("divisorKind") === "FIXED_DAYS" ? <Form.Item name="divisorDays" label="Days" rules={[{ required: true, pattern: /^\d{1,2}(\.\d{1,2})?$/, message: "Days" }]}><Input inputMode="decimal" /></Form.Item> : null}
                  </Form.Item>
                  <Form.Item name="exitLeaveTypes" label="Leave types encashed at exit (codes)"><Select mode="tags" tokenSeparators={[","]} /></Form.Item>
                </>
              )}
              <Form.Item name="roundMode" label="Rounding" rules={[{ required: true }]}><Select options={PAY_ROUND} /></Form.Item>
              <Form.Item name="scale" label="Decimal places (0 to 2)" rules={[{ required: true }]}><InputNumber min={0} max={2} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="sourceNote" label="Source note (where the rule comes from)" rules={[{ required: true, min: 3 }]}><Input /></Form.Item>
            </>
          )}
          {editing?.key === "loan.shortfall" && (
            <Form.List name="rules">
              {(fields, { add, remove }) => (
                <>
                  {fields.map((f) => (
                    <div key={f.key} style={{ display: "flex", gap: space[2], flexWrap: "wrap", marginBottom: space[2] }}>
                      <Form.Item name={[f.name, "typeKey"]} rules={[{ required: true, message: "A loan type" }]} style={{ flex: 1, minWidth: 140, marginBottom: 0 }}>
                        <Select aria-label="Loan type" placeholder="Loan type" options={(types.data ?? []).map((t) => ({ value: t.typeKey, label: `${t.name} (${t.typeKey})` }))} />
                      </Form.Item>
                      <Form.Item name={[f.name, "rule"]} rules={[{ required: true, message: "A rule" }]} style={{ flex: 2, minWidth: 180, marginBottom: 0 }}>
                        <Select aria-label="Rule" placeholder="Rule" options={Object.entries(RULE_LABEL).map(([value, label]) => ({ value, label }))} />
                      </Form.Item>
                      <Button onClick={() => remove(f.name)}>Remove</Button>
                    </div>
                  ))}
                  <Button onClick={() => add()} style={{ marginBottom: space[3] }}>Add a loan type</Button>
                </>
              )}
            </Form.List>
          )}
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3 }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
