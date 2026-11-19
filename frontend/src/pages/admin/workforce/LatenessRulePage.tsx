import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Select } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import * as api from "../../../api/lateness";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, StatusChip, toast } from "../../../ui";

// Lateness rule (docs/plans/LATE_CHECKLIST.md): directors only. Every value is a setting one director proposes and a different director confirms, from the 1st of a
// month. Missing punch and half-day thresholds keep today's behaviour until chosen ("Default in use"). Penalties are posted as payroll deductions here.

const LAW = "Fines deducted from wages are regulated by law (the Payment of Wages Act, 1936, and its replacement, the Code on Wages, 2019). The directors should confirm the penalty option is allowed for their case before using it. The portal does not give legal advice.";
const MISSING_LABEL: Record<api.MissingPunch["outcome"], string> = { ABSENT_FULL_DAY: "Absent, a full day of loss of pay (today's behaviour)", HALF_DAY: "A half day: 0.5 day of loss of pay", PRESENT_FLAGGED: "Present, no loss of pay; flagged for a regularization" };
const edgeText = (e: api.Edge) => (e === "INCLUSIVE" ? "the minute itself is late" : "late from the next minute");
const bandLabel = (r: api.LateRule, i: number) => (i === 2 ? `after ${r.cutoffs[2].time}` : `${r.cutoffs[i]!.time} to ${r.cutoffs[i + 1]!.time}`);

function RuleSummary({ r }: { r: api.LateRule }) {
  return (
    <KeyValueGrid
      columns={2}
      items={[
        { label: "Switched", value: r.active ? "On" : "Off" },
        { label: "From", value: formatDate(r.effectiveFrom) },
        ...r.cutoffs.map((c, i) => ({ label: `Cutoff ${i + 1}`, value: `${c.time} (${edgeText(c.edge)})` })),
        ...r.bands.map((b, i) => ({ label: `Band ${bandLabel(r, i)}`, value: api.outcomeText(b.outcome, b.applies) })),
        { label: "Penalty deduction head", value: r.penaltyHead ?? "None" },
      ]}
    />
  );
}

function OtherSummary({ s, value }: { s: api.LateSetting; value: api.MissingPunch | api.HalfDay }) {
  if (s.key === "late.missingPunch") return <span>{MISSING_LABEL[(value as api.MissingPunch).outcome]}, from {formatDate(value.effectiveFrom)}</span>;
  const h = value as api.HalfDay;
  return <span>Full day {h.fullDayMinMinutes} min, half day {h.halfDayMinMinutes} min, half-day minimum not met: {h.halfDayMinNotMetLopDays} day lost; from {formatDate(h.effectiveFrom)}</span>;
}

type RuleForm = { month: Dayjs; active: boolean; cutoffs: api.Cutoff[]; bands: Array<{ kind: api.Outcome["kind"]; days?: string; amount?: string; mode: "EVERY_TIME" | "AFTER_FREE"; free?: number }>; penaltyHead?: string; outcome?: api.MissingPunch["outcome"]; fullDayMinMinutes?: number; halfDayMinMinutes?: number; halfDayMinNotMetLopDays?: "0.5" | "1"; reason: string };

function toForm(s: api.LateSetting): Partial<RuleForm> {
  const nextMonth = dayjs().add(1, "month").startOf("month");
  if (s.key === "late.rule") {
    const r = (s.inForce as api.LateRule | null) ?? s.starting!;
    return { month: nextMonth, active: r.active, cutoffs: r.cutoffs, penaltyHead: r.penaltyHead ?? undefined, bands: r.bands.map((b) => ({ kind: b.outcome.kind, days: b.outcome.kind === "CUT" ? b.outcome.days : "0.5", amount: b.outcome.kind === "PENALTY" ? b.outcome.amount : undefined, mode: b.applies.mode, free: b.applies.mode === "AFTER_FREE" ? b.applies.free : 3 })), reason: "" };
  }
  if (s.key === "late.missingPunch") return { month: nextMonth, outcome: (s.inForce as api.MissingPunch | null)?.outcome ?? "ABSENT_FULL_DAY", reason: "" };
  const h = s.inForce as api.HalfDay | null;
  return { month: nextMonth, fullDayMinMinutes: h?.fullDayMinMinutes ?? 480, halfDayMinMinutes: h?.halfDayMinMinutes ?? 240, halfDayMinNotMetLopDays: h?.halfDayMinNotMetLopDays ?? "1", reason: "" };
}

function fromForm(key: api.SettingKey, f: RuleForm): unknown {
  const effectiveFrom = f.month.startOf("month").format("YYYY-MM-DD");
  if (key === "late.missingPunch") return { effectiveFrom, outcome: f.outcome };
  if (key === "late.halfDay") return { effectiveFrom, fullDayMinMinutes: f.fullDayMinMinutes, halfDayMinMinutes: f.halfDayMinMinutes, halfDayMinNotMetLopDays: f.halfDayMinNotMetLopDays };
  return {
    effectiveFrom,
    active: f.active,
    cutoffs: f.cutoffs.map((c) => ({ time: c.time, edge: c.edge })),
    bands: f.bands.map((b) => ({ outcome: b.kind === "CUT" ? { kind: "CUT", days: b.days } : b.kind === "PENALTY" ? { kind: "PENALTY", amount: String(b.amount ?? "").trim() } : { kind: b.kind }, applies: b.mode === "AFTER_FREE" ? { mode: "AFTER_FREE", free: b.free } : { mode: "EVERY_TIME" } })),
    penaltyHead: f.penaltyHead?.trim() ? f.penaltyHead.trim().toUpperCase() : null,
  };
}

function RuleFields() {
  const bands = Form.useWatch("bands") as RuleForm["bands"] | undefined;
  return (
    <>
      <Form.Item name="active" label="Switched" rules={[{ required: true }]}>
        <Select options={[{ value: false, label: "Off: nothing changes anywhere" }, { value: true, label: "On" }]} />
      </Form.Item>
      {[0, 1, 2].map((i) => (
        <div key={i} style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
          <Form.Item name={["cutoffs", i, "time"]} label={`Cutoff ${i + 1} (HH:MM)`} rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "HH:MM" }]} style={{ flex: "1 1 120px" }}>
            <Input inputMode="numeric" />
          </Form.Item>
          <Form.Item name={["cutoffs", i, "edge"]} label="The edge minute" style={{ flex: "2 1 200px" }}>
            <Select options={[{ value: "INCLUSIVE", label: "Counts as late (inclusive)" }, { value: "EXCLUSIVE", label: "Not late yet (exclusive)" }]} />
          </Form.Item>
        </div>
      ))}
      {[0, 1, 2].map((i) => (
        <fieldset key={i} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, padding: space[3], marginBottom: space[3] }}>
          <legend style={{ fontSize: fs.md, padding: `0 ${space[1]}px` }}>Band {i + 1} {i === 0 ? "(cutoff 1 to 2)" : i === 1 ? "(cutoff 2 to 3)" : "(after cutoff 3)"}</legend>
          <Form.Item name={["bands", i, "kind"]} label="Outcome">
            <Select options={[{ value: "NOT_SET", label: "Not set (behaves as no consequence)" }, { value: "NONE", label: "No consequence" }, { value: "MARK", label: "Late mark only" }, { value: "CUT", label: "Salary cut (days, through loss of pay)" }, { value: "PENALTY", label: "Penalty (rupees, its own payslip deduction)" }]} />
          </Form.Item>
          {bands?.[i]?.kind === "CUT" && (
            <Form.Item name={["bands", i, "days"]} label="Days of pay">
              <Select options={["0.5", "1", "1.5", "2"].map((d) => ({ value: d, label: `${d} day` }))} />
            </Form.Item>
          )}
          {bands?.[i]?.kind === "PENALTY" && (
            <Form.Item name={["bands", i, "amount"]} label="Rupees" rules={[{ required: true, pattern: /^\d{1,6}(\.\d{1,2})?$/, message: "Rupees, up to two decimals" }]}>
              <Input inputMode="decimal" />
            </Form.Item>
          )}
          <Form.Item name={["bands", i, "mode"]} label="Applies">
            <Select options={[{ value: "EVERY_TIME", label: "Every time" }, { value: "AFTER_FREE", label: "Only after free allowances each month" }]} />
          </Form.Item>
          {bands?.[i]?.mode === "AFTER_FREE" && (
            <Form.Item name={["bands", i, "free"]} label="Free allowances a month" rules={[{ required: true }]}>
              <InputNumber min={1} max={31} style={{ width: "100%" }} />
            </Form.Item>
          )}
        </fieldset>
      ))}
      <Form.Item name="penaltyHead" label="Penalty deduction head (a deduction under Payroll, Salary Components)" extra="Needed only when a band is a penalty.">
        <Input />
      </Form.Item>
    </>
  );
}

function Penalties() {
  const queryClient = useQueryClient();
  const [month, setMonth] = useState<Dayjs>(dayjs().subtract(1, "month"));
  const [confirming, setConfirming] = useState(false);
  const m = month.format("YYYY-MM");
  const q = useQuery({ queryKey: ["lateness", "penalties", m], queryFn: () => api.penaltyPlan(m) });
  const post = useMutation({ mutationFn: () => api.postPenalties(m, q.data!.fingerprint), onSuccess: (r) => { toast.success(`Posted ${r.posted}, cancelled ${r.cancelled}. Calculate the month's run again.`); setConfirming(false); void queryClient.invalidateQueries({ queryKey: ["lateness", "penalties"] }); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not post them.")) });
  const toPost = (q.data?.rows ?? []).filter((r) => r.status === "TO_POST").length;
  return (
    <Panel
      title="Penalties to payroll"
      subtitle="Each penalised arrival becomes one deduction line for the next payroll run. On a day that also loses pay for short hours, only the higher applies: calculate the month's run first so that loss can be valued."
      extra={<DatePicker picker="month" value={month} onChange={(d) => d && setMonth(d)} allowClear={false} aria-label="Penalty month" />}
    >
      <DataTable<api.PenaltyRow>
        rowKey={(r) => `${r.employeeId}|${r.date}`}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data?.rows ?? []}
        pagination={false}
        empty={<EmptyState compact title={q.data?.active ? "No penalties this month" : "The lateness rule was not in use this month"} description={null} />}
        columns={[
          { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
          { title: "Day", key: "d", render: (_, r) => `${formatDate(r.date)} ${r.time}` },
          { title: "Penalty", key: "p", render: (_, r) => `₹${r.penalty}` },
          { title: "Short-hours loss that day", key: "h", render: (_, r) => (r.hoursLop === "0" ? "None" : `${r.hoursLop} day${r.hoursValue ? ` (₹${r.hoursValue})` : ""}`) },
          { title: "Line", key: "c", render: (_, r) => (r.charge ? `₹${r.charge}` : "—") },
          { title: "Status", key: "s", render: (_, r) => <span><StatusChip tone={r.status === "POSTED" || r.status === "ALREADY_PAID" ? "success" : r.status === "TO_POST" ? "info" : r.status === "NEEDS_CALCULATED_RUN" ? "warning" : "neutral"}>{r.status.replace(/_/g, " ").toLowerCase()}</StatusChip>{r.note ? ` ${r.note}` : ""}</span> },
        ]}
        mobile={{ title: (r) => r.name, subtitle: (r) => `${formatDate(r.date)} ${r.time} · line ${r.charge ? `₹${r.charge}` : "—"}`, status: (r) => <StatusChip tone="neutral">{r.status.replace(/_/g, " ").toLowerCase()}</StatusChip> }}
      />
      <div style={{ marginTop: space[3], display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
        <Button type="primary" disabled={!q.data || q.data.blocked || (toPost === 0 && q.data.toCancel.length === 0)} onClick={() => setConfirming(true)}>Post to payroll</Button>
        {q.data?.toCancel.length ? <span>{q.data.toCancel.length} earlier line(s) no longer due will be cancelled.</span> : null}
      </div>
      <ConfirmModal open={confirming} title="Post lateness penalties" confirmLabel="Post" description={`${toPost} deduction line(s) for ${month.format("MMMM YYYY")}${q.data?.toCancel.length ? `, and ${q.data.toCancel.length} cancelled` : ""}. The month's run must be calculated again.`} loading={post.isPending} onCancel={() => setConfirming(false)} onConfirm={() => post.mutate()} />
    </Panel>
  );
}

export function LatenessRulePage() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<api.LateSetting | null>(null);
  const [form] = Form.useForm<RuleForm>();
  const q = useQuery({ queryKey: ["lateness", "settings"], queryFn: api.lateSettings });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["lateness"] });
  const propose = useMutation({ mutationFn: (f: RuleForm) => api.proposeLate(editing!.key, fromForm(editing!.key, f), f.reason), onSuccess: () => { toast.success("Proposed. A different director confirms it before it takes effect."); setEditing(null); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not propose it.")) });
  const confirm = useMutation({ mutationFn: api.confirmLate, onSuccess: () => { toast.success("Confirmed. Open days from its start are worked out again."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not confirm it.")) });
  const open = (s: api.LateSetting) => { form.resetFields(); form.setFieldsValue(toForm(s)); setEditing(s); };
  return (
    <>
      <PageHeader title="Lateness rule" subtitle="One director proposes, a different director confirms, from the 1st of a month. A finalised month is never changed. While the rule is off, nothing changes anywhere." />
      <ApprovalBanner tone="warning" title="Owner review: penalties" description={LAW} style={{ marginBottom: space[5] }} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()}>
        <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
          {(q.data?.settings ?? []).map((s) => {
            const rule = s.key === "late.rule" ? (s.inForce as api.LateRule | null) : null;
            const chip = s.key === "late.rule" ? (rule?.active ? <StatusChip tone="success">On</StatusChip> : <StatusChip tone="neutral">Off</StatusChip>) : s.defaultInUse ? <StatusChip tone="info">Default in use</StatusChip> : <StatusChip tone="success">Chosen</StatusChip>;
            return (
              <Panel key={s.key} title={s.title} subtitle={s.what} extra={chip}>
                {s.key === "late.rule" ? (
                  rule ? <RuleSummary r={rule} /> : (
                    <>
                      <p style={{ marginTop: 0 }}>{s.defaultText}.</p>
                      <p style={{ color: v.textSecondary, fontSize: fs.sm }}>The owners' proposed starting values (not in force):</p>
                      <RuleSummary r={s.starting!} />
                    </>
                  )
                ) : s.inForce ? <OtherSummary s={s} value={s.inForce as api.MissingPunch | api.HalfDay} /> : <p style={{ margin: 0 }}>{s.defaultText}</p>}
                {s.history[0] && <p style={{ color: v.textSecondary, fontSize: fs.sm }}>Last confirmed: proposed by {s.history[0].proposedBy}, confirmed by {s.history[0].confirmedBy}. Reason: {s.history[0].reason}</p>}
                {s.pending.map((p) => (
                  <div key={p.id} style={{ display: "flex", flexDirection: "column", gap: space[2], margin: `${space[3]}px 0`, padding: space[3], border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm }}>
                    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center" }}>
                      <StatusChip tone="warning">Waiting for a different director</StatusChip>
                      <span>Proposed by {p.proposedBy}: {p.reason}</span>
                    </div>
                    {s.key === "late.rule" ? <RuleSummary r={p.value as api.LateRule} /> : <OtherSummary s={s} value={p.value as api.MissingPunch | api.HalfDay} />}
                    {!p.mine && <div><Button type="primary" loading={confirm.isPending} onClick={() => confirm.mutate(p.id)}>Confirm</Button></div>}
                  </div>
                ))}
                <Button onClick={() => open(s)}>{s.key === "late.rule" && !rule?.active ? "Propose (or switch on)" : "Propose a change"}</Button>
              </Panel>
            );
          })}
          <Penalties />
        </div>
      </QueryState>
      <SideDrawer open={!!editing} title={editing?.title ?? ""} subtitle="Takes effect only when a different director confirms it. Every change is audited." onClose={() => setEditing(null)} formId="late-setting-form" primaryLabel="Propose" primaryLoading={propose.isPending}>
        <Form id="late-setting-form" form={form} layout="vertical" requiredMark={false} onFinish={(f) => propose.mutate(f)}>
          <Form.Item name="month" label="From the 1st of" rules={[{ required: true }]}>
            <DatePicker picker="month" style={{ width: "100%" }} allowClear={false} />
          </Form.Item>
          {editing?.key === "late.rule" && <RuleFields />}
          {editing?.key === "late.missingPunch" && (
            <Form.Item name="outcome" label="A working day with a single punch becomes">
              <Select options={Object.entries(MISSING_LABEL).map(([value, label]) => ({ value, label }))} />
            </Form.Item>
          )}
          {editing?.key === "late.halfDay" && (
            <>
              <Form.Item name="fullDayMinMinutes" label="Minutes for a full day" rules={[{ required: true }]}><InputNumber min={60} max={1440} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="halfDayMinMinutes" label="Minutes for a half day" rules={[{ required: true }]}><InputNumber min={30} max={1440} style={{ width: "100%" }} /></Form.Item>
              <Form.Item name="halfDayMinNotMetLopDays" label="Loss of pay when the half-day minimum is not met"><Select options={[{ value: "1", label: "1 day" }, { value: "0.5", label: "0.5 day" }]} /></Form.Item>
            </>
          )}
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "A reason of a few words" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
