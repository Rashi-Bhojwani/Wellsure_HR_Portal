import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Drawer, Flex, Input, Modal, Segmented, Space, Spin, Table, Tag, Timeline, Tooltip, Typography, message } from "antd";
import { CheckCircleOutlined, EditOutlined, EyeOutlined, HistoryOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RULE_GROUPS } from "@shared/constants/payrollRules";
import * as payrollApi from "../../../api/payroll";
import type { CheckerAvailability, RuleStatus, RuleView, VersionView } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { RuleValueInput } from "./RuleValueInput";
import { formatRuleValue, initialInputState, toSubmitValue, type InputState } from "./ruleValues";

const { Title, Text, Paragraph } = Typography;

// Payroll → Rules and setup (Phase 6 P6-1). Every number that decides what comes out of a payroll run lives here, as a rule that is either Not set, a
// Placeholder or Confirmed. A run on a Placeholder is a TEST. A value is confirmed by a different person from the one who wrote it, and a statutory figure
// is confirmed only by typing it in again.

const STATUS_TAG: Record<RuleStatus, { color: string; label: string }> = {
  CONFIRMED: { color: "green", label: "Confirmed" },
  PLACEHOLDER: { color: "orange", label: "Placeholder" },
  NOT_SET: { color: "default", label: "Not set" },
};

function CheckersNote({ checkers }: { checkers: CheckerAvailability | undefined }) {
  if (!checkers) return null;
  const type = checkers.state === "NONE" ? "error" : checkers.state === "ONE" ? "warning" : "info";
  return <Alert type={type} showIcon title={checkers.state === "MANY" ? "Who can confirm a rule" : checkers.state === "ONE" ? "One person can confirm rules" : "Nobody can confirm rules"} description={checkers.message} />;
}

export function RulesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  // The company's identifiers are the owners' secrets and have their own permissions, apart from the ordinary rules.
  const mayManage = (r: RuleView) => hasPermission(r.sealed ? "payroll.identifiers.manage" : "payroll.rules.manage");
  const mayConfirm = (r: RuleView) => hasPermission(r.sealed ? "payroll.identifiers.confirm" : "payroll.rules.confirm");
  const [revealing, setRevealing] = useState<RuleView | null>(null);
  const [filter, setFilter] = useState<"ALL" | RuleStatus>("ALL");
  const [editing, setEditing] = useState<RuleView | null>(null);
  const [confirming, setConfirming] = useState<RuleView | null>(null);
  const [history, setHistory] = useState<RuleView | null>(null);

  const { data: rules = [], isLoading, error } = useQuery({ queryKey: ["payroll", "rules"], queryFn: payrollApi.listRules });
  const { data: checkers } = useQuery({ queryKey: ["payroll", "checkers", "RULE_CONFIRM"], queryFn: () => payrollApi.getCheckers("RULE_CONFIRM") });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  };

  const counts = useMemo(() => ({ CONFIRMED: rules.filter((r) => r.status === "CONFIRMED").length, PLACEHOLDER: rules.filter((r) => r.status === "PLACEHOLDER").length, NOT_SET: rules.filter((r) => r.status === "NOT_SET").length }), [rules]);
  const shown = filter === "ALL" ? rules : rules.filter((r) => r.status === filter);
  const byGroup = RULE_GROUPS.map((g) => ({ group: g, rows: shown.filter((r) => r.group === g) })).filter((g) => g.rows.length > 0);

  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Payroll rules and setup
      </Title>
      <Text type="secondary">
        Every figure that decides what a payslip says is a rule here. A rule is <Tag color="default">Not set</Tag> until somebody enters it, a <Tag color="orange">Placeholder</Tag> until a different person confirms it, and{" "}
        <Tag color="green">Confirmed</Tag> after. A payroll run that used any Placeholder is a <Text strong>test</Text>: it can be calculated and looked at, with a TEST mark on screen, in files and on payslip previews, but it cannot be approved, finalised, published or turned into a bank file.
        Editing a Confirmed rule makes the new value a Placeholder again; the last Confirmed value stays on record.
      </Text>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the rules.")} />}
      <CheckersNote checkers={checkers} />
      <Flex gap={12} wrap align="center">
        <Segmented
          value={filter}
          onChange={(v) => setFilter(v as typeof filter)}
          options={[
            { value: "ALL", label: `All (${rules.length})` },
            { value: "NOT_SET", label: `Not set (${counts.NOT_SET})` },
            { value: "PLACEHOLDER", label: `Placeholder (${counts.PLACEHOLDER})` },
            { value: "CONFIRMED", label: `Confirmed (${counts.CONFIRMED})` },
          ]}
        />
      </Flex>
      {isLoading ? (
        <Spin />
      ) : (
        byGroup.map(({ group, rows }) => (
          <div key={group}>
            <Title level={5} style={{ margin: "8px 0" }}>
              {group}
            </Title>
            <Table<RuleView>
              size="small"
              rowKey="key"
              dataSource={rows}
              pagination={false}
              scroll={{ x: "max-content" }}
              columns={[
                {
                  title: "Rule",
                  render: (_, r) => (
                    <Tooltip title={`${r.description} Affects: ${r.affects}`}>
                      <div style={{ maxWidth: 320 }}>
                        <Text strong>{r.label}</Text>
                        <div>
                          <Text type="secondary" style={{ fontSize: 12 }}>
                            {r.key}
                          </Text>
                        </div>
                      </div>
                    </Tooltip>
                  ),
                },
                {
                  title: "Value",
                  render: (_, r) => (r.current ? <Text code>{formatRuleValue(r.shape, r.current.value)}</Text> : <Text type="secondary">Not set</Text>),
                },
                {
                  title: "Status",
                  render: (_, r) => (
                    <Space orientation="vertical" size={2}>
                      <Tag color={STATUS_TAG[r.status].color}>{STATUS_TAG[r.status].label}</Tag>
                      {r.openQuestion && (
                        <Tooltip title={r.openQuestion.question}>
                          <Tag color="volcano">Open question: cannot be confirmed yet</Tag>
                        </Tooltip>
                      )}
                      {r.sourceLabel && (
                        <Text type={r.status === "PLACEHOLDER" ? "warning" : "secondary"} style={{ fontSize: 12 }}>
                          {r.sourceLabel}
                        </Text>
                      )}
                      {r.lastConfirmed && (
                        <Text type="secondary" style={{ fontSize: 12 }}>
                          Last confirmed value: {formatRuleValue(r.shape, r.lastConfirmed.value)}
                        </Text>
                      )}
                    </Space>
                  ),
                },
                { title: "Who confirms", dataIndex: "whoConfirms" },
                {
                  title: "",
                  align: "right",
                  render: (_, r) => (
                    <Space wrap>
                      {mayManage(r) && (
                        <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(r)}>
                          {r.current ? "Edit" : "Set value"}
                        </Button>
                      )}
                      {r.sealed && r.current && hasPermission("payroll.identifiers.manage") && (
                        <Button size="small" icon={<EyeOutlined />} onClick={() => setRevealing(r)}>
                          Reveal
                        </Button>
                      )}
                      {mayConfirm(r) && r.status === "PLACEHOLDER" && (
                        <Button size="small" type="primary" icon={<SafetyCertificateOutlined />} onClick={() => setConfirming(r)}>
                          Confirm…
                        </Button>
                      )}
                      <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistory(r)}>
                        History
                      </Button>
                    </Space>
                  ),
                },
              ]}
            />
          </div>
        ))
      )}
      {editing && <EditModal rule={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {confirming && <ConfirmModal rule={confirming} onClose={() => setConfirming(null)} onDone={refresh} />}
      {history && <HistoryDrawer rule={history} onClose={() => setHistory(null)} />}
      {revealing && <RevealModal rule={revealing} onClose={() => setRevealing(null)} />}
    </Flex>
  );
}

// ── Reveal: an owner's secret, shown on request, audited ──

function RevealModal({ rule, onClose }: { rule: RuleView; onClose: () => void }) {
  const reveal = useMutation({ mutationFn: () => payrollApi.revealRule(rule.key) });
  return (
    <Modal open title={`Reveal: ${rule.label}`} onCancel={onClose} footer={<Button onClick={onClose}>Close</Button>} destroyOnHidden>
      <Flex vertical gap={12}>
        <Text>This shows the value on this screen only. It is recorded that you looked, and when, but never what it said. Do not copy it into a message, a ticket or a chat.</Text>
        {reveal.error && <Alert type="error" showIcon title={apiErrorMessage(reveal.error, "Could not reveal it.")} />}
        {!reveal.data && (
          <Button type="primary" loading={reveal.isPending} onClick={() => reveal.mutate()}>
            Show it
          </Button>
        )}
        {reveal.data && <Text code style={{ fontSize: 18 }}>{String(reveal.data.value)}</Text>}
      </Flex>
    </Modal>
  );
}

// ── Edit: enter a value, see exactly what it changes, then save it as an unconfirmed value ──

function EditModal({ rule, onClose, onSaved }: { rule: RuleView; onClose: () => void; onSaved: () => void }) {
  // An owner's secret is never put back in the box: whoever edits it types the new value.
  const [state, setState] = useState<InputState>(() => initialInputState(rule.shape, rule.sealed ? null : (rule.current?.value ?? null)));
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const submitted = toSubmitValue(rule.shape, state);

  const preview = useMutation({
    mutationFn: () => {
      if (!submitted.ok) throw new Error(submitted.problem);
      return payrollApi.previewRuleEdit(rule.key, submitted.value);
    },
    onError: (err) => setProblem(apiErrorMessage(err, "That value was not accepted.")),
    onSuccess: () => setProblem(null),
  });
  const save = useMutation({
    mutationFn: () => {
      if (!submitted.ok || !preview.data) throw new Error("Preview first.");
      return payrollApi.saveRule(rule.key, { value: submitted.value, note, fingerprint: preview.data.fingerprint });
    },
    onSuccess: () => {
      void message.success(`${rule.label} saved as an unconfirmed value. A different person has to confirm it before a real run can use it.`);
      onSaved();
      onClose();
    },
    onError: (err) => {
      setProblem(apiErrorMessage(err, "Could not save."));
      preview.reset();
    },
  });
  const p = preview.data;

  return (
    <Modal
      open
      width={640}
      title={`${rule.current ? "Edit" : "Set"}: ${rule.label}`}
      onCancel={onClose}
      destroyOnHidden
      footer={
        p ? (
          <Space>
            <Button onClick={() => preview.reset()}>Back</Button>
            <Button type="primary" loading={save.isPending} disabled={p.unchanged} onClick={() => save.mutate()}>
              Save as an unconfirmed value
            </Button>
          </Space>
        ) : (
          <Space>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="primary" loading={preview.isPending} disabled={!submitted.ok} onClick={() => preview.mutate()}>
              Preview the change
            </Button>
          </Space>
        )
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <Paragraph type="secondary" style={{ margin: 0 }}>
          {rule.description}
        </Paragraph>
        {rule.suggestion && <Alert type="info" showIcon title={`Suggestion (not a value yet): ${rule.suggestion}`} />}
        {problem && <Alert type="error" showIcon title={problem} />}
        {!p ? (
          <>
            <RuleValueInput shape={rule.shape} value={state} onChange={(v) => { setState(v); setProblem(null); }} autoFocus />
            {!submitted.ok && <Text type="secondary">{submitted.problem}</Text>}
          </>
        ) : (
          <>
            <Descriptions size="small" column={1} bordered items={[
              { key: "before", label: "Now", children: p.before ? `${formatRuleValue(rule.shape, p.before.value)} (${STATUS_TAG[p.before.status].label})` : "Not set" },
              { key: "after", label: "After saving", children: <Text strong>{formatRuleValue(rule.shape, p.after.value)}</Text> },
              { key: "affects", label: "What it affects", children: rule.affects },
              { key: "impact", label: "Effect so far", children: p.impact },
            ]} />
            {p.unchanged && <Alert type="warning" showIcon title="That is the value it already has. There is nothing to save." />}
            {p.willResetConfirmation && (
              <Alert
                type="warning"
                showIcon
                title="This rule is Confirmed now."
                description={`Saving makes the new value a Placeholder: test runs can use it, real runs cannot until a different person confirms it. The Confirmed value (${p.lastConfirmed ? formatRuleValue(rule.shape, p.lastConfirmed.value) : "—"}) stays on record and in any run that used it.`}
              />
            )}
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="Why this value, and where it came from (optional, but the person who confirms it will want it)" />
          </>
        )}
      </Space>
    </Modal>
  );
}

// ── Confirm: see where the value came from, and for a statutory figure type it in again ──

function ConfirmModal({ rule, onClose, onDone }: { rule: RuleView; onClose: () => void; onDone: () => void }) {
  const { data: preview, isLoading, error } = useQuery({ queryKey: ["payroll", "confirm-preview", rule.key], queryFn: () => payrollApi.previewRuleConfirm(rule.key), staleTime: 0, gcTime: 0 });
  const [typed, setTyped] = useState<InputState>(() => initialInputState(rule.shape, null, true));
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const typedValue = toSubmitValue(rule.shape, typed);
  const mustRetype = preview?.requiresRetype ?? rule.requiresRetype;

  const confirm = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error("Not loaded yet.");
      return payrollApi.confirmRule(rule.key, { version: preview.version, typedValue: mustRetype && typedValue.ok ? typedValue.value : undefined, note, fingerprint: preview.fingerprint });
    },
    onSuccess: () => {
      void message.success(`${rule.label} is confirmed.`);
      onDone();
      onClose();
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not confirm.")),
  });
  const ready = !!preview && !preview.blocked && note.trim().length >= 5 && (!mustRetype || typedValue.ok);

  return (
    <Modal
      open
      width={640}
      title={`Confirm: ${rule.label}`}
      onCancel={onClose}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="primary" icon={<CheckCircleOutlined />} disabled={!ready} loading={confirm.isPending} onClick={() => confirm.mutate()}>
            Confirm this value
          </Button>
        </Space>
      }
    >
      {isLoading && <Spin />}
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load.")} />}
      {preview && (
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          {preview.blocked && <Alert type="warning" showIcon title={preview.blocked} />}
          <Descriptions size="small" column={1} bordered items={[
            { key: "value", label: "Value", children: <Text strong>{formatRuleValue(rule.shape, preview.value)}</Text> },
            { key: "source", label: "Where it came from", children: <Text type={preview.sourceLabel?.startsWith("From memory") ? "danger" : undefined} strong={!!preview.sourceLabel?.startsWith("From memory")}>{preview.sourceLabel}</Text> },
            { key: "who", label: "Entered by", children: preview.authorName },
            { key: "ver", label: "Version", children: preview.version },
            { key: "affects", label: "What it affects", children: rule.affects },
          ]} />
          <CheckersNote checkers={preview.checkers} />
          {mustRetype ? (
            <div>
              <Alert type="info" showIcon title="This is a statutory figure. Confirming means checking it against its source." description="Open the source (the CA's letter, the notification, the circular) and type the value in below from there. Do not copy it from this screen. If it does not match, nothing is confirmed." style={{ marginBottom: 8 }} />
              <RuleValueInput shape={rule.shape} value={typed} onChange={(v) => { setTyped(v); setProblem(null); }} autoFocus />
            </div>
          ) : (
            <Text type="secondary">Check the value above against your source before confirming.</Text>
          )}
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What you checked it against, for example “CA's letter dated 14 Oct” (required)" />
          {problem && <Alert type="error" showIcon title={problem} />}
        </Space>
      )}
    </Modal>
  );
}

// ── History ──

function HistoryDrawer({ rule, onClose }: { rule: RuleView; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["payroll", "rule", rule.key], queryFn: () => payrollApi.getRule(rule.key) });
  return (
    <Drawer open width={520} title={`History: ${rule.label}`} onClose={onClose} destroyOnHidden>
      {isLoading && <Spin />}
      {data && data.history.length === 0 && <Text type="secondary">No value has ever been entered.</Text>}
      {data && data.history.length > 0 && (
        <Timeline
          items={data.history.map((h: VersionView) => ({
            color: h.confirmation ? "green" : "orange",
            content: (
              <Space orientation="vertical" size={0}>
                <Text strong>
                  Version {h.version}: {formatRuleValue(rule.shape, h.value)}
                </Text>
                <Text type="secondary">
                  {h.authorUserId === null ? h.authorName : `Entered by ${h.authorName}`} on {formatDate(h.createdAt)}
                </Text>
                {h.note && <Text type="secondary">“{h.note}”</Text>}
                {h.confirmation ? (
                  <Text type="success">
                    Confirmed by {h.confirmation.confirmedByName} on {formatDate(h.confirmation.confirmedAt)}: “{h.confirmation.note}”
                  </Text>
                ) : (
                  <Tag color="orange" style={{ width: "fit-content" }}>
                    Never confirmed
                  </Tag>
                )}
              </Space>
            ),
          }))}
        />
      )}
    </Drawer>
  );
}
