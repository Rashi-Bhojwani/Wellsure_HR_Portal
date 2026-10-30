import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Radio, Select, Tabs } from "antd";
import * as api from "../../../api/remoteAttendance";
import type { Decision, DirectorRecord, RemoteStatus } from "../../../api/remoteAttendance";
import { searchPeople, type PersonHit } from "../../../api/payroll";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, PageHeader, Panel, SideDrawer, Stack, StatCard, StatusChip, toast, type ChipTone } from "../../../ui";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Attendance → Remote Attendance. Directors only. A remote employee's day arrives here when they check out. A director approves a full day, approves a half day (and says
// which half), or rejects it with a reason and says whether it is Absent or Loss of pay; nothing is preselected. A director's own days go to the other director.

const TONE: Record<RemoteStatus, ChipTone> = { OPEN: "neutral", PENDING: "warning", APPROVED_FULL: "success", APPROVED_HALF: "info", REJECTED: "danger" };
const LABEL: Record<RemoteStatus, string> = { OPEN: "Checked in", PENDING: "Waiting", APPROVED_FULL: "Full day", APPROVED_HALF: "Half day", REJECTED: "Rejected" };
const PAGE = 25;

export function RemoteAttendancePage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("waiting");
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["remote-admin"] });
  const pending = useQuery({ queryKey: ["remote-admin", "count"], queryFn: () => api.remoteRecords({ status: "PENDING", page: 1, pageSize: 1 }) });
  const requests = useQuery({ queryKey: ["remote-admin", "requests"], queryFn: api.remoteRequests });
  return (
    <>
      <PageHeader title="Remote Attendance" subtitle="Days worked remotely, waiting for a director's decision" />
      <Stack>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: space[3] }}>
          <StatCard label="Waiting for a decision" value={String(pending.data?.total ?? 0)} loading={pending.isLoading} />
          <StatCard label="Requests to answer" value={String(requests.data?.length ?? 0)} loading={requests.isLoading} />
        </div>
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            { key: "waiting", label: "Waiting", children: <Records status="PENDING" onChanged={refresh} /> },
            { key: "all", label: "All days", children: <Records onChanged={refresh} /> },
            { key: "requests", label: `Requests${requests.data?.length ? ` (${requests.data.length})` : ""}`, children: <Requests onChanged={refresh} /> },
            { key: "people", label: "Who is remote", children: <People onChanged={refresh} /> },
            { key: "report", label: "Report", children: <Report /> },
            { key: "settings", label: "Settings", children: <Settings /> },
          ]}
        />
      </Stack>
    </>
  );
}

function Records({ status, onChanged }: { status?: RemoteStatus; onChanged: () => void }) {
  const [filter, setFilter] = useState<RemoteStatus | undefined>(status);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string[]>([]);
  const [deciding, setDeciding] = useState<DirectorRecord | null>(null);
  const [reopening, setReopening] = useState<DirectorRecord | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const q = useQuery({ queryKey: ["remote-admin", "records", filter, page], queryFn: () => api.remoteRecords({ ...(filter ? { status: filter } : {}), page, pageSize: PAGE }) });
  const done = () => { setSelected([]); onChanged(); void q.refetch(); };
  const approveAll = useMutation({
    mutationFn: () => api.bulkApproveRemote(selected),
    onSuccess: (r) => { toast.success(`Approved ${r.done} ${r.done === 1 ? "day" : "days"}${r.skipped.length ? `; ${r.skipped.length} skipped: ${r.skipped[0]!.why}` : ""}.`); done(); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not approve.")),
  });
  const rows = q.data?.rows ?? [];
  return (
    <Panel>
      <FilterBar
        activeCount={filter && !status ? 1 : 0}
        onClear={() => setFilter(status)}
        filters={!status ? <Select allowClear aria-label="Status" placeholder="Status" style={{ minWidth: 170 }} value={filter} onChange={(x) => { setFilter(x); setPage(1); }} options={(Object.keys(LABEL) as RemoteStatus[]).map((s) => ({ value: s, label: LABEL[s] }))} /> : undefined}
        actions={
          status === "PENDING" ? (
            <>
              <Button disabled={selected.length === 0} loading={approveAll.isPending} onClick={() => approveAll.mutate()}>Approve {selected.length || ""} as full days</Button>
              <Button danger disabled={selected.length === 0} onClick={() => setRejecting(true)}>Reject {selected.length || ""}…</Button>
            </>
          ) : undefined
        }
      />
      <DataTable<DirectorRecord>
        rowKey="id"
        density="compact"
        loading={q.isLoading || q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={rows}
        pagination={{ current: page, pageSize: PAGE, total: q.data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
        rowSelection={status === "PENDING" ? { selectedRowKeys: selected, onChange: (k) => setSelected(k as string[]), getCheckboxProps: (r) => ({ disabled: r.yours }) } : undefined}
        empty={<EmptyState compact title={status === "PENDING" ? "Nothing is waiting" : "No remote days"} description="A remote day appears here when the person checks out." />}
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => `${r.employeeCode} · ${formatDate(r.date)}`,
          status: (r) => <StatusChip tone={TONE[r.status]}>{LABEL[r.status]}</StatusChip>,
          fields: [
            { label: "In / out", render: (r) => `${r.checkIn ?? "—"} to ${r.checkOut ?? "—"}` },
            { label: "Detail", render: (r) => detailOf(r) || "—" },
          ],
          actions: (r) => <RowButtons r={r} onDecide={() => setDeciding(r)} onReopen={() => setReopening(r)} block />,
        }}
        columns={[
          { title: "Employee", key: "who", render: (_, r) => <PersonCell name={r.name} code={r.employeeCode} /> },
          { title: "Day", key: "day", render: (_, r) => formatDate(r.date) },
          { title: "In / out", key: "times", render: (_, r) => `${r.checkIn ?? "—"} to ${r.checkOut ?? "—"}` },
          { title: "Status", key: "status", render: (_, r) => <div><StatusChip tone={TONE[r.status]}>{LABEL[r.status]}{r.status === "APPROVED_HALF" && r.half ? ` (${r.half === "FIRST" ? "1st" : "2nd"} half)` : ""}</StatusChip>{r.status === "REJECTED" && <Caption>{r.rejectOutcome === "LOSS_OF_PAY" ? "Loss of pay" : "Absent"}: {r.decisionReason}</Caption>}{r.yours && <Caption>Your own day: the other director decides</Caption>}</div> },
          { title: "", key: "actions", align: "right", render: (_, r) => <RowButtons r={r} onDecide={() => setDeciding(r)} onReopen={() => setReopening(r)} /> },
        ]}
      />
      {deciding && <DecideDrawer record={deciding} onClose={() => setDeciding(null)} onDone={done} />}
      {reopening && <ReasonDialog title={`Reopen ${reopening.name}'s ${formatDate(reopening.date)}`} description="The day goes back to waiting and attendance follows the engine again until it is decided." label="Why" confirm="Reopen" onClose={() => setReopening(null)} run={(reason) => api.reopenRemote(reopening.id, reason).then(() => { toast.success("Reopened."); done(); })} />}
      {rejecting && <BulkReject ids={selected} onClose={() => setRejecting(false)} onDone={done} />}
    </Panel>
  );
}

function detailOf(r: DirectorRecord): string {
  if (r.yours && r.status === "PENDING") return "Your own day: the other director decides";
  if (r.status === "APPROVED_HALF" && r.half) return `Half day (${r.half === "FIRST" ? "first" : "second"} half)`;
  if (r.status === "REJECTED") return `${r.rejectOutcome === "LOSS_OF_PAY" ? "Loss of pay" : "Absent"}: ${r.decisionReason ?? ""}`;
  return "";
}

function RowButtons({ r, onDecide, onReopen, block }: { r: DirectorRecord; onDecide: () => void; onReopen: () => void; block?: boolean }) {
  const size = block ? "large" : "small";
  if (r.status === "PENDING") return <Button size={size} type="primary" block={block} disabled={r.yours} onClick={onDecide}>Decide</Button>;
  if (r.status === "OPEN") return null;
  return <Button size={size} block={block} onClick={onReopen}>Reopen</Button>;
}

function DecideDrawer({ record, onClose, onDone }: { record: DirectorRecord; onClose: () => void; onDone: () => void }) {
  const [kind, setKind] = useState<"FULL" | "HALF" | "REJECT" | null>(null);
  const [half, setHalf] = useState<"FIRST" | "SECOND" | null>(null);
  const [outcome, setOutcome] = useState<"ABSENT" | "LOSS_OF_PAY" | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const settings = useQuery({ queryKey: ["remote-admin", "settings"], queryFn: api.remoteSettings });
  const decision: Decision | null = kind === "FULL" ? { kind } : kind === "HALF" && half ? { kind, half } : kind === "REJECT" && outcome && reason.trim().length >= 3 ? { kind, reason: reason.trim(), outcome } : null;
  const save = useMutation({ mutationFn: () => api.decideRemote(record.id, decision!), onSuccess: () => { toast.success("Decided. The person has been told."); onDone(); onClose(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")) });
  return (
    <SideDrawer
      open
      title={`Decide ${record.name}'s day`}
      subtitle={`${formatDate(record.date)} · in ${record.checkIn ?? "—"}, out ${record.checkOut ?? "—"}`}
      onClose={onClose}
      footer={<div style={{ display: "flex", gap: space[3], width: "100%" }}><Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button><Button size="large" type="primary" style={{ flex: 1 }} disabled={!decision} loading={save.isPending} onClick={() => save.mutate()}>Save the decision</Button></div>}
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Decision">
          <Radio.Group value={kind} onChange={(e) => { setKind(e.target.value); setProblem(null); }} style={{ display: "grid", gap: space[2] }}>
            <Radio value="FULL">Approve as a full day</Radio>
            <Radio value="HALF">Approve as a half day</Radio>
            <Radio value="REJECT">Reject</Radio>
          </Radio.Group>
        </Form.Item>
        {kind === "HALF" && (
          <Form.Item label="Which half was worked" extra="Nothing is chosen for you.">
            <Radio.Group value={half} onChange={(e) => setHalf(e.target.value)}><Radio value="FIRST">First half</Radio><Radio value="SECOND">Second half</Radio></Radio.Group>
          </Form.Item>
        )}
        {kind === "REJECT" && (
          <>
            <Form.Item label="Why it is rejected" htmlFor="rj-reason" extra="The person is told this reason."><Input.TextArea id="rj-reason" rows={2} maxLength={200} showCount value={reason} onChange={(e) => setReason(e.target.value)} /></Form.Item>
            <Form.Item label="What the day becomes" extra={settings.data?.suggestedRejectOutcome ? `Suggested: ${settings.data.suggestedRejectOutcome === "ABSENT" ? "Absent" : "Loss of pay"}. Choose it yourself.` : "Nothing is suggested and nothing is chosen for you."}>
              <Radio.Group value={outcome} onChange={(e) => setOutcome(e.target.value)}><Radio value="ABSENT">Absent</Radio><Radio value="LOSS_OF_PAY">Loss of pay</Radio></Radio.Group>
            </Form.Item>
          </>
        )}
        {problem && <ApprovalBanner tone="danger" title={problem} />}
      </Form>
    </SideDrawer>
  );
}

function ReasonDialog({ title, description, label, confirm, onClose, run }: { title: string; description: string; label: string; confirm: string; onClose: () => void; run: (reason: string) => Promise<unknown> }) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <ConfirmModal open title={title} description={description} confirmLabel={confirm} cancelLabel="Cancel" confirmDisabled={reason.trim().length < 3} loading={busy} onCancel={onClose}
      onConfirm={() => { setBusy(true); void run(reason.trim()).then(onClose, (e) => { setProblem(apiErrorMessage(e, "Could not do that.")); setBusy(false); }); }}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label={label} htmlFor="rd-reason" validateStatus={problem ? "error" : undefined} help={problem ?? "At least 3 characters."} style={{ marginBottom: 0 }}><Input.TextArea id="rd-reason" autoFocus rows={2} maxLength={200} value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </ConfirmModal>
  );
}

function BulkReject({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: () => void }) {
  const [outcome, setOutcome] = useState<"ABSENT" | "LOSS_OF_PAY" | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const run = useMutation({ mutationFn: () => api.bulkRejectRemote(ids, reason.trim(), outcome!), onSuccess: (r) => { toast.success(`Rejected ${r.done}${r.skipped.length ? `; ${r.skipped.length} skipped` : ""}.`); onDone(); onClose(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not reject.")) });
  return (
    <ConfirmModal open title={`Reject ${ids.length} ${ids.length === 1 ? "day" : "days"}`} description="Every person is told the reason. A reason and an outcome are required." confirmLabel="Reject" cancelLabel="Cancel" danger confirmDisabled={reason.trim().length < 3 || !outcome} loading={run.isPending} onCancel={onClose} onConfirm={() => run.mutate()}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Why" htmlFor="br-reason" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}><Input.TextArea id="br-reason" rows={2} maxLength={200} showCount value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} /></Form.Item>
        <Form.Item label="What the days become" style={{ marginBottom: 0 }}><Radio.Group value={outcome} onChange={(e) => setOutcome(e.target.value)}><Radio value="ABSENT">Absent</Radio><Radio value="LOSS_OF_PAY">Loss of pay</Radio></Radio.Group></Form.Item>
      </Form>
    </ConfirmModal>
  );
}

function Requests({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({ queryKey: ["remote-admin", "requests"], queryFn: api.remoteRequests });
  const [answer, setAnswer] = useState<{ id: string; accept: boolean; who: string } | null>(null);
  return (
    <Panel>
      <DataTable<api.RemoteRequestRow>
        rowKey="id"
        density="compact"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        pagination={false}
        empty={<EmptyState compact title="No requests" description="A correction or a review a person asks for appears here." />}
        mobile={{ title: (r) => r.name, subtitle: (r) => `${r.kind === "CORRECTION" ? "Correction" : "Review"} · ${formatDate(r.date)}`, fields: [{ label: "They say", render: (r) => r.note }], actions: (r) => <RequestButtons r={r} set={setAnswer} block /> }}
        columns={[
          { title: "Employee", key: "who", render: (_, r) => <PersonCell name={r.name} code={formatDate(r.date)} /> },
          { title: "Kind", key: "kind", render: (_, r) => (r.kind === "CORRECTION" ? "Correction" : "Review") },
          { title: "They say", key: "note", render: (_, r) => <div>{r.note}{(r.proposedCheckIn || r.proposedCheckOut) && <Caption>Proposed: in {r.proposedCheckIn ?? "unchanged"}, out {r.proposedCheckOut ?? "unchanged"}</Caption>}<Caption>{formatDateTime(r.createdAt)}</Caption></div> },
          { title: "", key: "actions", align: "right", render: (_, r) => <RequestButtons r={r} set={setAnswer} /> },
        ]}
      />
      {answer && <ReasonDialog title={answer.accept ? `Accept ${answer.who}'s request` : `Decline ${answer.who}'s request`} description={answer.accept ? "A correction changes the times; a review reopens the day." : "The day stays as decided."} label="Your answer, which the person sees" confirm={answer.accept ? "Accept" : "Decline"} onClose={() => setAnswer(null)} run={(note) => api.resolveRemoteRequest(answer.id, { accept: answer.accept, note }).then(() => { toast.success("Answered."); onChanged(); void q.refetch(); })} />}
    </Panel>
  );
}
function RequestButtons({ r, set, block }: { r: api.RemoteRequestRow; set: (a: { id: string; accept: boolean; who: string }) => void; block?: boolean }) {
  const size = block ? "large" : "small";
  return <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}><Button size={size} type="primary" onClick={() => set({ id: r.id, accept: true, who: r.name })}>Accept</Button><Button size={size} onClick={() => set({ id: r.id, accept: false, who: r.name })}>Decline</Button></div>;
}

function People({ onChanged }: { onChanged: () => void }) {
  const q = useQuery({ queryKey: ["remote-admin", "people"], queryFn: api.remotePeople });
  const [marking, setMarking] = useState(false);
  return (
    <Panel title="Who is remote" extra={<Button type="primary" onClick={() => setMarking(true)}>Mark a person</Button>}>
      <DataTable<api.RemotePerson>
        rowKey="employeeId"
        density="compact"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        pagination={false}
        empty={<EmptyState compact title="Nobody is remote" description="Nobody works remotely until a director marks them, from a date." action={<Button type="primary" onClick={() => setMarking(true)}>Mark a person</Button>} />}
        columns={[
          { title: "Employee", key: "who", render: (_, p) => <PersonCell name={p.name} code={p.employeeCode} /> },
          { title: "Today", key: "today", render: (_, p) => <StatusChip tone={p.remoteToday ? "info" : "neutral"}>{p.remoteToday ? "Remote" : "Not remote"}</StatusChip> },
          { title: "Since", key: "since", render: (_, p) => (p.since ? formatDate(p.since) : "—") },
          { title: "Why", key: "why", render: (_, p) => p.lastReason ?? "—" },
        ]}
      />
      {marking && <MarkDrawer onClose={() => setMarking(false)} onDone={() => { onChanged(); void q.refetch(); }} />}
    </Panel>
  );
}

function MarkDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [employeeId, setEmployeeId] = useState<string>();
  const [from, setFrom] = useState("");
  const [remote, setRemote] = useState<boolean | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ready = !!employeeId && /^\d{4}-\d{2}-\d{2}$/.test(from) && remote !== null && reason.trim().length >= 3;
  const save = useMutation({ mutationFn: () => api.markRemote({ employeeId: employeeId!, effectiveFrom: from, remote: remote!, reason: reason.trim() }), onSuccess: () => { toast.success("Saved. The person has been told."); onDone(); onClose(); }, onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")) });
  return (
    <SideDrawer open title="Mark a person" subtitle="From a date, until another mark says otherwise" onClose={onClose}
      footer={<div style={{ display: "flex", gap: space[3], width: "100%" }}><Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button><Button size="large" type="primary" style={{ flex: 1 }} disabled={!ready} loading={save.isPending} onClick={() => save.mutate()}>Save</Button></div>}>
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Who" htmlFor="rm-who"><Select id="rm-who" showSearch filterOption={false} style={{ width: "100%" }} placeholder="Type a name or employee code" notFoundContent={null} value={employeeId} options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))} onSearch={(t) => { if (t.trim().length >= 2) void searchPeople(t.trim()).then(setHits); }} onChange={setEmployeeId} /></Form.Item>
        <Form.Item label="From" htmlFor="rm-from" extra="For example 2026-10-01."><Input id="rm-from" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 220 }} /></Form.Item>
        <Form.Item label="From that date the person is"><Radio.Group value={remote} onChange={(e) => setRemote(e.target.value)}><Radio value={true}>Working remotely</Radio><Radio value={false}>Not working remotely</Radio></Radio.Group></Form.Item>
        <Form.Item label="Why" htmlFor="rm-why" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}><Input.TextArea id="rm-why" rows={2} maxLength={200} showCount value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} /></Form.Item>
      </Form>
    </SideDrawer>
  );
}

function Report() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const ok = /^\d{4}-\d{2}-\d{2}$/.test(from) && /^\d{4}-\d{2}-\d{2}$/.test(to);
  const q = useQuery({ queryKey: ["remote-admin", "report", from, to], queryFn: () => api.remoteReport(from, to), enabled: ok });
  return (
    <Panel>
      <FilterBar filters={<><Input aria-label="From" placeholder="From YYYY-MM-DD" maxLength={10} value={from} onChange={(e) => setFrom(e.target.value)} style={{ maxWidth: 190 }} /><Input aria-label="To" placeholder="To YYYY-MM-DD" maxLength={10} value={to} onChange={(e) => setTo(e.target.value)} style={{ maxWidth: 190 }} /></>} />
      {!ok ? <EmptyState compact title="Choose a period" description="Write the first and last day, for example 2026-10-01 and 2026-10-31." /> : (
        <>
          {q.data && <Caption>{q.data.total.days} days: {q.data.total.full} full, {q.data.total.half} half, {q.data.total.absent} absent, {q.data.total.lossOfPay} loss of pay, {q.data.total.pending} waiting.</Caption>}
          <DataTable<api.RemoteReport["people"][number]>
            rowKey="name"
            density="compact"
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            dataSource={q.data?.people ?? []}
            pagination={false}
            empty={<EmptyState compact title="No remote days in this period" />}
            columns={[
              { title: "Employee", dataIndex: "name", key: "name" },
              { title: "Days", dataIndex: "days", key: "days", align: "right" },
              { title: "Full", dataIndex: "full", key: "full", align: "right" },
              { title: "Half", dataIndex: "half", key: "half", align: "right" },
              { title: "Absent", dataIndex: "absent", key: "absent", align: "right" },
              { title: "Loss of pay", dataIndex: "lossOfPay", key: "lop", align: "right" },
              { title: "Waiting", dataIndex: "pending", key: "pending", align: "right" },
              { title: "Hours", dataIndex: "hours", key: "hours", align: "right" },
            ]}
          />
        </>
      )}
    </Panel>
  );
}

function Settings() {
  const q = useQuery({ queryKey: ["remote-admin", "settings"], queryFn: api.remoteSettings });
  const [hours, setHours] = useState<number | null | undefined>(undefined);
  const [outcome, setOutcome] = useState<"ABSENT" | "LOSS_OF_PAY" | null | undefined>(undefined);
  const save = useMutation({ mutationFn: () => api.saveRemoteSettings({ reminderAfterHours: hours === undefined ? (q.data?.reminderAfterHours ?? null) : hours, suggestedRejectOutcome: outcome === undefined ? (q.data?.suggestedRejectOutcome ?? null) : outcome }), onSuccess: () => { toast.success("Saved."); void q.refetch(); setHours(undefined); setOutcome(undefined); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not save.")) });
  const shownHours = hours === undefined ? q.data?.reminderAfterHours ?? null : hours;
  const shownOutcome = outcome === undefined ? q.data?.suggestedRejectOutcome ?? null : outcome;
  return (
    <Panel title="Settings" subtitle="Both are Not set until a director sets them">
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Remind the directors when a day has waited this many hours" htmlFor="rs-hours" extra={shownHours === null ? "Not set: no reminder is sent." : undefined}>
          <InputNumber id="rs-hours" min={1} max={200} precision={0} value={shownHours} onChange={(x) => setHours(x === null ? null : Number(x))} style={{ width: 160 }} placeholder="Not set" />
        </Form.Item>
        <Form.Item label="Suggested outcome when a day is rejected" htmlFor="rs-outcome" extra={shownOutcome === null ? "Not set: nothing is suggested. The director always chooses." : "Only a suggestion; the director still chooses."}>
          <Select id="rs-outcome" allowClear placeholder="Not set" style={{ width: 220 }} value={shownOutcome ?? undefined} onChange={(x) => setOutcome(x ?? null)} options={[{ value: "ABSENT", label: "Absent" }, { value: "LOSS_OF_PAY", label: "Loss of pay" }]} />
        </Form.Item>
        <Button type="primary" size="large" loading={save.isPending} disabled={hours === undefined && outcome === undefined} onClick={() => save.mutate()}>Save</Button>
      </Form>
    </Panel>
  );
}
