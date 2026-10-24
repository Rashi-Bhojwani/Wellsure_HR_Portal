import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Flex, Input, Modal, Segmented, Space, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { CheckCircleOutlined, EditOutlined, EyeOutlined, HistoryOutlined, InfoCircleOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { RULE_GROUPS } from "@shared/constants/payrollRules";
import * as payrollApi from "../../../api/payroll";
import type { CheckerAvailability, RuleStatus, RuleView, VersionView } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { RuleValueInput } from "./RuleValueInput";
import { formatRuleValue, initialInputState, toSubmitValue, type InputState } from "./ruleValues";
import { fs, fw, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, FilterBar, PageHeader, Panel, SideDrawer, SkeletonCard, SkeletonTable, Stack, StatusChip, Timeline, toast, type ChipTone } from "../../../ui";
import { CheckersNote as SharedCheckersNote } from "../../../components/payroll/CheckersNote";
import { Caption } from "../../../components/payroll/payrollUi";

const { Text } = Typography;

// Payroll → Rules and setup (Phase 6 P6-1). Every number that decides what comes out of a payroll run lives here, as a rule that is either Not set, a
// Placeholder or Confirmed. A run on a Placeholder is a TEST. A value is confirmed by a different person from the one who wrote it, and a statutory figure
// is confirmed only by typing it in again.

const STATUS_TAG: Record<RuleStatus, { tone: ChipTone; label: string }> = {
  CONFIRMED: { tone: "success", label: "Confirmed" },
  PLACEHOLDER: { tone: "warning", label: "Placeholder" },
  NOT_SET: { tone: "neutral", label: "Not set" },
};

const RULE_CHECKER_TITLES = { many: "Who can confirm a rule", one: "One person can confirm rules", none: "Nobody can confirm rules" };
function CheckersNote({ checkers }: { checkers: CheckerAvailability | undefined }) {
  return <SharedCheckersNote checkers={checkers} what="rules" titles={RULE_CHECKER_TITLES} />;
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
  const [search, setSearch] = useState("");

  const { data: rules = [], isLoading, error } = useQuery({ queryKey: ["payroll", "rules"], queryFn: payrollApi.listRules });
  const { data: checkers } = useQuery({ queryKey: ["payroll", "checkers", "RULE_CONFIRM"], queryFn: () => payrollApi.getCheckers("RULE_CONFIRM"), staleTime: 30_000 });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  };

  const counts = useMemo(() => ({ CONFIRMED: rules.filter((r) => r.status === "CONFIRMED").length, PLACEHOLDER: rules.filter((r) => r.status === "PLACEHOLDER").length, NOT_SET: rules.filter((r) => r.status === "NOT_SET").length }), [rules]);
  const shown = filter === "ALL" ? rules : rules.filter((r) => r.status === filter);
  const byGroup = RULE_GROUPS.map((g) => ({ group: g, rows: shown.filter((r) => r.group === g) })).filter((g) => g.rows.length > 0);

  const q = search.trim().toLowerCase();
  const visible = q ? byGroup.map((g) => ({ ...g, rows: g.rows.filter((r) => r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q)) })).filter((g) => g.rows.length > 0) : byGroup;

  const columns: ColumnsType<RuleView> = [
    {
      title: "Rule",
      key: "rule",
      render: (_, r) => (
        <div style={{ maxWidth: 340, display: "flex", gap: 8, alignItems: "flex-start" }}>
          <div style={{ minWidth: 0 }}>
            <Text strong>{r.label}</Text>
            <Caption>{r.key}</Caption>
          </div>
          <Tooltip title={`${r.description} Affects: ${r.affects}`}>
            <InfoCircleOutlined tabIndex={0} aria-label={`About ${r.label}: ${r.description} Affects: ${r.affects}`} style={{ color: v.textSecondary, marginTop: 4 }} />
          </Tooltip>
        </div>
      ),
    },
    {
      title: "Value",
      key: "value",
      render: (_, r) => (r.current ? <Text code>{formatRuleValue(r.shape, r.current.value)}</Text> : <Text type="secondary">Not set</Text>),
    },
    { title: "Status", key: "status", render: (_, r) => <RuleStatusCell r={r} /> },
    { title: "Who confirms", dataIndex: "whoConfirms" },
    { title: "", key: "actions", align: "right", render: (_, r) => <RuleActions r={r} /> },
  ];

  function RuleActions({ r }: { r: RuleView }) {
    return (
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
    );
  }

  return (
    <>
      <PageHeader title="Payroll rules and setup" subtitle="Every figure that decides what a payslip says" />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Not set, Placeholder, Confirmed"
          description={
            <>
              A rule is <StatusChip tone="neutral">Not set</StatusChip> until somebody enters it, a <StatusChip tone="warning">Placeholder</StatusChip> until a different person confirms it, and <StatusChip tone="success">Confirmed</StatusChip> after. A payroll run that used any Placeholder is a <Text strong>test</Text>: it can be calculated and looked at, with a TEST mark on screen, in files and on payslip previews, but it cannot be approved, finalised, published or turned into a bank file.
              Editing a Confirmed rule makes the new value a Placeholder again; the last Confirmed value stays on record.
            </>
          }
        />
        {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the rules.")} />}
        <CheckersNote checkers={checkers} />
        <Panel>
          <FilterBar
            onSearch={setSearch}
            searchPlaceholder="Search a rule"
            activeCount={filter === "ALL" ? 0 : 1}
            onClear={() => setFilter("ALL")}
            filters={
              <Segmented
                value={filter}
                onChange={(val) => setFilter(val as typeof filter)}
                options={[
                  { value: "ALL", label: `All (${rules.length})` },
                  { value: "NOT_SET", label: `Not set (${counts.NOT_SET})` },
                  { value: "PLACEHOLDER", label: `Placeholder (${counts.PLACEHOLDER})` },
                  { value: "CONFIRMED", label: `Confirmed (${counts.CONFIRMED})` },
                ]}
              />
            }
          />
        </Panel>
        {isLoading ? (
          <SkeletonTable rows={8} columns={5} />
        ) : visible.length === 0 ? (
          <EmptyState kind="no-results" title="No rule matches" description="Try another word, or show all rules." action={<Button onClick={() => { setFilter("ALL"); setSearch(""); }}>Show all rules</Button>} />
        ) : (
          visible.map(({ group, rows }) => (
            <Panel key={group} title={group}>
              <DataTable<RuleView>
                density="compact"
                rowKey="key"
                dataSource={rows}
                pagination={false}
                columns={columns}
                mobile={{
                  title: (r) => r.label,
                  subtitle: (r) => r.key,
                  status: (r) => <StatusChip tone={STATUS_TAG[r.status].tone}>{STATUS_TAG[r.status].label}</StatusChip>,
                  fields: [
                    { label: "Value", render: (r) => (r.current ? <Text code>{formatRuleValue(r.shape, r.current.value)}</Text> : "Not set") },
                    { label: "Who confirms", render: (r) => r.whoConfirms },
                    { label: "About", render: (r) => <RuleStatusCell r={r} hideChip /> },
                  ],
                  actions: (r) => <RuleActions r={r} />,
                }}
              />
            </Panel>
          ))
        )}
      </Stack>
      {editing && <EditModal rule={editing} onClose={() => setEditing(null)} onSaved={refresh} />}
      {confirming && <ConfirmModal rule={confirming} onClose={() => setConfirming(null)} onDone={refresh} />}
      {history && <HistoryDrawer rule={history} onClose={() => setHistory(null)} />}
      {revealing && <RevealModal rule={revealing} onClose={() => setRevealing(null)} />}
    </>
  );
}

function RuleStatusCell({ r, hideChip }: { r: RuleView; hideChip?: boolean }) {
  return (
    <Space orientation="vertical" size={4}>
      {!hideChip && <StatusChip tone={STATUS_TAG[r.status].tone}>{STATUS_TAG[r.status].label}</StatusChip>}
      {r.openQuestion && (
        <Tooltip title={r.openQuestion.question}>
          <span tabIndex={0} aria-label={`Open question: ${r.openQuestion.question}`}>
            <StatusChip tone="danger">Open question: cannot be confirmed yet</StatusChip>
          </span>
        </Tooltip>
      )}
      {r.sourceLabel && <Caption tone={r.status === "PLACEHOLDER" ? "warning" : undefined}>{r.sourceLabel}</Caption>}
      {r.lastConfirmed && <Caption>Last confirmed value: {formatRuleValue(r.shape, r.lastConfirmed.value)}</Caption>}
      {hideChip && !r.openQuestion && !r.sourceLabel && !r.lastConfirmed && "—"}
    </Space>
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
        {reveal.data && <Text code style={{ fontSize: fs.xl }}>{String(reveal.data.value)}</Text>}
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
      toast.success(`${rule.label} saved as an unconfirmed value. A different person has to confirm it before a real run can use it.`);
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
    <SideDrawer
      open
      size="wide"
      title={`${rule.current ? "Edit" : "Set"}: ${rule.label}`}
      status={<StatusChip tone={STATUS_TAG[rule.status].tone}>{STATUS_TAG[rule.status].label}</StatusChip>}
      onClose={onClose}
      footer={
        p ? (
          <DrawerFooter>
            <Button size="large" onClick={() => preview.reset()} style={{ flex: 1 }}>Back</Button>
            <Button size="large" type="primary" loading={save.isPending} disabled={p.unchanged} onClick={() => save.mutate()} style={{ flex: 1 }}>
              Save as an unconfirmed value
            </Button>
          </DrawerFooter>
        ) : (
          <DrawerFooter>
            <Button size="large" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
            <Button size="large" type="primary" loading={preview.isPending} disabled={!submitted.ok} onClick={() => preview.mutate()} style={{ flex: 1 }}>
              Preview the change
            </Button>
          </DrawerFooter>
        )
      }
    >
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <InfoHint>{rule.description}</InfoHint>
        {rule.suggestion && <Alert type="info" showIcon title={`Suggestion (not a value yet): ${rule.suggestion}`} />}
        {problem && <Alert type="error" showIcon title={problem} />}
        {!p ? (
          <>
            <div>
              <div style={{ fontWeight: fw.medium, marginBottom: 6 }}>Value</div>
              <RuleValueInput shape={rule.shape} value={state} onChange={(val) => { setState(val); setProblem(null); }} autoFocus />
            </div>
            {!submitted.ok && <InfoHint>{submitted.problem}</InfoHint>}
            <InfoHint>Affects: {rule.affects}</InfoHint>
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
            <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} aria-label="Why this value" placeholder="Why this value, and where it came from (optional, but the person who confirms it will want it)" />
          </>
        )}
      </Space>
    </SideDrawer>
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
      toast.success(`${rule.label} is confirmed.`);
      onDone();
      onClose();
    },
    onError: (err) => setProblem(apiErrorMessage(err, "Could not confirm.")),
  });
  const ready = !!preview && !preview.blocked && note.trim().length >= 5 && (!mustRetype || typedValue.ok);

  return (
    <SideDrawer
      open
      size="wide"
      title={`Confirm: ${rule.label}`}
      onClose={onClose}
      footer={
        <DrawerFooter>
          <Button size="large" onClick={onClose} style={{ flex: 1 }}>Cancel</Button>
          <Button size="large" type="primary" icon={<CheckCircleOutlined />} disabled={!ready} loading={confirm.isPending} onClick={() => confirm.mutate()} style={{ flex: 1 }}>
            Confirm this value
          </Button>
        </DrawerFooter>
      }
    >
      {isLoading && <SkeletonCard lines={5} />}
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
              <RuleValueInput shape={rule.shape} value={typed} onChange={(val) => { setTyped(val); setProblem(null); }} autoFocus />
            </div>
          ) : (
            <Text type="secondary">Check the value above against your source before confirming.</Text>
          )}
          <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} aria-label="What you checked it against" placeholder="What you checked it against, for example “CA's letter dated 14 Oct” (required)" />
          {problem && <Alert type="error" showIcon title={problem} />}
        </Space>
      )}
    </SideDrawer>
  );
}

// ── History ──

function HistoryDrawer({ rule, onClose }: { rule: RuleView; onClose: () => void }) {
  const { data, isLoading } = useQuery({ queryKey: ["payroll", "rule", rule.key], queryFn: () => payrollApi.getRule(rule.key) });
  return (
    <SideDrawer open title={`History: ${rule.label}`} subtitle="Every value, who entered it and who confirmed it" onClose={onClose} footer={null}>
      {isLoading && <SkeletonCard lines={4} />}
      {data && data.history.length === 0 && <EmptyState compact title="No history yet" description="No value has ever been entered." />}
      {data && data.history.length > 0 && (
        <Timeline
          items={data.history.map((h: VersionView) => ({
            key: String(h.version),
            tone: h.confirmation ? "accent" : "warning",
            content: (
              <>
                <Text strong>
                  Version {h.version}: {formatRuleValue(rule.shape, h.value)}
                </Text>{" "}
                {h.confirmation ? <StatusChip tone="success">Confirmed</StatusChip> : <StatusChip tone="warning">Never confirmed</StatusChip>}
              </>
            ),
            time: (
              <>
                {h.authorUserId === null ? h.authorName : `Entered by ${h.authorName}`} on {formatDate(h.createdAt)}
              </>
            ),
            detail: (
              <>
                {h.note && <div style={{ color: v.textSecondary }}>“{h.note}”</div>}
                {h.confirmation && (
                  <Text type="success">
                    Confirmed by {h.confirmation.confirmedByName} on {formatDate(h.confirmation.confirmedAt)}: “{h.confirmation.note}”
                  </Text>
                )}
              </>
            ),
          }))}
        />
      )}
    </SideDrawer>
  );
}

function DrawerFooter({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", gap: 12, width: "100%" }}>{children}</div>;
}

/** payroll-04 info hint: grey (i) and the explanation beside it. */
function InfoHint({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, color: v.textSecondary, fontSize: fs.md }}>
      <InfoCircleOutlined aria-hidden style={{ marginTop: 4 }} />
      <span>{children}</span>
    </div>
  );
}
