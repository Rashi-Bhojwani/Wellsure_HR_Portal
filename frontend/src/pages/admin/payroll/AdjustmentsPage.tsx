import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Segmented, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { AdjustmentPreview, AdjustmentRow, PersonHit } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, KeyValueGrid, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast, type ChipTone } from "../../../ui";
import { Caption, Num, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Adjustments (Phase 6 P6-2). One-off earnings and deductions HR adds before a run, and the arrears a back-dated salary revision made. Adding one is
// previewed first. They are part of what a run approves, so a run approved before one was added has to be approved again. Nobody adds or cancels one for
// their own pay. Nothing here is optimistic: the list changes when the server has answered.

type StatusFilter = "PENDING" | "CONSUMED" | "CANCELLED" | "ALL";
const STATUS: Record<AdjustmentRow["status"], { tone: ChipTone; label: string }> = {
  PENDING: { tone: "warning", label: "Waiting" },
  CONSUMED: { tone: "success", label: "Used" },
  CANCELLED: { tone: "neutral", label: "Cancelled" },
};

const signed = (a: { direction: "EARNING" | "DEDUCTION"; amount: string }) => `${a.direction === "DEDUCTION" ? "-" : ""}${formatRupees(a.amount)}`;

export function AdjustmentsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const [status, setStatus] = useState<StatusFilter>("PENDING");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<AdjustmentRow | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["payroll", "adjustments", status, page],
    queryFn: () => payrollApi.listAdjustments({ status: status === "ALL" ? undefined : status, page, pageSize: 25 }),
    placeholderData: keepPreviousData,
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const addButton = canEdit && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
      Add an adjustment
    </Button>
  );
  const cancelButton = (a: AdjustmentRow, block?: boolean) =>
    canEdit && a.status === "PENDING" ? (
      <Button size={block ? undefined : "small"} block={block} danger onClick={() => setCancelling(a)}>
        Cancel
      </Button>
    ) : null;

  return (
    <>
      <PageHeader title="Payroll adjustments" subtitle="One-off earnings, deductions and arrears for the next run" actions={addButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Paid or taken in the next run"
          description="A bonus, a recovery, or arrears from a back-dated salary revision. Each is paid or taken in the next payroll run for that person. Until a run uses it, it can be cancelled."
        />
        <Panel>
          <FilterBar
            activeCount={status === "PENDING" ? 0 : 1}
            onClear={() => { setStatus("PENDING"); setPage(1); }}
            filters={
              <Segmented
                aria-label="Show"
                value={status}
                onChange={(val) => { setStatus(val as StatusFilter); setPage(1); }}
                options={[{ value: "PENDING", label: "Waiting for a run" }, { value: "CONSUMED", label: "Used by a run" }, { value: "CANCELLED", label: "Cancelled" }, { value: "ALL", label: "All" }]}
              />
            }
          />
          <DataTable<AdjustmentRow>
            rowKey="id"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.items ?? []}
            pagination={{ current: page, pageSize: 25, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
            showTotal
            empty={
              <EmptyState
                compact
                title={status === "PENDING" ? "Nothing is waiting for a run" : "No adjustments here"}
                description={canEdit ? "Add a bonus or a recovery, or prepare a back-dated salary revision to create arrears." : "Adjustments HR adds before a run appear here."}
                action={status === "PENDING" ? addButton || undefined : <Button onClick={() => setStatus("ALL")}>Show all</Button>}
              />
            }
            mobile={{
              title: (a) => a.employeeName,
              subtitle: (a) => a.employeeCode,
              status: (a) => <StatusChip tone={STATUS[a.status].tone}>{STATUS[a.status].label}</StatusChip>,
              fields: [
                { label: "What", render: (a) => <WhatCell a={a} /> },
                { label: "Kind", render: (a) => <KindChips a={a} /> },
                { label: "Amount", render: (a) => <Num tone={a.direction === "DEDUCTION" ? "danger" : undefined}>{signed(a)}</Num> },
              ],
              actions: canEdit ? (a) => cancelButton(a, true) : undefined,
            }}
            columns={[
              { title: "Employee", key: "employee", render: (_, a) => <PersonCell name={a.employeeName} code={a.employeeCode} /> },
              { title: "What", key: "what", render: (_, a) => <WhatCell a={a} /> },
              { title: "Kind", key: "kind", render: (_, a) => <KindChips a={a} /> },
              { title: "Amount", key: "amount", align: "right", render: (_, a) => <Num tone={a.direction === "DEDUCTION" ? "danger" : undefined}>{signed(a)}</Num> },
              {
                title: "Status",
                key: "status",
                render: (_, a) => (
                  <div>
                    <StatusChip tone={STATUS[a.status].tone}>{STATUS[a.status].label}</StatusChip>
                    {a.cancelReason && <Caption>{a.cancelReason}</Caption>}
                  </div>
                ),
              },
              { title: "", key: "actions", align: "right", render: (_, a) => cancelButton(a) },
            ]}
          />
        </Panel>
      </Stack>
      {adding && <AddDrawer onClose={() => setAdding(false)} onDone={refresh} />}
      {cancelling && <CancelModal row={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />}
    </>
  );
}

function WhatCell({ a }: { a: AdjustmentRow }) {
  return (
    <div>
      {a.reason}
      {a.periodStart && <Caption>For {formatDate(a.periodStart)} to {a.periodEnd ? formatDate(a.periodEnd) : ""}</Caption>}
    </div>
  );
}

function KindChips({ a }: { a: AdjustmentRow }) {
  return (
    <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap" }}>
      <StatusChip tone={a.direction === "EARNING" ? "success" : "danger"}>{a.direction === "EARNING" ? "Earning" : "Deduction"}</StatusChip>
      {a.source === "SALARY_ARREARS" && <StatusChip tone="warning">Arrears</StatusChip>}
    </span>
  );
}

// ── Add: fill in, preview what it does, then add it (two steps, never optimistic) ──

function AddDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [employeeId, setEmployeeId] = useState<string>();
  const [componentCode, setComponentCode] = useState<string>();
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const { data: components = [], isLoading: componentsLoading } = useQuery({ queryKey: ["payroll", "components"], queryFn: payrollApi.listComponents });
  const usable = components.filter((c) => c.value && c.value.type !== "EMPLOYER_CONTRIBUTION");
  const component = usable.find((c) => c.code === componentCode);
  const input = employeeId && componentCode && component?.value && amount.trim() && reason.trim() ? { employeeId, componentCode, direction: component.value.type as "EARNING" | "DEDUCTION", amount: amount.trim(), reason: reason.trim() } : null;
  const preview = useMutation({ mutationFn: () => payrollApi.previewAdjustment(input!), onSuccess: () => setProblem(null), onError: (e) => setProblem(apiErrorMessage(e, "Could not check that.")) });
  const add = useMutation({
    mutationFn: () => payrollApi.addAdjustment(input!, preview.data!.fingerprint),
    onSuccess: () => { toast.success("Added."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not add it.")),
  });
  const p: AdjustmentPreview | undefined = preview.data;
  const edited = () => preview.reset();
  return (
    <SideDrawer
      open
      title="Add an adjustment"
      subtitle={p ? "Check what it does, then add it" : "Who, what, how much and why"}
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          <Button size="large" style={{ flex: 1 }} onClick={p ? () => preview.reset() : onClose}>{p ? "Back" : "Cancel"}</Button>
          {p ? (
            <Button size="large" type="primary" style={{ flex: 1 }} loading={add.isPending} onClick={() => add.mutate()}>Add it</Button>
          ) : (
            <Button size="large" type="primary" style={{ flex: 1 }} disabled={!input} loading={preview.isPending} onClick={() => preview.mutate()}>Preview</Button>
          )}
        </div>
      }
    >
      {!p ? (
        <Form layout="vertical" component="div" requiredMark={false}>
          <Form.Item label="Who" htmlFor="adj-employee">
            <Select id="adj-employee" showSearch filterOption={false} style={{ width: "100%" }} placeholder="Type a name or employee code" notFoundContent={null} value={employeeId} options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))} onSearch={(q) => { if (q.trim().length >= 2) void payrollApi.searchPeople(q.trim()).then(setHits); }} onChange={(val) => { setEmployeeId(val); edited(); }} />
          </Form.Item>
          <Form.Item label="Which component" htmlFor="adj-component">
            <Select id="adj-component" showSearch optionFilterProp="label" loading={componentsLoading} style={{ width: "100%" }} placeholder="Which component" value={componentCode} options={usable.map((c) => ({ value: c.code, label: `${c.value!.name}: ${c.value!.type === "EARNING" ? "earning" : "deduction"}` }))} onChange={(val) => { setComponentCode(val); edited(); }} />
          </Form.Item>
          <Form.Item label="Amount" htmlFor="adj-amount">
            <Input id="adj-amount" prefix="₹" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => { setAmount(e.target.value); edited(); }} placeholder="5000" style={{ maxWidth: 220 }} />
          </Form.Item>
          <Form.Item label="Why" htmlFor="adj-reason" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}>
            <Input.TextArea id="adj-reason" value={reason} onChange={(e) => { setReason(e.target.value); edited(); }} rows={3} maxLength={300} showCount placeholder="Why" />
          </Form.Item>
        </Form>
      ) : (
        <Stack>
          <KeyValueGrid
            columns={1}
            items={[
              { label: "Who", value: p.employeeName },
              { label: "What", value: `${p.componentName}: ${p.direction === "EARNING" ? "an earning" : "a deduction"}` },
              { label: "Amount", value: <Num strong>{formatRupees(p.amount)}</Num> },
              { label: "Why", value: p.reason },
            ]}
          />
          {p.alreadyPending.length > 0 && <ApprovalBanner tone="warning" title="They already have adjustments waiting" description={p.alreadyPending.map((x) => `${x.componentCode} ${x.direction === "DEDUCTION" ? "-" : ""}${formatRupees(x.amount)}: ${x.reason}`).join("; ")} />}
          <ApprovalBanner tone="info" title={p.effect} />
          {problem && <ApprovalBanner tone="danger" title={problem} />}
        </Stack>
      )}
    </SideDrawer>
  );
}

function CancelModal({ row, onClose, onDone }: { row: AdjustmentRow; onClose: () => void; onDone: () => void }) {
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const cancel = useMutation({
    mutationFn: () => payrollApi.cancelAdjustment(row.id, why),
    onSuccess: () => { toast.success("Cancelled."); onDone(); onClose(); },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not cancel it.")),
  });
  return (
    <ConfirmModal
      open
      danger
      title={`Cancel ${row.reason}`}
      description={`${row.employeeName}: ${signed(row)}`}
      confirmLabel="Cancel this adjustment"
      cancelLabel="Keep it"
      confirmDisabled={why.trim().length < 3}
      loading={cancel.isPending}
      onCancel={onClose}
      onConfirm={() => cancel.mutate()}
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Why" htmlFor="adj-cancel-why" validateStatus={problem ? "error" : undefined} help={problem ?? "At least 3 characters."} style={{ marginBottom: 0 }}>
          <Input.TextArea id="adj-cancel-why" autoFocus value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="Why" />
        </Form.Item>
      </Form>
    </ConfirmModal>
  );
}
