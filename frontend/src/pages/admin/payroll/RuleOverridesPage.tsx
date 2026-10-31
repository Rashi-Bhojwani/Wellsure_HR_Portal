import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Segmented, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { OVERRIDABLE_RULE_KEYS, RULE_BY_KEY } from "@shared/constants/payrollRules";
import * as payrollApi from "../../../api/payroll";
import * as org from "../../../api/org";
import type { PersonHit, RuleOverrideInput, RuleOverrideView } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Rule overrides. The company's rule is the default for PF, ESI, professional tax and labour welfare fund; a department can have its own, and a person
// can have theirs; the most specific wins. Every override has dates, a reason, a source note, and is a Placeholder until a different director confirms it.
// A payroll run that uses a Placeholder override is a test run. There are none until a director makes one.

const valueText = (v: unknown): string => (typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(v));

/**
 * What the director typed, as the rule's value. Every overridable rule takes text (a rate such as "10", an amount, a choice), a list (employment types) or a table;
 * so only text that starts like a list or a table is read as JSON, and everything else is sent as the text it is (never as a number).
 */
const parseTyped = (text: string): unknown => {
  const t = text.trim();
  if (t.startsWith("{") || t.startsWith("[")) {
    try {
      return JSON.parse(t);
    } catch {
      return t;
    }
  }
  return t;
};

export function RuleOverridesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canManage = hasPermission("payroll.rules.manage");
  const canConfirm = hasPermission("payroll.rules.confirm");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<RuleOverrideView | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "rule-overrides"], queryFn: payrollApi.listRuleOverrides });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const addButton = canManage && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
      Add an override
    </Button>
  );
  const confirmButton = (o: RuleOverrideView, block?: boolean) =>
    canConfirm && o.status !== "CONFIRMED" ? (
      <Button size={block ? undefined : "small"} block={block} onClick={() => setConfirming(o)}>
        Confirm
      </Button>
    ) : null;
  const statusChip = (o: RuleOverrideView) => <StatusChip tone={o.status === "CONFIRMED" ? "success" : "warning"}>{o.status === "CONFIRMED" ? "Confirmed" : "Placeholder"}</StatusChip>;
  const dates = (o: RuleOverrideView) => `${formatDate(o.effectiveFrom)} to ${o.effectiveTo ? formatDate(o.effectiveTo) : "no end date"}`;

  return (
    <>
      <PageHeader title="Rule overrides" subtitle="Where a department or a person is treated differently from the company's PF, ESI, PT or LWF rule" actions={addButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="The most specific rule wins"
          description="The company's rule is the default. A department override replaces it for that department; a person's own override replaces both. Each is saved as a Placeholder with its dates, a reason and a source note, and a different director confirms it by typing the value in again. A payroll run that uses a Placeholder override is a test run."
        />
        <Panel>
          <DataTable<RuleOverrideView>
            rowKey="itemKey"
            density="compact"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data}
            empty={<EmptyState compact title="No overrides" description={canManage ? "Everyone is calculated under the company's rules. Add an override only where a department or a person is genuinely different." : "Everyone is calculated under the company's rules."} action={addButton || undefined} />}
            mobile={{
              title: (o) => o.ruleLabel,
              subtitle: (o) => `${o.level === "EMPLOYEE" ? "Person" : "Department"}: ${o.targetName}`,
              status: statusChip,
              fields: [
                { label: "Value", render: (o) => valueText(o.value) },
                { label: "Applies", render: dates },
                { label: "Why", render: (o) => o.reason },
              ],
              actions: canConfirm ? (o) => confirmButton(o, true) : undefined,
            }}
            columns={[
              { title: "Rule", key: "rule", render: (_, o) => <div>{o.ruleLabel}<Caption>{o.level === "EMPLOYEE" ? "For a person" : "For a department"}</Caption></div> },
              { title: "For", key: "for", render: (_, o) => (o.level === "EMPLOYEE" ? <PersonCell name={o.targetName} code="" /> : o.targetName) },
              { title: "Value", key: "value", render: (_, o) => <span className="ws-num">{valueText(o.value)}</span> },
              { title: "Applies", key: "applies", render: (_, o) => dates(o) },
              { title: "Why and where from", key: "why", render: (_, o) => <div>{o.reason}<Caption>{o.sourceNote}{o.registrationRef ? ` · registration ${o.registrationRef}` : ""}</Caption></div> },
              { title: "Status", key: "status", render: (_, o) => statusChip(o) },
              { title: "", key: "actions", align: "right", render: (_, o) => confirmButton(o) },
            ]}
          />
        </Panel>
      </Stack>
      {adding && <OverrideDrawer onClose={() => setAdding(false)} onDone={refresh} />}
      {confirming && <ConfirmOverrideModal row={confirming} onClose={() => setConfirming(null)} onDone={refresh} />}
    </>
  );
}

function OverrideDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [ruleKey, setRuleKey] = useState<string>();
  const [level, setLevel] = useState<"DEPARTMENT" | "EMPLOYEE">("DEPARTMENT");
  const [targetId, setTargetId] = useState<string>();
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [valueText_, setValueText] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [sourceNote, setSourceNote] = useState("");
  const [registrationRef, setRegistrationRef] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: org.departments.list });
  const ready = !!ruleKey && !!targetId && valueText_.trim() !== "" && /^\d{4}-\d{2}-\d{2}$/.test(from) && reason.trim().length >= 3 && sourceNote.trim().length >= 10;
  const input = (): RuleOverrideInput => ({ ruleKey: ruleKey!, level, targetId: targetId!, value: parseTyped(valueText_), effectiveFrom: from, effectiveTo: to.trim() || null, reason: reason.trim(), sourceNote: sourceNote.trim(), registrationRef: registrationRef.trim() || null });
  const save = useMutation({
    mutationFn: async () => {
      const p = await payrollApi.previewRuleOverride(input());
      return payrollApi.saveRuleOverride(input(), p.fingerprint);
    },
    onSuccess: () => {
      toast.success("Saved as a Placeholder. A different director confirms it.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not save it.")),
  });
  const edited = () => setProblem(null);
  const example = ruleKey ? RULE_BY_KEY[ruleKey] : undefined;
  return (
    <SideDrawer
      open
      title="Add an override"
      subtitle="Saved as a Placeholder until a different director confirms it"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          <Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          <Button size="large" type="primary" style={{ flex: 1 }} disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Save</Button>
        </div>
      }
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Which rule" htmlFor="ov-rule">
          <Select id="ov-rule" showSearch optionFilterProp="label" placeholder="Choose" value={ruleKey} onChange={(v) => { setRuleKey(v); edited(); }} options={OVERRIDABLE_RULE_KEYS.map((k) => ({ value: k, label: RULE_BY_KEY[k]?.label ?? k }))} />
        </Form.Item>
        <Form.Item label="For">
          <Segmented aria-label="For" value={level} onChange={(v) => { setLevel(v as "DEPARTMENT" | "EMPLOYEE"); setTargetId(undefined); edited(); }} options={[{ value: "DEPARTMENT", label: "A department" }, { value: "EMPLOYEE", label: "One person" }]} />
        </Form.Item>
        <Form.Item label={level === "DEPARTMENT" ? "Which department" : "Who"} htmlFor="ov-target">
          {level === "DEPARTMENT" ? (
            <Select id="ov-target" showSearch optionFilterProp="label" placeholder="Choose" value={targetId} onChange={(v) => { setTargetId(v); edited(); }} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          ) : (
            <Select
              id="ov-target"
              showSearch
              filterOption={false}
              placeholder="Type a name or employee code"
              notFoundContent={null}
              value={targetId}
              options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))}
              onSearch={(q) => { if (q.trim().length >= 2) void payrollApi.searchPeople(q.trim()).then(setHits); }}
              onChange={(v) => { setTargetId(v); edited(); }}
            />
          )}
        </Form.Item>
        <Form.Item label="The value" htmlFor="ov-value" extra={example ? `Entered as for the company rule: ${example.description}` : "Choose a rule first."}>
          <Input.TextArea id="ov-value" rows={2} autoComplete="off" value={valueText_} onChange={(e) => { setValueText(e.target.value); edited(); }} placeholder='A number such as 10, or a list or table as JSON' />
        </Form.Item>
        <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
          <Form.Item label="Applies from" htmlFor="ov-from" style={{ flex: "1 1 140px" }}>
            <Input id="ov-from" placeholder="YYYY-MM-DD" maxLength={10} autoComplete="off" value={from} onChange={(e) => { setFrom(e.target.value); edited(); }} />
          </Form.Item>
          <Form.Item label="Until (optional)" htmlFor="ov-to" style={{ flex: "1 1 140px" }}>
            <Input id="ov-to" placeholder="YYYY-MM-DD" maxLength={10} autoComplete="off" value={to} onChange={(e) => { setTo(e.target.value); edited(); }} />
          </Form.Item>
        </div>
        <Form.Item label="Why this one is treated differently" htmlFor="ov-reason">
          <Input.TextArea id="ov-reason" rows={2} maxLength={200} showCount value={reason} onChange={(e) => { setReason(e.target.value); edited(); }} />
        </Form.Item>
        <Form.Item label="Where the number came from" htmlFor="ov-source" extra="The order, circular or letter, and its date. The director who confirms it checks the value against this.">
          <Input.TextArea id="ov-source" rows={2} maxLength={500} showCount value={sourceNote} onChange={(e) => { setSourceNote(e.target.value); edited(); }} />
        </Form.Item>
        <Form.Item label="Registration it belongs to (optional)" htmlFor="ov-reg" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}>
          <Input id="ov-reg" maxLength={60} autoComplete="off" value={registrationRef} onChange={(e) => { setRegistrationRef(e.target.value); edited(); }} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

function ConfirmOverrideModal({ row, onClose, onDone }: { row: RuleOverrideView; onClose: () => void; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data: preview, isLoading, error } = useQuery({ queryKey: ["payroll", "rule-override-confirm", row.itemKey], queryFn: () => payrollApi.previewRuleOverrideConfirm(row.itemKey), staleTime: 0, gcTime: 0 });
  const run = useMutation({
    mutationFn: () => payrollApi.confirmRuleOverride(row.itemKey, { version: preview!.version, typedValue: parseTyped(typed), note: note.trim(), fingerprint: preview!.fingerprint }),
    onSuccess: () => {
      toast.success("Confirmed.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not confirm.")),
  });
  return (
    <Modal
      open
      width={640}
      title={`Confirm: ${row.ruleLabel} for ${row.targetName}`}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" disabled={!preview || !!preview.blocked || typed.trim() === "" || note.trim().length < 5} loading={run.isPending} onClick={() => run.mutate()}>
            Confirm this version
          </Button>
        </div>
      }
    >
      <Stack gap={space[3]}>
        {isLoading && <Caption>Loading…</Caption>}
        {error && <ApprovalBanner tone="danger" title={apiErrorMessage(error, "Could not load.")} />}
        {preview?.blocked && <ApprovalBanner tone="warning" title={preview.blocked} />}
        {preview && (
          <>
            <ApprovalBanner tone="info" title={`Entered by ${preview.authorName}`} description={`Where it came from: ${preview.sourceNote || "no source note"}. Applies from ${formatDate(preview.value.effectiveFrom)}. Why: ${preview.value.reason}`} />
            <Form layout="vertical" component="div" requiredMark={false}>
              <Form.Item label="Type the value in again, from the source" htmlFor="ov-typed" extra="Confirming means checking: what you type must match the value being confirmed.">
                <Input id="ov-typed" autoComplete="off" value={typed} onChange={(e) => { setTyped(e.target.value); setProblem(null); }} />
              </Form.Item>
              <Form.Item label="What you checked it against" htmlFor="ov-note" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}>
                <Input.TextArea id="ov-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
              </Form.Item>
            </Form>
          </>
        )}
      </Stack>
    </Modal>
  );
}
