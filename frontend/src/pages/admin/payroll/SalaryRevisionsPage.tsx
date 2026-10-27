import { useEffect, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Button, DatePicker, Form, Input, Radio, Select } from "antd";
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
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FormGroupTitle, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, SkeletonCard, Stack, StatusChip, toast, type ChipTone } from "../../../ui";
import { Caption, Num } from "../../../components/payroll/payrollUi";
import { fs, fw, space, v } from "../../../theme/tokens";

// Payroll → Salary revisions (Phase 6 P6-2). The only way a salary is written. Prepare with a preview, a different person approves exactly what the preview
// showed (the approval is void if anything it depends on moves), then the preparer applies it. Nobody prepares or approves a change to their own pay.

const STATUS: Record<RevisionStatus, { tone: ChipTone; label: string }> = {
  DRAFT: { tone: "neutral", label: "Not submitted" },
  WAITING_FOR_CHECKER: { tone: "warning", label: "Waiting for a checker" },
  APPROVED: { tone: "info", label: "Approved, ready to apply" },
  REJECTED: { tone: "danger", label: "Rejected" },
  VOIDED: { tone: "danger", label: "Void: figures changed" },
  APPLIED: { tone: "success", label: "Applied" },
  WITHDRAWN: { tone: "neutral", label: "Withdrawn" },
};
const statusChip = (s: RevisionStatus) => <StatusChip tone={STATUS[s].tone}>{STATUS[s].label}</StatusChip>;
const kindLabel = (r: { kind: RevisionListItem["kind"]; reason: string }) => (r.kind === "CANCEL_SCHEDULED" ? "Cancel a scheduled salary" : r.reason === "CORRECTION" ? "Correction" : "Revision");

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
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["payroll", "revisions", page], queryFn: () => payrollApi.listRevisions(page, 20), placeholderData: keepPreviousData });
  const { data: components = [] } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const componentName = (code: string) => components.find((c) => c.code === code)?.value?.name ?? code;
  const prefill = params.get("employee");

  const closeWizard = () => {
    setWizard(false);
    if (params.has("new")) setParams({}, { replace: true });
  };
  const prepareButton = canEdit && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setWizard(true)}>
      Prepare a revision
    </Button>
  );

  return (
    <>
      <PageHeader title="Salary revisions" subtitle="The only way a salary is written: prepared, approved by someone else, then applied" actions={prepareButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="A different person has to approve it"
          description="A revision gives somebody a first salary or changes one, from a date. You see the old and new figures for every person, and what a back-dated change owes as arrears, before anything is submitted. A different person has to approve it. If anything it depends on changes after that, the approval is void."
        />
        <Panel>
          <DataTable<RevisionListItem>
            rowKey="id"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.items ?? []}
            pagination={{ current: page, pageSize: 20, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
            showTotal
            onRowOpen={(r) => setOpenId(r.id)}
            empty={<EmptyState compact title="No revisions yet" description={canEdit ? "Prepare one to give somebody a first salary or change one." : "Salary revisions appear here once somebody prepares one."} action={prepareButton || undefined} />}
            mobile={{
              title: (r) => `From ${formatDate(r.effectiveFrom)}`,
              subtitle: (r) => `${kindLabel(r)} · ${r.people} ${r.people === 1 ? "person" : "people"}`,
              status: (r) => statusChip(r.status),
              fields: [
                { label: "Prepared by", render: (r) => <>{r.createdBy}<Caption>{formatDateTime(r.createdAt)}</Caption></> },
                { label: "Note", render: (r) => r.note || "—" },
              ],
              actions: (r) => <Button block onClick={() => setOpenId(r.id)}>Open</Button>,
            }}
            columns={[
              { title: "From", key: "from", render: (_, r) => formatDate(r.effectiveFrom) },
              { title: "People", key: "people", align: "right", render: (_, r) => <Num>{r.people}</Num> },
              { title: "Kind", key: "kind", render: (_, r) => kindLabel(r) },
              { title: "Status", key: "status", render: (_, r) => statusChip(r.status) },
              { title: "Prepared by", key: "by", render: (_, r) => <div>{r.createdBy}<Caption>{formatDateTime(r.createdAt)}</Caption></div> },
              { title: "Note", dataIndex: "note", ellipsis: true },
              { title: "", key: "actions", align: "right", render: (_, r) => <Button size="small" onClick={() => setOpenId(r.id)}>Open</Button> },
            ]}
          />
        </Panel>
      </Stack>
      {wizard && <RevisionWizard prefillEmployee={prefill} componentName={componentName} onClose={closeWizard} onCreated={(id) => { closeWizard(); setOpenId(id); }} />}
      {openId && <RevisionDetailDrawer id={openId} componentName={componentName} onClose={() => setOpenId(null)} />}
    </>
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
      toast.success("Submitted for approval.");
      void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onCreated(r.id);
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not submit.")),
  });
  const p: RevisionPreview | undefined = preview.data;
  const edited = () => preview.reset();

  return (
    <SideDrawer
      open
      size="wide"
      title="Prepare a salary revision"
      subtitle={p ? "Check every figure, then submit it for approval" : "Who, what changes, and from when"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          <Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          {p ? (
            <Button size="large" type="primary" style={{ flex: 1 }} disabled={!p.canSubmit} loading={create.isPending} onClick={() => create.mutate()}>
              Submit for approval
            </Button>
          ) : (
            <Button size="large" type="primary" style={{ flex: 1 }} disabled={!input} loading={preview.isPending} onClick={() => preview.mutate()}>
              Show me exactly what this does
            </Button>
          )}
        </div>
      }
    >
      <Stack gap={space[4]}>
        <Section title="1. Who">
          <Radio.Group aria-label="Who" value={kind} onChange={(e) => { setKind(e.target.value as RevisionSelectionKind); edited(); }} options={REVISION_SELECTION_KINDS.map((k) => ({ value: k, label: SELECTION_LABEL[k] }))} />
          {kind === "EMPLOYEES" && (
            <Select
              mode="multiple"
              labelInValue={false}
              showSearch
              filterOption={false}
              aria-label="People"
              style={{ width: "100%" }}
              placeholder="Type a name or employee code"
              notFoundContent={null}
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
          {kind === "BRANCH" && <Select aria-label="Branch" style={{ width: "100%", maxWidth: 320 }} placeholder="Branch" value={locationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} onChange={(val) => { setLocationId(val); edited(); }} />}
          {kind === "GRADE" && <Select aria-label="Grade" style={{ width: "100%", maxWidth: 320 }} placeholder="Grade" value={gradeId} options={grades.map((g) => ({ value: g.id, label: g.name }))} onChange={(val) => { setGradeId(val); edited(); }} />}
          {kind === "STRUCTURE" && <Select aria-label="Structure" style={{ width: "100%", maxWidth: 320 }} placeholder="Structure" value={structureKey} options={structures.map((st) => ({ value: st.code, label: st.value?.name ?? st.code }))} onChange={(val) => { setStructureKey(val); edited(); }} />}
          {kind !== "EMPLOYEES" && <Caption>Only people who already have a salary are included, and you are left out of any group you are in. To give somebody a first salary, pick them by name.</Caption>}
        </Section>

        <Section title="2. What changes">
          <Radio.Group aria-label="What changes" value={ctcMode} onChange={(e) => { setCtcMode(e.target.value as typeof ctcMode); edited(); }} options={[{ value: "SET", label: "Set the yearly CTC" }, { value: "INCREASE_PERCENT", label: "Raise it by a percentage" }, { value: "NONE", label: "Keep the CTC" }]} />
          {ctcMode === "SET" && <Input aria-label="Yearly CTC" prefix="₹" suffix="a year" inputMode="decimal" style={{ maxWidth: 260 }} value={amount} onChange={(e) => { setAmount(e.target.value); edited(); }} placeholder="1200000" />}
          {ctcMode === "INCREASE_PERCENT" && <Input aria-label="Raise by" suffix="%" inputMode="decimal" style={{ maxWidth: 160 }} value={percent} onChange={(e) => { setPercent(e.target.value); edited(); }} placeholder="10" />}
          <Form layout="vertical" component="div">
            <Form.Item label="Structure" htmlFor="revision-structure" extra="Leave empty to keep each person's own; a first salary needs one." style={{ marginBottom: 0 }}>
              <Select id="revision-structure" allowClear style={{ width: "100%", maxWidth: 360 }} placeholder="Keep as is" value={newStructure} options={structures.map((st) => ({ value: st.code, label: `${st.value?.name} (v${st.current?.version})${st.status === "CONFIRMED" ? "" : ": Placeholder"}` }))} onChange={(val) => { setNewStructure(val); edited(); }} />
            </Form.Item>
          </Form>
          {kind === "EMPLOYEES" && perPersonComponents.length > 0 && (
            <div>
              <Caption>Amounts typed for each person ({perPersonComponents.map(componentName).join(", ")}). Anyone with an earlier salary keeps theirs if you leave it empty.</Caption>
              {people.map((pe) => (
                <div key={pe.value} style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap", marginTop: space[2] }}>
                  <span style={{ flex: "1 1 200px", minWidth: 0 }}>{pe.label}</span>
                  {perPersonComponents.map((c) => (
                    <Input key={c} aria-label={`${componentName(c)} for ${pe.label}`} prefix="₹" inputMode="decimal" addonBefore={componentName(c)} style={{ width: 240, maxWidth: "100%" }} value={perPerson[pe.value]?.[c] ?? ""} onChange={(e) => { setPerPerson((m) => ({ ...m, [pe.value]: { ...m[pe.value], [c]: e.target.value } })); edited(); }} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="3. From when">
          <div style={{ display: "flex", gap: space[3], flexWrap: "wrap", alignItems: "center" }}>
            <DatePicker aria-label="From" value={date} onChange={(d) => { setDate(d); edited(); }} format="D MMM YYYY" />
            <Select aria-label="Reason" style={{ width: 200 }} value={reason} options={[{ value: "REVISION", label: "A revision" }, { value: "CORRECTION", label: "A correction" }]} onChange={(val) => { setReason(val); edited(); }} />
          </div>
          {date && date.isBefore(dayjs(), "day") && <Caption tone="warning">This date is in the past. If payroll has been finalised for that period, what it owes is paid as arrears in the next run, and you will see it below.</Caption>}
          {date && date.isAfter(dayjs(), "day") && <Caption>A later date is scheduled: it takes effect on that day.</Caption>}
          <Input.TextArea aria-label="Why" value={note} onChange={(e) => { setNote(e.target.value); edited(); }} rows={2} maxLength={500} placeholder="Why (the person who approves it will read this)" />
        </Section>

        {problem && <ApprovalBanner tone="danger" title={problem} />}

        {p && (
          <Stack gap={space[3]}>
            <FormGroupTitle>What it does</FormGroupTitle>
            {p.blockers.length > 0 && <ApprovalBanner tone="danger" title="This cannot be submitted yet" description={<ul style={{ margin: 0, paddingLeft: space[5] }}>{p.blockers.map((b) => <li key={b}>{b}</li>)}</ul>} />}
            {p.skipped.length > 0 && <ApprovalBanner tone="info" title={`${p.skipped.length} left out`} description={<ul style={{ margin: 0, paddingLeft: space[5] }}>{p.skipped.slice(0, 8).map((sk) => <li key={sk.employeeId}>{sk.name}: {sk.reason}</li>)}{p.skipped.length > 8 && <li>and {p.skipped.length - 8} more</li>}</ul>} />}
            <div style={{ overflowX: "auto" }}>
              <RevisionPlanTable people={p.people} componentName={componentName} />
            </div>
            <CheckersNote checkers={p.checkers} what="this revision" />
          </Stack>
        )}
      </Stack>
    </SideDrawer>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 style={{ margin: `0 0 ${space[2]}px`, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>{title}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: space[2] }}>{children}</div>
    </section>
  );
}

// ── One revision: look, decide, apply, withdraw. Every decision waits for the server: nothing here is optimistic. ──

function RevisionDetailDrawer({ id, componentName, onClose }: { id: string; componentName: (c: string) => string; onClose: () => void }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const canApprove = hasPermission("payroll.approve");
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const [why, setWhy] = useState("");
  const { data: r, isLoading, error, refetch } = useQuery({ queryKey: ["payroll", "revision", id], queryFn: () => payrollApi.getRevision(id) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const fail = (e: unknown) => {
    setProblem(apiErrorMessage(e, "That did not work."));
    refresh();
  };
  const decide = useMutation({ mutationFn: (decision: "APPROVE" | "REJECT") => payrollApi.decideRevision(id, { decision, note, fingerprint: r!.fingerprint }), onSuccess: (_x, decision) => { setProblem(null); setNote(""); refresh(); toast.success(decision === "APPROVE" ? "Approved." : "Rejected."); }, onError: fail });
  const apply = useMutation({ mutationFn: () => payrollApi.applyRevision(id), onSuccess: (x) => { setProblem(null); refresh(); toast.success(`Applied to ${x.applied} ${x.applied === 1 ? "person" : "people"}.`); }, onError: fail });
  const submit = useMutation({ mutationFn: () => payrollApi.submitRevision(id, r!.fingerprint), onSuccess: () => { setProblem(null); refresh(); toast.success("Submitted for approval."); }, onError: fail });
  const withdraw = useMutation({ mutationFn: () => payrollApi.withdrawRevision(id, why), onSuccess: () => { setWithdrawing(false); setProblem(null); refresh(); toast.success("Withdrawn."); }, onError: fail });

  const open = r && !["APPLIED", "WITHDRAWN"].includes(r.status);
  const busy = decide.isPending || apply.isPending || submit.isPending || withdraw.isPending;
  const canApply = !!r && canEdit && r.status === "APPROVED" && !r.includesViewer;
  const canSubmit = !!r && canEdit && ["DRAFT", "REJECTED", "VOIDED"].includes(r.status) && r.blockers.length === 0;
  const canWithdraw = !!r && canEdit && !!open;
  const hasFooter = canApply || canSubmit || canWithdraw;
  return (
    <SideDrawer
      open
      size="wide"
      title={r?.kind === "CANCEL_SCHEDULED" ? "Cancel a scheduled salary" : "Salary revision"}
      status={r ? statusChip(r.status) : undefined}
      onClose={onClose}
      footer={
        hasFooter ? (
          <div style={{ display: "flex", gap: space[3], width: "100%", flexWrap: "wrap" }}>
            {canWithdraw && <Button size="large" style={{ flex: 1 }} disabled={busy} onClick={() => setWithdrawing(true)}>Withdraw this revision</Button>}
            {canSubmit && <Button size="large" type="primary" style={{ flex: 1 }} disabled={busy && !submit.isPending} loading={submit.isPending} onClick={() => submit.mutate()}>Submit for approval</Button>}
            {canApply && (
              <Button size="large" type="primary" style={{ flex: 1 }} disabled={busy && !apply.isPending} loading={apply.isPending} onClick={() => apply.mutate()}>
                {r!.kind === "CANCEL_SCHEDULED" ? "Apply: remove this scheduled salary" : "Apply: write these salaries"}
              </Button>
            )}
          </div>
        ) : null
      }
    >
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard lines={8} />} compact>
        {r && (
          <Stack gap={space[4]}>
            <RevisionBody r={r} componentName={componentName} />
            {problem && <ApprovalBanner tone="danger" title={problem} />}
            {r.includesViewer && <ApprovalBanner tone="warning" title="This changes your own pay" description="You cannot prepare, approve or apply a change to your own pay. Somebody else has to." />}
            {r.blockers.length > 0 && open && <ApprovalBanner tone="danger" title="As things stand this cannot go ahead" description={<ul style={{ margin: 0, paddingLeft: space[5] }}>{r.blockers.map((b) => <li key={b}>{b}</li>)}</ul>} />}
            {canApprove && r.status === "WAITING_FOR_CHECKER" && !r.includesViewer && (
              <Panel title="Your decision" tone="subtle">
                <Stack gap={space[3]}>
                  <ApprovalBanner tone="info" title="You are approving exactly the figures above" description="If anything they depend on changes before this is applied, your approval is void and it has to be submitted again." />
                  <Form layout="vertical" component="div">
                    <Form.Item label="What you checked" htmlFor="revision-decision-note" extra="Required if you reject it." style={{ marginBottom: 0 }}>
                      <Input.TextArea id="revision-decision-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} placeholder="What you checked (required if you reject it)" />
                    </Form.Item>
                  </Form>
                  <div style={{ display: "flex", gap: space[3], flexWrap: "wrap" }}>
                    <Button danger disabled={note.trim().length < 3 || (busy && decide.variables !== "REJECT")} loading={decide.isPending && decide.variables === "REJECT"} onClick={() => decide.mutate("REJECT")}>Reject</Button>
                    <Button type="primary" disabled={busy && decide.variables !== "APPROVE"} loading={decide.isPending && decide.variables === "APPROVE"} onClick={() => decide.mutate("APPROVE")}>Approve</Button>
                  </div>
                </Stack>
              </Panel>
            )}
          </Stack>
        )}
      </QueryState>
      <ConfirmModal
        open={withdrawing}
        danger
        title="Withdraw this revision"
        confirmLabel="Withdraw"
        confirmDisabled={why.trim().length < 3}
        loading={withdraw.isPending}
        onCancel={() => setWithdrawing(false)}
        onConfirm={() => withdraw.mutate()}
      >
        <Form layout="vertical" component="div">
          <Form.Item label="Why" htmlFor="revision-withdraw-why" help="At least 3 characters." style={{ marginBottom: 0 }}>
            <Input.TextArea id="revision-withdraw-why" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} rows={2} placeholder="Why" maxLength={300} />
          </Form.Item>
        </Form>
      </ConfirmModal>
    </SideDrawer>
  );
}

function RevisionBody({ r, componentName }: { r: RevisionDetail; componentName: (c: string) => string }) {
  return (
    <Stack gap={space[4]}>
      <KeyValueGrid
        columns={2}
        items={[
          { key: "s", label: "Status", value: statusChip(r.status) },
          { key: "d", label: r.kind === "CANCEL_SCHEDULED" ? "The scheduled salary starts" : "From", value: formatDate(r.effectiveFrom) },
          { key: "b", label: "Prepared by", value: `${r.createdBy}, ${formatDateTime(r.createdAt)}` },
          { key: "k", label: "Kind", value: r.kind === "CANCEL_SCHEDULED" ? "Cancelling a scheduled salary" : r.reason === "CORRECTION" ? "A correction" : "A revision" },
          ...(r.approval?.decidedBy ? [{ key: "a", label: "Decided by", value: `${r.approval.decidedBy}${r.approval.decisionNote ? `: “${r.approval.decisionNote}”` : ""}` }] : []),
          ...(r.approval?.voidReason ? [{ key: "v", label: "Why it is void", value: r.approval.voidReason }] : []),
          ...(r.appliedAt ? [{ key: "p", label: "Applied", value: `${r.appliedBy}, ${formatDateTime(r.appliedAt)}` }] : []),
          ...(r.withdrawnAt ? [{ key: "w", label: "Withdrawn", value: r.withdrawnReason }] : []),
          ...(r.note ? [{ key: "n", label: "Note", value: r.note, wide: true }] : []),
        ]}
      />
      <Caption>{r.status === "APPLIED" ? "These are the figures as they were written. A later revision does not change this record." : "These figures are worked out again from the current setup every time you open this, so what you approve is what would be written."}</Caption>
      <div style={{ overflowX: "auto" }}>
        {r.kind === "CANCEL_SCHEDULED" ? <CancelPlanBlock plan={r.plan as CancelPlanView} componentName={componentName} /> : <RevisionPlanTable people={(r.plan as Exclude<RevisionDetail["plan"], CancelPlanView>).people} componentName={componentName} />}
      </div>
      {r.checkers && ["DRAFT", "WAITING_FOR_CHECKER", "REJECTED", "VOIDED"].includes(r.status) && <CheckersNote checkers={r.checkers} what="this revision" />}
    </Stack>
  );
}
