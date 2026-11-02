import { useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select, Tabs } from "antd";
import { CheckCircleOutlined, HistoryOutlined, LockOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { InputGridRow, InputHead, MonthView } from "../../../api/payroll";
import { departments } from "../../../api/org";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, PageHeader, Panel, SideDrawer, SkeletonCard, Stack, StatCard, StatusChip, toast, useIsPhone } from "../../../ui";
import { CheckersNote } from "../../../components/payroll/CheckersNote";
import { Caption, Num, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";
import { MonthlyInputsImport } from "./MonthlyInputsImport";

// Payroll → Monthly Inputs. Directors only. One row per person, one column per pay head that "takes its value from Monthly Inputs" (the columns come from those
// heads, nothing is built in). The grid opens when the month's attendance is final. A blank cell is "nothing entered"; 0 is entered as zero. A figure is never
// overwritten: a change is a new entry, and the history shows every one. A different director confirms exactly these figures, and any later change voids that.

const STATE_LABEL: Record<payrollApi.MonthState, string> = { CLOSED: "Closed", OPEN: "Open for figures", CONFIRMED: "Confirmed", LOCKED: "Locked by a run" };
const PAGE_SIZE = 25;

export function MonthlyInputsPage() {
  const queryClient = useQueryClient();
  const isPhone = useIsPhone();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission("payroll.salary.edit");
  const canDecide = hasPermission("payroll.approve");
  const [cycleStart, setCycleStart] = useState<string | null>(null);
  const [tab, setTab] = useState("figures");
  const [departmentId, setDepartmentId] = useState<string>();
  const [employeeId, setEmployeeId] = useState<string>();
  const [head, setHead] = useState<string>();
  const [status, setStatus] = useState<"NOT_ENTERED" | "ENTERED" | "CHANGED">();
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<InputGridRow | null>(null);
  const [historyOf, setHistoryOf] = useState<{ employeeId?: string; name?: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deciding, setDeciding] = useState(false);
  const [filling, setFilling] = useState(false);

  const months = useQuery({ queryKey: ["payroll", "inputs", "months"], queryFn: payrollApi.inputMonths });
  const chosen = cycleStart ?? months.data?.find((m) => m.cycleEnd < todayIso())?.cycleStart ?? months.data?.[0]?.cycleStart ?? null;
  const depts = useQuery({ queryKey: ["org", "departments"], queryFn: () => departments.list(), staleTime: 300_000 });
  const grid = useQuery({
    queryKey: ["payroll", "inputs", "grid", chosen, departmentId, employeeId, head, status, page],
    queryFn: () => payrollApi.inputGrid({ cycleStart: chosen!, page, pageSize: PAGE_SIZE, ...(departmentId ? { departmentId } : {}), ...(employeeId ? { employeeId } : {}), ...(head ? { head } : {}), ...(status ? { status } : {}) }),
    enabled: chosen !== null,
    placeholderData: keepPreviousData,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll", "inputs"] });
  const month = grid.data?.month ?? null;
  const heads = useMemo(() => (month?.heads ?? []).filter((h) => !head || h.code === head), [month, head]);
  const accepts = month?.state === "OPEN" || month?.state === "CONFIRMED";
  const activeFilters = [departmentId, employeeId, head, status].filter(Boolean).length;
  const clear = () => {
    setDepartmentId(undefined);
    setEmployeeId(undefined);
    setHead(undefined);
    setStatus(undefined);
    setPage(1);
  };

  const cellOf = (row: InputGridRow, code: string) => row.cells.find((c) => c.head === code);
  const cellView = (row: InputGridRow, h: InputHead) => {
    const c = cellOf(row, h.code);
    if (!c || c.amount === null) return <Caption>Not entered</Caption>;
    return (
      <div>
        <Num>{c.amount}</Num>
        {c.entries > 1 && <Caption>Changed {c.entries - 1} {c.entries === 2 ? "time" : "times"}</Caption>}
      </div>
    );
  };

  const stateBanner = month && (
    <ApprovalBanner
      tone={month.state === "OPEN" ? "info" : month.state === "CONFIRMED" ? "success" : month.state === "LOCKED" ? "warning" : "warning"}
      icon={month.state === "LOCKED" ? <LockOutlined /> : month.state === "CONFIRMED" ? <CheckCircleOutlined /> : undefined}
      title={`${month.label}: ${STATE_LABEL[month.state]}`}
      description={month.reason ?? confirmationText(month)}
      actions={
        <>
          {canEdit && accepts && month.confirmation.status !== "PENDING" && month.confirmation.status !== "CONFIRMED" && month.heads.length > 0 && (
            <Button type="primary" onClick={() => setConfirming(true)}>Confirm these figures</Button>
          )}
          {canDecide && month.confirmation.status === "PENDING" && <Button type="primary" onClick={() => setDeciding(true)}>Review and decide</Button>}
        </>
      }
    />
  );

  return (
    <>
      <PageHeader
        title="Monthly Inputs"
        subtitle="Figures a director enters each month for pay heads that take their value from Monthly Inputs"
        actions={
          <Select
            aria-label="Month"
            style={{ minWidth: 180 }}
            loading={months.isLoading}
            value={chosen ?? undefined}
            onChange={(v) => {
              setCycleStart(v);
              setPage(1);
            }}
            options={(months.data ?? []).map((m) => ({ value: m.cycleStart, label: m.label }))}
          />
        }
      />
      <Stack>
        {stateBanner ?? (grid.isLoading ? <SkeletonCard lines={1} /> : null)}
        {month && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: space[3] }}>
            <StatCard label="People" value={String(month.people)} />
            <StatCard label="Pay heads" value={String(month.heads.length)} />
            <StatCard label="Entered" value={String(month.entered)} />
            <StatCard label="Still blank" value={String(month.blank)} />
          </div>
        )}
        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: "figures",
              label: "Figures",
              children: (
                <Panel>
                  <FilterBar
                    activeCount={activeFilters}
                    onClear={clear}
                    filters={
                      <>
                        <Select allowClear aria-label="Department" placeholder="Department" style={{ minWidth: 170 }} value={departmentId} onChange={(v) => { setDepartmentId(v); setPage(1); }} options={(depts.data ?? []).map((d) => ({ value: d.id, label: d.name }))} />
                        <PersonFilter value={employeeId} onChange={(v) => { setEmployeeId(v); setPage(1); }} />
                        <Select allowClear aria-label="Pay head" placeholder="Pay head" style={{ minWidth: 170 }} value={head} onChange={(v) => { setHead(v); setPage(1); }} options={(month?.heads ?? []).map((h) => ({ value: h.code, label: h.name }))} />
                        <Select allowClear aria-label="Status" placeholder="Status" style={{ minWidth: 150 }} value={status} onChange={(v) => { setStatus(v); setPage(1); }} options={[{ value: "NOT_ENTERED", label: "Not entered" }, { value: "ENTERED", label: "All entered" }, { value: "CHANGED", label: "Changed this month" }]} />
                      </>
                    }
                    actions={
                      <>
                        {canEdit && accepts && month.blank > 0 && <Button onClick={() => setFilling(true)}>Enter 0 in blank figures</Button>}
                        <Button icon={<HistoryOutlined />} onClick={() => setHistoryOf({})}>History</Button>
                      </>
                    }
                  />
                  <DataTable<InputGridRow>
                    rowKey="employeeId"
                    density="compact"
                    loading={grid.isLoading || grid.isFetching}
                    error={grid.error}
                    onRetry={() => void grid.refetch()}
                    dataSource={grid.data?.rows ?? []}
                    pagination={{ current: page, pageSize: PAGE_SIZE, total: grid.data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
                    empty={
                      month && month.heads.length === 0 ? (
                        <EmptyState compact title="No pay head takes its value from Monthly Inputs yet" description="Create a pay head under Salary Components and flag it as taking its value from Monthly Inputs. It appears here as a column." />
                      ) : (
                        <EmptyState compact title="Nobody matches" description="Change or clear the filters." action={<Button onClick={clear}>Clear filters</Button>} />
                      )
                    }
                    mobile={{
                      title: (r) => r.name,
                      subtitle: (r) => r.employeeCode,
                      fields: heads.slice(0, 4).map((h) => ({ label: h.name, render: (r: InputGridRow) => cellView(r, h) })),
                      actions: (r) => <RowActions row={r} canEdit={canEdit && accepts} onEdit={() => setEditing(r)} onHistory={() => setHistoryOf({ employeeId: r.employeeId, name: r.name })} block />,
                    }}
                    columns={[
                      { title: "Employee", key: "employee", fixed: isPhone ? undefined : "left", render: (_, r) => <PersonCell name={r.name} code={`${r.employeeCode}${r.departmentName ? ` · ${r.departmentName}` : ""}`} /> },
                      ...heads.map((h) => ({ title: <span>{h.name}<Caption>{h.direction === null || h.allowNegative === null ? "Not set" : `${h.direction === "DEDUCTION" ? "Deduction" : "Earning"}${h.allowNegative ? ", negative allowed" : ""}`}</Caption></span>, key: h.code, align: "right" as const, render: (_: unknown, r: InputGridRow) => cellView(r, h) })),
                      { title: "", key: "actions", align: "right", render: (_, r) => <RowActions row={r} canEdit={canEdit && accepts} onEdit={() => setEditing(r)} onHistory={() => setHistoryOf({ employeeId: r.employeeId, name: r.name })} /> },
                    ]}
                  />
                </Panel>
              ),
            },
            { key: "import", label: "Import a file", children: <MonthlyInputsImport canEdit={canEdit} onApplied={refresh} /> },
          ]}
        />
      </Stack>
      {editing && month && <EntryDrawer month={month} row={editing} onClose={() => setEditing(null)} onDone={refresh} />}
      {historyOf && month && <HistoryDrawer cycleStart={month.cycleStart} heads={month.heads} filter={historyOf} onClose={() => setHistoryOf(null)} />}
      {filling && month && <FillBlanksDialog month={month} head={head} onClose={() => setFilling(false)} onDone={refresh} />}
      {confirming && month && <ConfirmDialog month={month} mode="request" onClose={() => setConfirming(false)} onDone={refresh} />}
      {deciding && month && <ConfirmDialog month={month} mode="decide" onClose={() => setDeciding(false)} onDone={refresh} />}
    </>
  );
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10); // allow-clock: picks the default month in the picker only
}

function confirmationText(m: MonthView): string {
  const c = m.confirmation;
  if (c.status === "PENDING") return `${c.makerName ?? "A director"} asked for these figures to be confirmed. Another director decides.`;
  if (c.status === "CONFIRMED") return `Confirmed${c.checkerName ? ` by ${c.checkerName}` : ""}${c.at ? ` on ${formatDateTime(c.at)}` : ""}. Any change to a figure voids this.`;
  if (c.status === "OUT_OF_DATE") return "A figure changed after the last confirmation, so it no longer applies. Confirm again.";
  return m.blank > 0 ? `${m.blank} ${m.blank === 1 ? "figure is" : "figures are"} still blank. A payroll run for this month will not start until each is entered, even as 0, and the figures are confirmed.` : "Every figure is entered. A different director still has to confirm them before payroll can run.";
}

function RowActions({ row, canEdit, onEdit, onHistory, block }: { row: InputGridRow; canEdit: boolean; onEdit: () => void; onHistory: () => void; block?: boolean }) {
  return (
    <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end", flexWrap: "wrap", width: block ? "100%" : undefined }}>
      {canEdit && (
        <Button size={block ? "large" : "small"} style={block ? { flex: 1 } : undefined} onClick={onEdit} aria-label={`Enter figures for ${row.name}`}>
          Enter figures
        </Button>
      )}
      <Button size={block ? "large" : "small"} style={block ? { flex: 1 } : undefined} onClick={onHistory} aria-label={`History for ${row.name}`}>
        History
      </Button>
    </div>
  );
}

function PersonFilter({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const [hits, setHits] = useState<payrollApi.PersonHit[]>([]);
  return (
    <Select
      allowClear
      showSearch
      filterOption={false}
      aria-label="Employee"
      placeholder="Employee"
      style={{ minWidth: 190 }}
      notFoundContent={null}
      value={value}
      options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))}
      onSearch={(q) => {
        if (q.trim().length >= 2) void payrollApi.searchPeople(q.trim()).then(setHits);
      }}
      onChange={(v) => onChange(v)}
    />
  );
}

function EntryDrawer({ month, row, onClose, onDone }: { month: MonthView; row: InputGridRow; onClose: () => void; onDone: () => void }) {
  const start = Object.fromEntries(row.cells.map((c) => [c.head, c.amount ?? ""]));
  const [values, setValues] = useState<Record<string, string>>(start);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const changed = month.heads.filter((h) => (values[h.code] ?? "") !== (start[h.code] ?? ""));
  const save = useMutation({
    mutationFn: () => payrollApi.enterInputs({ cycleStart: month.cycleStart, reason: reason.trim(), entries: changed.map((h) => ({ employeeId: row.employeeId, head: h.code, amount: (values[h.code] ?? "").trim() === "" ? null : values[h.code]!.trim() })) }),
    onSuccess: (r) => {
      toast.success(r.voidedConfirmation ? "Saved. The confirmation of this month no longer applies; it needs confirming again." : "Saved.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")),
  });
  return (
    <SideDrawer
      open
      title={`Figures for ${row.name}`}
      subtitle={`${row.employeeCode} · ${month.label}`}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          <Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          <Button size="large" type="primary" style={{ flex: 1 }} disabled={changed.length === 0 || reason.trim().length < 3} loading={save.isPending} onClick={() => save.mutate()}>
            Save {changed.length > 0 ? `${changed.length} ${changed.length === 1 ? "change" : "changes"}` : ""}
          </Button>
        </div>
      }
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        {month.heads.map((h) => (
          <Form.Item key={h.code} label={`${h.name} (${h.direction === null ? "direction Not set" : h.direction === "DEDUCTION" ? "deduction" : "earning"})`} htmlFor={`in-${h.code}`} extra={h.direction === null || h.allowNegative === null ? "Not set: a director chooses the direction and whether negative figures are allowed on the pay head first." : h.allowNegative ? "Leave blank for nothing entered. Write 0 to enter zero. A negative figure goes the other way." : "Leave blank for nothing entered. Write 0 to enter zero. Negative figures are not allowed."}>
            <Input id={`in-${h.code}`} inputMode="decimal" autoComplete="off" disabled={h.direction === null || h.allowNegative === null} value={values[h.code] ?? ""} onChange={(e) => { setValues({ ...values, [h.code]: e.target.value }); setProblem(null); }} style={{ maxWidth: 240 }} />
          </Form.Item>
        ))}
        <Form.Item label="Why" htmlFor="in-reason" validateStatus={problem ? "error" : undefined} help={problem ?? "Kept with the entry in the history. At least 3 characters."}>
          <Input.TextArea id="in-reason" rows={2} maxLength={200} showCount value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

function HistoryDrawer({ cycleStart, heads, filter, onClose }: { cycleStart: string; heads: InputHead[]; filter: { employeeId?: string; name?: string }; onClose: () => void }) {
  const q = useQuery({ queryKey: ["payroll", "inputs", "history", cycleStart, filter.employeeId], queryFn: () => payrollApi.inputHistory({ cycleStart, ...(filter.employeeId ? { employeeId: filter.employeeId } : {}) }) });
  const name = (code: string) => heads.find((h) => h.code === code)?.name ?? code;
  return (
    <SideDrawer open title={filter.name ? `History for ${filter.name}` : "History of this month"} subtitle="Every entry, newest first. Nothing is ever overwritten." onClose={onClose}>
      <DataTable<payrollApi.InputHistoryEntry>
        rowKey="id"
        density="compact"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        pagination={false}
        empty={<EmptyState compact title="Nothing has been entered" description="Entries appear here as they are made." />}
        mobile={{ title: (e) => (e.cleared ? "Cleared" : e.amount ?? ""), subtitle: (e) => `${e.name} · ${name(e.head)}`, fields: [{ label: "When", render: (e) => formatDateTime(e.at) }, { label: "By", render: (e) => e.by }, { label: "Why", render: (e) => e.reason }] }}
        columns={[
          ...(filter.employeeId ? [] : [{ title: "Employee", key: "who", render: (_: unknown, e: payrollApi.InputHistoryEntry) => <PersonCell name={e.name} code={e.employeeCode} /> }]),
          { title: "Pay head", key: "head", render: (_, e) => name(e.head) },
          { title: "Figure", key: "amount", align: "right", render: (_, e) => (e.cleared ? <StatusChip tone="neutral">Cleared</StatusChip> : <Num>{e.amount}</Num>) },
          { title: "Entered", key: "when", render: (_, e) => <div>{formatDateTime(e.at)}<Caption>{e.by}{e.fromFile ? " · from a file" : ""} · {e.reason}</Caption></div> },
        ]}
      />
    </SideDrawer>
  );
}

function ConfirmDialog({ month, mode, onClose, onDone }: { month: MonthView; mode: "request" | "decide"; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["payroll", "inputs", "confirm-preview", month.cycleStart], queryFn: () => payrollApi.previewInputConfirmation(month.cycleStart), gcTime: 0 });
  const p = preview.data;
  const run = useMutation({
    mutationFn: (decision?: "APPROVE" | "REJECT") =>
      decision ? payrollApi.decideInputConfirmation(month.cycleStart, { decision, fingerprint: p!.fingerprint, ...(note.trim() ? { note: note.trim() } : {}) }) : payrollApi.requestInputConfirmation({ cycleStart: month.cycleStart, fingerprint: p!.fingerprint, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: (_r, decision) => {
      toast.success(decision === "APPROVE" ? "Confirmed." : decision === "REJECT" ? "Sent back." : p?.mode === "DIRECTOR_AUTHORITY" ? "Confirmed. The other director has been told." : "Sent to the other director.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not do that.")),
  });
  const waiting = month.confirmation.status === "PENDING";
  return (
    <ConfirmModal
      open
      title={mode === "decide" ? `Decide the Monthly Inputs for ${month.label}` : `Confirm the Monthly Inputs for ${month.label}`}
      description={p ? undefined : "Loading what will be confirmed…"}
      confirmLabel={mode === "decide" ? "Approve these figures" : p?.mode === "DIRECTOR_AUTHORITY" ? "Confirm now" : "Send to the other director"}
      cancelLabel="Close"
      confirmDisabled={!p || (mode === "decide" ? !waiting : p.mode === "NOT_SET" || (p.checkers.state === "NONE" && p.mode !== "DIRECTOR_AUTHORITY"))}
      loading={run.isPending}
      onCancel={onClose}
      onConfirm={() => run.mutate(mode === "decide" ? "APPROVE" : undefined)}
    >
      <Stack>
        {preview.isLoading && <SkeletonCard lines={2} />}
        {preview.error && <ApprovalBanner tone="danger" title="Could not load" description={apiErrorMessage(preview.error, "Try again.")} />}
        {p && (
          <>
            <div>
              {p.month.entered} of {p.month.cells} figures are entered for {p.month.people} {p.month.people === 1 ? "person" : "people"}. You confirm exactly these; if any figure changes afterwards, the confirmation is void.
            </div>
            {p.warnings.map((w) => <ApprovalBanner key={w} tone="warning" title={w} />)}
            {p.mode === "NOT_SET" && <ApprovalBanner tone="warning" title="How this step is decided is not set" description="The two directors have to choose, in Director authority, whether a different director decides this or the acting director alone." />}
            {p.mode !== "NOT_SET" && <CheckersNote checkers={p.checkers} what="these figures" />}
          </>
        )}
        <Form layout="vertical" component="div" requiredMark={false}>
          <Form.Item label={mode === "decide" ? "Note (needed to reject)" : "Note (optional)"} htmlFor="mi-note" validateStatus={problem ? "error" : undefined} help={problem ?? undefined} style={{ marginBottom: 0 }}>
            <Input.TextArea id="mi-note" rows={2} maxLength={200} value={note} onChange={(e) => { setNote(e.target.value); setProblem(null); }} />
          </Form.Item>
        </Form>
        {mode === "decide" && waiting && (
          <Button danger block size="large" disabled={note.trim().length < 3} loading={run.isPending} onClick={() => run.mutate("REJECT")}>
            Reject, with the reason above
          </Button>
        )}
        <Caption>Month starting {formatDate(month.cycleStart)}</Caption>
      </Stack>
    </ConfirmModal>
  );
}

function FillBlanksDialog({ month, head, onClose, onDone }: { month: MonthView; head: string | undefined; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const headName = month.heads.find((h) => h.code === head)?.name;
  const fill = useMutation({
    mutationFn: () => payrollApi.fillInputBlanks({ cycleStart: month.cycleStart, ...(head ? { head } : {}), reason: reason.trim() }),
    onSuccess: (r) => {
      toast.success(`Entered 0 in ${r.written} ${r.written === 1 ? "figure" : "figures"}.`);
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not save.")),
  });
  return (
    <ConfirmModal
      open
      title={headName ? `Enter 0 in every blank ${headName} figure` : "Enter 0 in every blank figure"}
      description="This says 'nothing for these people this month'. A figure that already has a value is never changed. Each one goes into the history."
      confirmLabel="Enter the zeros"
      cancelLabel="Cancel"
      confirmDisabled={reason.trim().length < 3}
      loading={fill.isPending}
      onCancel={onClose}
      onConfirm={() => fill.mutate()}
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Why" htmlFor="fill-reason" validateStatus={problem ? "error" : undefined} help={problem ?? "At least 3 characters."} style={{ marginBottom: 0 }}>
          <Input.TextArea id="fill-reason" autoFocus rows={2} maxLength={200} value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
        </Form.Item>
      </Form>
    </ConfirmModal>
  );
}
