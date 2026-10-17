import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Alert, Button, DatePicker, Descriptions, Drawer, Flex, Input, Modal, Radio, Select, Space, Spin, Table, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { REVISION_SELECTION_KINDS, type RevisionSelectionKind } from "@shared/constants/payrollSalary";
import * as payrollApi from "../../../api/payroll";
import * as orgApi from "../../../api/org";
import type { CancelPlanView, PersonHit, RevisionChange, RevisionDetail, RevisionInput, RevisionListItem, RevisionPreview, RevisionSelection, RevisionStatus, StructureView } from "../../../api/payroll";
import { CheckersNote } from "../../../components/payroll/CheckersNote";
import { CancelPlanBlock } from "../../../components/payroll/CancelScheduledModal";
import { RevisionPlanTable } from "../../../components/payroll/RevisionPlanTable";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";

const { Title, Text } = Typography;

// Payroll → Salary revisions (Phase 6 P6-2). The only way a salary is written. Prepare with a preview, a different person approves exactly what the preview
// showed (the approval is void if anything it depends on moves), then the preparer applies it. Nobody prepares or approves a change to their own pay.

const STATUS: Record<RevisionStatus, { color: string; label: string }> = {
  DRAFT: { color: "default", label: "Not submitted" },
  WAITING_FOR_CHECKER: { color: "orange", label: "Waiting for a checker" },
  APPROVED: { color: "blue", label: "Approved, ready to apply" },
  REJECTED: { color: "red", label: "Rejected" },
  VOIDED: { color: "red", label: "Void: figures changed" },
  APPLIED: { color: "green", label: "Applied" },
  WITHDRAWN: { color: "default", label: "Withdrawn" },
};

const SELECTION_LABEL: Record<RevisionSelectionKind, string> = {
  EMPLOYEES: "Specific people",
  BRANCH: "Everyone in a branch",
  GRADE: "Everyone in a grade",
  STRUCTURE: "Everyone on a structure",
  ALL: "Everyone employed",
};

export function SalaryRevisionsPage() {
  const { hasPermission } = useAuth();
  const [params, setParams] = useSearchParams();
  const canEdit = hasPermission("payroll.salary.edit");
  const [page, setPage] = useState(1);
  const [wizard, setWizard] = useState(params.get("new") === "1");
  const [openId, setOpenId] = useState<string | null>(params.get("open"));
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "revisions", page], queryFn: () => payrollApi.listRevisions(page, 20) });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const componentName = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  const prefill = params.get("employee");

  const closeWizard = () => {
    setWizard(false);
    if (params.has("new")) setParams({}, { replace: true });
  };

  return (
    <Flex vertical gap={16}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Salary revisions
        </Title>
        {canEdit && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizard(true)}>
            Prepare a revision
          </Button>
        )}
      </Flex>
      <Text type="secondary">
        A revision gives somebody a first salary or changes one, from a date. You see the old and new figures for every person, and what a back-dated change owes as arrears, before anything is submitted. A different person has to approve it. If anything it depends on changes after that, the approval is void.
      </Text>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the revisions.")} />}
      <Table<RevisionListItem>
        rowKey="id"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        locale={{ emptyText: "No revisions yet." }}
        columns={[
          { title: "From", render: (_, r) => formatDate(r.effectiveFrom) },
          { title: "People", dataIndex: "people", align: "right" },
          { title: "Kind", render: (_, r) => (r.kind === "CANCEL_SCHEDULED" ? "Cancel a scheduled salary" : r.reason === "CORRECTION" ? "Correction" : "Revision") },
          { title: "Status", render: (_, r) => <Tag color={STATUS[r.status].color}>{STATUS[r.status].label}</Tag> },
          { title: "Prepared by", render: (_, r) => <div>{r.createdBy}<div><Text type="secondary" style={{ fontSize: 12 }}>{formatDateTime(r.createdAt)}</Text></div></div> },
          { title: "Note", dataIndex: "note", ellipsis: true },
          { title: "", align: "right", render: (_, r) => <Button size="small" onClick={() => setOpenId(r.id)}>Open</Button> },
        ]}
      />
      {wizard && <RevisionWizard prefillEmployee={prefill} componentName={componentName} onClose={closeWizard} onCreated={(id) => { closeWizard(); setOpenId(id); }} />}
      {openId && <RevisionDetailDrawer id={openId} componentName={componentName} onClose={() => setOpenId(null)} />}
    </Flex>
  );
}

// ── Preparing ──

function RevisionWizard({ prefillEmployee, componentName, onClose, onCreated }: { prefillEmployee: string | null; componentName: (c: string) => string; onClose: () => void; onCreated: (id: string) => void }) {
  const queryClient = useQueryClient();
  const [kind, setKind] = useState<RevisionSelectionKind>("EMPLOYEES");
  const [people, setPeople] = useState<Array<{ value: string; label: string }>>([]);
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [locationId, setLocationId] = useState<string>();
  const [gradeId, setGradeId] = useState<string>();
  const [structureKey, setStructureKey] = useState<string>();
  const [ctcMode, setCtcMode] = useState<"NONE" | "SET" | "INCREASE_PERCENT">("SET");
  const [amount, setAmount] = useState("");
  const [percent, setPercent] = useState("");
  const [newStructure, setNewStructure] = useState<string>();
  const [perPerson, setPerPerson] = useState<Record<string, Record<string, string>>>({});
  const [date, setDate] = useState<dayjs.Dayjs | null>(null);
  const [reason, setReason] = useState<"REVISION" | "CORRECTION">("REVISION");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);

  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: grades = [] } = useQuery({ queryKey: ["org", "grades"], queryFn: () => orgApi.grades.list() });
  const { data: structures = [] } = useQuery({ queryKey: ["payroll", "structures"], queryFn: payrollApi.listStructures });

  useEffect(() => {
    if (!prefillEmployee) return;
    void payrollApi.getEmployeeSalary(prefillEmployee).then((p) => setPeople([{ value: p.employeeId, label: `${p.name} (${p.employeeCode})` }]));
  }, [prefillEmployee]);

  const search = async (q: string) => {
    if (q.trim().length < 2) return;
    setHits(await payrollApi.searchPeople(q.trim()));
  };

  const pickedStructure: StructureView | undefined = structures.find((s) => s.code === newStructure);
  const perPersonComponents = pickedStructure?.value?.lines.filter((l) => l.calc.method === "PER_PERSON").map((l) => l.component) ?? [];

  const input: RevisionInput | null = (() => {
    if (!date) return null;
    let selection: RevisionSelection;
    if (kind === "EMPLOYEES") {
      if (people.length === 0) return null;
      selection = { kind, employeeIds: people.map((p) => p.value) };
    } else if (kind === "BRANCH") {
      if (!locationId) return null;
      selection = { kind, locationId };
    } else if (kind === "GRADE") {
      if (!gradeId) return null;
      selection = { kind, gradeId };
    } else if (kind === "STRUCTURE") {
      if (!structureKey) return null;
      selection = { kind, structureKey };
    } else selection = { kind };
    const change: RevisionChange = {};
    if (ctcMode === "SET" && amount.trim()) change.ctc = { mode: "SET", annual: amount.trim() };
    if (ctcMode === "INCREASE_PERCENT" && percent.trim()) change.ctc = { mode: "INCREASE_PERCENT", percent: percent.trim() };
    if (pickedStructure?.current) change.structure = { key: pickedStructure.code, version: pickedStructure.current.version };
    const typed = Object.fromEntries(Object.entries(perPerson).map(([e, m]) => [e, Object.fromEntries(Object.entries(m).filter(([, v]) => v.trim()))]).filter(([, m]) => Object.keys(m as object).length));
    if (Object.keys(typed).length) change.perPerson = typed as Record<string, Record<string, string>>;
    if (!change.ctc && !change.structure) return null;
    return { selection, change, effectiveFrom: date.format("YYYY-MM-DD"), reason, note: note.trim() };
  })();

  const preview = useMutation({ mutationFn: () => payrollApi.previewRevision(input!), onSuccess: () => setProblem(null), onError: (e) => setProblem(apiErrorMessage(e, "Could not prepare the preview.")) });
  const create = useMutation({
    mutationFn: () => payrollApi.createRevision(input!, preview.data!.fingerprint),
    onSuccess: (r) => {
      void message.success("Submitted for approval.");
      void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onCreated(r.id);
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not submit.")),
  });
  const p: RevisionPreview | undefined = preview.data;
  const edited = () => preview.reset();

  return (
    <Drawer open width={980} title="Prepare a salary revision" onClose={onClose} destroyOnHidden>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Section title="1. Who">
          <Radio.Group value={kind} onChange={(e) => { setKind(e.target.value as RevisionSelectionKind); edited(); }} options={REVISION_SELECTION_KINDS.map((k) => ({ value: k, label: SELECTION_LABEL[k] }))} />
          {kind === "EMPLOYEES" && (
            <Select
              mode="multiple"
              labelInValue={false}
              showSearch
              filterOption={false}
              style={{ width: "100%" }}
              placeholder="Type a name or employee code"
              value={people.map((x) => x.value)}
              options={[...people, ...hits.filter((h) => !people.some((x) => x.value === h.employeeId)).map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})${h.hasSalary ? "" : ": no salary yet"}` }))]}
              onSearch={(q) => void search(q)}
              onChange={(ids: string[]) => {
                const known = new Map([...people.map((x) => [x.value, x.label] as const), ...hits.map((h) => [h.employeeId, `${h.name} (${h.employeeCode})`] as const)]);
                setPeople(ids.map((id) => ({ value: id, label: known.get(id) ?? id })));
                edited();
              }}
            />
          )}
          {kind === "BRANCH" && <Select style={{ width: 320 }} placeholder="Branch" value={locationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} onChange={(v) => { setLocationId(v); edited(); }} />}
          {kind === "GRADE" && <Select style={{ width: 320 }} placeholder="Grade" value={gradeId} options={grades.map((g) => ({ value: g.id, label: g.name }))} onChange={(v) => { setGradeId(v); edited(); }} />}
          {kind === "STRUCTURE" && <Select style={{ width: 320 }} placeholder="Structure" value={structureKey} options={structures.map((s) => ({ value: s.code, label: s.value?.name ?? s.code }))} onChange={(v) => { setStructureKey(v); edited(); }} />}
          {kind !== "EMPLOYEES" && <Text type="secondary">Only people who already have a salary are included, and you are left out of any group you are in. To give somebody a first salary, pick them by name.</Text>}
        </Section>

        <Section title="2. What changes">
          <Radio.Group value={ctcMode} onChange={(e) => { setCtcMode(e.target.value as typeof ctcMode); edited(); }} options={[{ value: "SET", label: "Set the yearly CTC" }, { value: "INCREASE_PERCENT", label: "Raise it by a percentage" }, { value: "NONE", label: "Keep the CTC" }]} />
          {ctcMode === "SET" && <Input prefix="₹" suffix="a year" style={{ width: 260 }} value={amount} onChange={(e) => { setAmount(e.target.value); edited(); }} placeholder="1200000" />}
          {ctcMode === "INCREASE_PERCENT" && <Input suffix="%" style={{ width: 160 }} value={percent} onChange={(e) => { setPercent(e.target.value); edited(); }} placeholder="10" />}
          <div>
            <Text type="secondary">Structure (leave empty to keep each person&apos;s own; a first salary needs one)</Text>
            <div>
              <Select allowClear style={{ width: 360 }} placeholder="Keep as is" value={newStructure} options={structures.map((s) => ({ value: s.code, label: `${s.value?.name} (v${s.current?.version})${s.status === "CONFIRMED" ? "" : ": Placeholder"}` }))} onChange={(v) => { setNewStructure(v); edited(); }} />
            </div>
          </div>
          {kind === "EMPLOYEES" && perPersonComponents.length > 0 && (
            <div>
              <Text type="secondary">Amounts typed for each person ({perPersonComponents.map(componentName).join(", ")}). Anyone with an earlier salary keeps theirs if you leave it empty.</Text>
              {people.map((pe) => (
                <Flex key={pe.value} gap={8} align="center" style={{ marginTop: 6 }} wrap>
                  <Text style={{ width: 240 }}>{pe.label}</Text>
                  {perPersonComponents.map((c) => (
                    <Input key={c} prefix="₹" addonBefore={componentName(c)} style={{ width: 240 }} value={perPerson[pe.value]?.[c] ?? ""} onChange={(e) => { setPerPerson((m) => ({ ...m, [pe.value]: { ...m[pe.value], [c]: e.target.value } })); edited(); }} />
                  ))}
                </Flex>
              ))}
            </div>
          )}
        </Section>

        <Section title="3. From when">
          <Flex gap={12} wrap align="center">
            <DatePicker value={date} onChange={(d) => { setDate(d); edited(); }} format="D MMM YYYY" />
            <Select style={{ width: 200 }} value={reason} options={[{ value: "REVISION", label: "A revision" }, { value: "CORRECTION", label: "A correction" }]} onChange={(v) => { setReason(v); edited(); }} />
          </Flex>
          {date && date.isBefore(dayjs(), "day") && <Text type="warning">This date is in the past. If payroll has been finalised for that period, what it owes is paid as arrears in the next run, and you will see it below.</Text>}
          {date && date.isAfter(dayjs(), "day") && <Text type="secondary">A later date is scheduled: it takes effect on that day.</Text>}
          <Input.TextArea value={note} onChange={(e) => { setNote(e.target.value); edited(); }} rows={2} maxLength={500} placeholder="Why (the person who approves it will read this)" />
        </Section>

        <Button type="primary" disabled={!input} loading={preview.isPending} onClick={() => preview.mutate()}>
          Show me exactly what this does
        </Button>
        {problem && <Alert type="error" showIcon title={problem} />}

        {p && (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            {p.blockers.length > 0 && <Alert type="error" showIcon title="This cannot be submitted yet" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>} />}
            {p.skipped.length > 0 && <Alert type="info" showIcon title={`${p.skipped.length} left out`} description={<ul style={{ margin: 0, paddingLeft: 18 }}>{p.skipped.slice(0, 8).map((s) => <li key={s.employeeId}>{s.name}: {s.reason}</li>)}{p.skipped.length > 8 && <li>and {p.skipped.length - 8} more</li>}</ul>} />}
            <RevisionPlanTable people={p.people} componentName={componentName} />
            <CheckersNote checkers={p.checkers} what="this revision" />
            <Button type="primary" size="large" disabled={!p.canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
              Submit for approval
            </Button>
          </Space>
        )}
      </Space>
    </Drawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <Text strong>{title}</Text>
      <Space orientation="vertical" size={8} style={{ width: "100%", marginTop: 6 }}>
        {children}
      </Space>
    </div>
  );
}

// ── One revision: look, decide, apply, withdraw ──

function RevisionDetailDrawer({ id, componentName, onClose }: { id: string; componentName: (c: string) => string; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const canApprove = hasPermission("payroll.approve");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [why, setWhy] = useState("");
  const { data: r, isLoading } = useQuery({ queryKey: ["payroll", "revision", id], queryFn: () => payrollApi.getRevision(id) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const fail = (e: unknown) => {
    setProblem(apiErrorMessage(e, "That did not work."));
    refresh();
  };
  const decide = useMutation({ mutationFn: (decision: "APPROVE" | "REJECT") => payrollApi.decideRevision(id, { decision, note, fingerprint: r!.fingerprint }), onSuccess: () => { setProblem(null); setNote(""); refresh(); void message.success("Done."); }, onError: fail });
  const apply = useMutation({ mutationFn: () => payrollApi.applyRevision(id), onSuccess: (x) => { setProblem(null); refresh(); void message.success(`Applied to ${x.applied} ${x.applied === 1 ? "person" : "people"}.`); }, onError: fail });
  const submit = useMutation({ mutationFn: () => payrollApi.submitRevision(id, r!.fingerprint), onSuccess: () => { setProblem(null); refresh(); void message.success("Submitted for approval."); }, onError: fail });
  const withdraw = useMutation({ mutationFn: () => payrollApi.withdrawRevision(id, why), onSuccess: () => { setWithdrawing(false); setProblem(null); refresh(); }, onError: fail });

  const open = r && !["APPLIED", "WITHDRAWN"].includes(r.status);
  return (
    <Drawer open width={1000} title={r?.kind === "CANCEL_SCHEDULED" ? "Cancel a scheduled salary" : "Salary revision"} onClose={onClose} destroyOnHidden>
      {isLoading && <Spin />}
      {r && <RevisionBody r={r} componentName={componentName} />}
      {r && (
        <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
          {problem && <Alert type="error" showIcon title={problem} />}
          {r.includesViewer && <Alert type="warning" showIcon title="This changes your own pay" description="You cannot prepare, approve or apply a change to your own pay. Somebody else has to." />}
          {r.blockers.length > 0 && open && <Alert type="error" showIcon title="As things stand this cannot go ahead" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>} />}
          {canApprove && r.status === "WAITING_FOR_CHECKER" && !r.includesViewer && (
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Alert type="info" showIcon title="You are approving exactly the figures above" description="If anything they depend on changes before this is applied, your approval is void and it has to be submitted again." />
              <Input.TextArea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What you checked (required if you reject it)" />
              <Space>
                <Button type="primary" loading={decide.isPending} onClick={() => decide.mutate("APPROVE")}>Approve</Button>
                <Button danger disabled={note.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate("REJECT")}>Reject</Button>
              </Space>
            </Space>
          )}
          {canEdit && r.status === "APPROVED" && !r.includesViewer && <Button type="primary" size="large" loading={apply.isPending} onClick={() => apply.mutate()}>{r.kind === "CANCEL_SCHEDULED" ? "Apply: remove this scheduled salary" : "Apply: write these salaries"}</Button>}
          {canEdit && ["DRAFT", "REJECTED", "VOIDED"].includes(r.status) && r.blockers.length === 0 && <Button type="primary" loading={submit.isPending} onClick={() => submit.mutate()}>Submit for approval</Button>}
          {canEdit && open && <Button onClick={() => setWithdrawing(true)}>Withdraw this revision</Button>}
        </Space>
      )}
      <Modal open={withdrawing} title="Withdraw this revision" onCancel={() => setWithdrawing(false)} okText="Withdraw" okButtonProps={{ danger: true, disabled: why.trim().length < 3, loading: withdraw.isPending }} onOk={() => withdraw.mutate()} destroyOnHidden>
        <Input.TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="Why" maxLength={300} />
      </Modal>
    </Drawer>
  );
}

function RevisionBody({ r, componentName }: { r: RevisionDetail; componentName: (c: string) => string }) {
  return (
    <Space orientation="vertical" size={14} style={{ width: "100%" }}>
      <Descriptions
        size="small"
        column={2}
        bordered
        items={[
          { key: "s", label: "Status", children: <Tag color={STATUS[r.status].color}>{STATUS[r.status].label}</Tag> },
          { key: "d", label: r.kind === "CANCEL_SCHEDULED" ? "The scheduled salary starts" : "From", children: formatDate(r.effectiveFrom) },
          { key: "b", label: "Prepared by", children: `${r.createdBy}, ${formatDateTime(r.createdAt)}` },
          { key: "k", label: "Kind", children: r.kind === "CANCEL_SCHEDULED" ? "Cancelling a scheduled salary" : r.reason === "CORRECTION" ? "A correction" : "A revision" },
          ...(r.approval?.decidedBy ? [{ key: "a", label: "Decided by", children: `${r.approval.decidedBy}${r.approval.decisionNote ? `: “${r.approval.decisionNote}”` : ""}` }] : []),
          ...(r.approval?.voidReason ? [{ key: "v", label: "Why it is void", children: r.approval.voidReason }] : []),
          ...(r.appliedAt ? [{ key: "p", label: "Applied", children: `${r.appliedBy}, ${formatDateTime(r.appliedAt)}` }] : []),
          ...(r.withdrawnAt ? [{ key: "w", label: "Withdrawn", children: r.withdrawnReason }] : []),
          ...(r.note ? [{ key: "n", label: "Note", children: r.note, span: 2 }] : []),
        ]}
      />
      {r.status === "APPLIED" ? <Text type="secondary">These are the figures as they were written. A later revision does not change this record.</Text> : <Text type="secondary">These figures are worked out again from the current setup every time you open this, so what you approve is what would be written.</Text>}
      {r.kind === "CANCEL_SCHEDULED" ? <CancelPlanBlock plan={r.plan as CancelPlanView} componentName={componentName} /> : <RevisionPlanTable people={(r.plan as Exclude<RevisionDetail["plan"], CancelPlanView>).people} componentName={componentName} />}
      {r.checkers && ["DRAFT", "WAITING_FOR_CHECKER", "REJECTED", "VOIDED"].includes(r.status) && <CheckersNote checkers={r.checkers} what="this revision" />}
    </Space>
  );
}
