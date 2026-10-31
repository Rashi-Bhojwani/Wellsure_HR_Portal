import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Input, InputNumber, Radio, Select, Space } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { LEAVE_EMPLOYMENT_TYPES, LEAVE_RULE_LABELS } from "@shared/constants/peepsLeave";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import { fs, fw, space, v } from "../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, Panel, SideDrawer, StatusChip, toast } from "../../ui";
import * as api from "./api";
import type { LeaveRules, LeaveTypeRules, RuleVersion } from "./api";
import { describeRules } from "./rulesText";

// The four new leave types on the Leave Types & Policies page (Q-15). HR prepares a type's rules (every rule chosen by a person, nothing preset); a
// different director approves them with a start date; a new version switches the type off until it is approved. The year end leaves them out.

const PREPARE_FORM = "leave-rules-prepare";
const EMPLOYMENT_LABEL: Record<string, string> = { PERMANENT: "Permanent", CONTRACT: "Contract", INTERN: "Intern", CONSULTANT: "Consultant", PROBATION: "Probation" };

const stateChip = (t: LeaveTypeRules) =>
  t.state === "APPROVED" ? (
    <StatusChip tone="success">{t.isActive ? "Approved" : "Approved, switched off"}</StatusChip>
  ) : t.state === "AWAITING_APPROVAL" ? (
    <StatusChip tone="warning">{t.voidedVersion ? "Changed: awaiting a director" : "Awaiting a director"}</StatusChip>
  ) : (
    <StatusChip tone="neutral">Not set</StatusChip>
  );

function RulesList({ version }: { version: RuleVersion }) {
  return (
    <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(120px, auto) 1fr", gap: `${space[1]}px ${space[3]}px`, fontSize: fs.sm }}>
      {describeRules(version.rules).map((row) => (
        <div key={row.label} style={{ display: "contents" }}>
          <dt style={{ color: v.textSecondary }}>{row.label}</dt>
          <dd style={{ margin: 0, color: v.textBody }}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface FormValues {
  paid?: boolean;
  kind?: "CAP" | "GRANTED_BALANCE";
  period?: "PER_REQUEST" | "PER_CALENDAR_YEAR" | "PER_EMPLOYMENT";
  days?: string;
  minServiceDays?: number;
  employmentTypes?: string[];
  units?: LeaveRules["units"];
  counting?: LeaveRules["counting"];
  documentRequired?: boolean;
  whenMoreThanDays?: number;
  approvalRoute?: LeaveRules["approvalRoute"];
  carryForward?: "LAPSE" | "CARRY_FORWARD";
  encashment?: "NONE" | "ENCASH_UNUSED";
  note?: string;
}

function toRules(f: FormValues): LeaveRules {
  return {
    paid: f.paid!,
    entitlement: f.kind === "CAP" ? { kind: "CAP", period: f.period!, days: String(f.days).trim() } : { kind: "GRANTED_BALANCE" },
    eligibility: { minServiceDays: f.minServiceDays!, employmentTypes: f.employmentTypes ?? [] },
    units: f.units!,
    counting: f.counting!,
    document: { required: f.documentRequired!, whenMoreThanDays: f.documentRequired ? (f.whenMoreThanDays ?? 0) : 0 },
    approvalRoute: f.approvalRoute!,
    yearEnd: f.carryForward && f.encashment ? { carryForward: f.carryForward, encashment: f.encashment } : null,
  };
}

const required = [{ required: true, message: "Choose one." }];

function PrepareDrawer({ type, onClose }: { type: LeaveTypeRules | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [form] = Form.useForm<FormValues>();
  const kind = Form.useWatch("kind", form);
  const documentRequired = Form.useWatch("documentRequired", form);
  const save = useMutation({
    mutationFn: (values: FormValues) => api.prepareRules(type!.code, toRules(values), values.note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave-rules"] });
      toast.success("Rules prepared. A director who did not prepare them approves them.");
      form.resetFields();
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't prepare the rules.")),
  });
  const radio = (opts: Array<{ value: string | boolean; label: string }>) => (
    <Radio.Group>
      <Space direction="vertical" size={space[1]}>
        {opts.map((o) => (
          <Radio key={String(o.value)} value={o.value}>
            {o.label}
          </Radio>
        ))}
      </Space>
    </Radio.Group>
  );
  return (
    <SideDrawer
      open={type !== null}
      onClose={onClose}
      title={type ? `Prepare rules: ${type.name}` : "Prepare rules"}
      subtitle="Every rule is your choice; nothing is filled in for you. A different director approves them before anyone can apply."
      formId={PREPARE_FORM}
      primaryLabel="Prepare"
      primaryLoading={save.isPending}
      size="wide"
    >
      <Form id={PREPARE_FORM} form={form} layout="vertical" requiredMark={false} onFinish={(values) => save.mutate(values)}>
        <Form.Item name="paid" label="Paid or unpaid" rules={required}>
          {radio([{ value: true, label: "Paid" }, { value: false, label: "Unpaid" }])}
        </Form.Item>
        <Form.Item name="kind" label="Entitlement" rules={required}>
          {radio([{ value: "CAP", label: "A limit in days" }, { value: "GRANTED_BALANCE", label: LEAVE_RULE_LABELS.GRANTED_BALANCE }])}
        </Form.Item>
        {kind === "CAP" && (
          <Space wrap align="start" size={space[3]}>
            <Form.Item name="period" label="Limit per" rules={required}>
              <Select style={{ minWidth: 220 }} options={[{ value: "PER_REQUEST", label: "Request" }, { value: "PER_CALENDAR_YEAR", label: "Calendar year" }, { value: "PER_EMPLOYMENT", label: "Whole employment" }]} />
            </Form.Item>
            <Form.Item name="days" label="Days" rules={[{ required: true, pattern: /^\d{1,3}(\.\d{1,2})?$/, message: "A number of days, such as 3 or 1.5." }]}>
              <Input inputMode="decimal" style={{ width: 120 }} />
            </Form.Item>
          </Space>
        )}
        <Space wrap align="start" size={space[3]}>
          <Form.Item name="minServiceDays" label="Eligible after (days from joining)" rules={[{ required: true, message: "Enter a number (0 for from joining)." }]}>
            <InputNumber min={0} max={3650} style={{ width: 160 }} />
          </Form.Item>
          <Form.Item name="employmentTypes" label="Employment types" rules={[{ required: true, type: "array", min: 1, message: "Choose at least one." }]}>
            <Checkbox.Group options={LEAVE_EMPLOYMENT_TYPES.map((t) => ({ value: t, label: EMPLOYMENT_LABEL[t] }))} />
          </Form.Item>
        </Space>
        <Form.Item name="units" label="Units" rules={required}>
          {radio([{ value: "FULL_DAY", label: LEAVE_RULE_LABELS.FULL_DAY }, { value: "HALF_DAY", label: LEAVE_RULE_LABELS.HALF_DAY }])}
        </Form.Item>
        <Form.Item name="counting" label="Holidays and week-offs inside the dates" rules={required} extra="Overlapping another leave request is always refused.">
          {radio([{ value: "WORKING_DAYS", label: LEAVE_RULE_LABELS.WORKING_DAYS }, { value: "CALENDAR_DAYS", label: LEAVE_RULE_LABELS.CALENDAR_DAYS }])}
        </Form.Item>
        <Form.Item name="documentRequired" label="Supporting document" rules={required} extra="Only HR and the directors ever see it.">
          {radio([{ value: false, label: "Not required" }, { value: true, label: "Required" }])}
        </Form.Item>
        {documentRequired === true && (
          <Form.Item name="whenMoreThanDays" label="Required for requests longer than (days; 0 = always)" rules={[{ required: true, message: "Enter a number." }]}>
            <InputNumber min={0} max={365} style={{ width: 160 }} />
          </Form.Item>
        )}
        <Form.Item name="approvalRoute" label="Who decides a request" rules={required}>
          {radio([{ value: "MANAGER_OR_HR", label: LEAVE_RULE_LABELS.MANAGER_OR_HR }, { value: "HR_ONLY", label: LEAVE_RULE_LABELS.HR_ONLY }])}
        </Form.Item>
        <Form.Item label="Year end" extra={kind === "GRANTED_BALANCE" ? "Needed for a granted balance. Payroll processes it later; until then the type stays out of the year end." : "Optional. The type stays out of the year end until payroll processes it."}>
          <Space wrap align="start" size={space[3]}>
            <Form.Item name="carryForward" noStyle rules={kind === "GRANTED_BALANCE" ? required : []}>
              <Select allowClear placeholder="Unused balance…" style={{ minWidth: 240 }} options={[{ value: "LAPSE", label: LEAVE_RULE_LABELS.LAPSE }, { value: "CARRY_FORWARD", label: LEAVE_RULE_LABELS.CARRY_FORWARD }]} />
            </Form.Item>
            <Form.Item name="encashment" noStyle rules={kind === "GRANTED_BALANCE" ? required : []}>
              <Select allowClear placeholder="Encashment…" style={{ minWidth: 240 }} options={[{ value: "NONE", label: LEAVE_RULE_LABELS.NONE }, { value: "ENCASH_UNUSED", label: LEAVE_RULE_LABELS.ENCASH_UNUSED }]} />
            </Form.Item>
          </Space>
        </Form.Item>
        <Form.Item name="note" label="Note for the approving director" rules={[{ max: 500 }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

function ApproveModal({ type, onClose }: { type: LeaveTypeRules | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [from, setFrom] = useState<Dayjs | null>(dayjs());
  const approve = useMutation({
    mutationFn: () => api.approveRules(type!.code, type!.awaiting!.version, from!.format("YYYY-MM-DD")),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave-rules"] });
      void queryClient.invalidateQueries({ queryKey: ["leave"] });
      toast.success("Approved. The type can be applied for from the start date.");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't approve the rules.")),
  });
  return (
    <ConfirmModal
      open={type !== null}
      onCancel={onClose}
      onConfirm={() => approve.mutate()}
      title={type ? `Approve rules: ${type.name}` : "Approve rules"}
      info="Prepared by someone else; your approval switches the type on from the start date. Any later change switches it off again until approved."
      confirmLabel="Approve"
      loading={approve.isPending}
      confirmDisabled={!from}
      width={560}
    >
      {type?.awaiting && <RulesList version={type.awaiting} />}
      <label htmlFor="leave-rules-from" style={{ display: "block", margin: `${space[4]}px 0 ${space[2]}px`, color: v.textBody }}>
        Starts on
      </label>
      <DatePicker id="leave-rules-from" value={from} onChange={setFrom} disabledDate={(d) => d.isBefore(dayjs(), "day")} format="DD MMM YYYY" style={{ width: "100%" }} />
    </ConfirmModal>
  );
}

function HistoryDrawer({ type, onClose }: { type: LeaveTypeRules | null; onClose: () => void }) {
  return (
    <SideDrawer open={type !== null} onClose={onClose} title={type ? `Rule history: ${type.name}` : "Rule history"} footer={null} size="wide">
      {type && type.history.length === 0 ? (
        <EmptyState compact illustration={false} title="No rules yet" description={null} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
          {type?.history.map((h) => (
            <section key={h.version} aria-label={`Version ${h.version}`}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: space[2], alignItems: "center", marginBottom: space[2] }}>
                <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>Version {h.version}</span>
                {h.approval ? <StatusChip tone="success">Approved from {formatDate(h.approval.effectiveFrom)}</StatusChip> : <StatusChip tone="warning">Not approved</StatusChip>}
              </div>
              <div style={{ fontSize: fs.sm, color: v.textSecondary, marginBottom: space[2] }}>
                Prepared by {h.preparedBy} on {formatDate(h.preparedAt)}
                {h.approval && h.approvedBy ? ` · approved by ${h.approvedBy} on ${formatDate(h.approval.approvedAt)}` : ""}
              </div>
              <RulesList version={h} />
            </section>
          ))}
        </div>
      )}
    </SideDrawer>
  );
}

export function NewLeaveTypesPanel() {
  const { hasPermission, hasRole } = useAuth();
  const isDirector = hasRole("SUPER_ADMIN");
  const canPrepare = hasPermission("leave.policy.manage") && !hasRole("DEVELOPER");
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["leave-rules"], queryFn: api.listRules, enabled: canPrepare });
  const [preparing, setPreparing] = useState<LeaveTypeRules | null>(null);
  const [approving, setApproving] = useState<LeaveTypeRules | null>(null);
  const [history, setHistory] = useState<LeaveTypeRules | null>(null);
  if (!canPrepare) return null;

  const actions = (t: LeaveTypeRules) => (
    <Space wrap size={space[2]}>
      {isDirector && t.awaiting && !t.awaiting.preparedByMe && (
        <Button type="primary" onClick={() => setApproving(t)}>
          Approve
        </Button>
      )}
      <Button onClick={() => setPreparing(t)}>{t.state === "NOT_SET" ? "Prepare rules" : "Change rules"}</Button>
      <Button onClick={() => setHistory(t)}>History</Button>
    </Space>
  );
  const summary = (t: LeaveTypeRules) =>
    t.inForce ? `From ${formatDate(t.inForce.approval!.effectiveFrom)} · ${t.inForce.rules.paid ? "paid" : "unpaid"}` : t.awaiting ? `Prepared by ${t.awaiting.preparedBy}` : "Nobody can apply yet";

  return (
    <Panel title="New leave types" subtitle="Menstrual, medical, wedding and bereavement leave: rules prepared by HR, approved by a different director">
      <ApprovalBanner tone="info" title="Nothing is set until you set it" description="Each type stays switched off until its rules are approved. Changing approved rules switches it off again until the change is approved. These types are left out of the year end." />
      <DataTable<LeaveTypeRules>
        rowKey="code"
        loading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data ?? []}
        pagination={false}
        columns={[
          { title: "Type", key: "name", render: (_: unknown, t) => <span style={{ fontWeight: fw.medium, color: v.textPrimary }}>{t.name}</span> },
          { title: "State", key: "state", render: (_: unknown, t) => stateChip(t) },
          { title: "In force", key: "summary", render: (_: unknown, t) => <span style={{ color: v.textBody }}>{summary(t)}</span> },
          { title: "", key: "actions", align: "right", render: (_: unknown, t) => actions(t) },
        ]}
        mobile={{ title: (t) => t.name, subtitle: summary, status: stateChip, actions }}
      />
      <PrepareDrawer type={preparing} onClose={() => setPreparing(null)} />
      <ApproveModal type={approving} onClose={() => setApproving(null)} />
      <HistoryDrawer type={history} onClose={() => setHistory(null)} />
    </Panel>
  );
}
