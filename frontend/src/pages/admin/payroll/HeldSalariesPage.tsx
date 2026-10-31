import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Segmented, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as payrollApi from "../../../api/payroll";
import type { HoldRow, PersonHit } from "../../../api/payroll";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import { Caption, PersonCell } from "../../../components/payroll/payrollUi";
import { space } from "../../../theme/tokens";

// Payroll → Held salaries. A director holds one person's salary for one month, with a reason. The payroll run still calculates them but does not pay them, and
// they get no payslip. Releasing it is a director's act too: before the month's run is final it lifts the hold; after, the held pay is paid in the next run as
// a line of its own. This screen never shows an amount.

type Filter = "HELD" | "RELEASED" | "ALL";

export function HeldSalariesPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = hasPermission("payroll.salary.edit");
  const [filter, setFilter] = useState<Filter>("HELD");
  const [adding, setAdding] = useState(false);
  const [releasing, setReleasing] = useState<HoldRow | null>(null);
  const { data = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["payroll", "holds", filter],
    queryFn: () => payrollApi.listHolds(filter === "ALL" ? undefined : filter),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const addButton = canEdit && (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
      Hold a salary
    </Button>
  );
  const releaseButton = (h: HoldRow, block?: boolean) =>
    canEdit && h.status === "HELD" ? (
      <Button size={block ? undefined : "small"} block={block} onClick={() => setReleasing(h)}>
        Release
      </Button>
    ) : null;
  const statusChip = (h: HoldRow) => <StatusChip tone={h.status === "HELD" ? "warning" : "success"}>{h.status === "HELD" ? "Held" : "Released"}</StatusChip>;

  return (
    <>
      <PageHeader title="Held salaries" subtitle="Salaries a director is holding back, and those released" actions={addButton} />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Held means calculated but not paid"
          description="The run still works out a held person's month, but they are left out of the bank file and get no payslip. Releasing before the month's run is final lifts the hold; releasing after pays the held amount in the next run."
        />
        <Panel>
          <FilterBar
            activeCount={filter === "HELD" ? 0 : 1}
            onClear={() => setFilter("HELD")}
            filters={<Segmented aria-label="Show" value={filter} onChange={(v) => setFilter(v as Filter)} options={[{ value: "HELD", label: "Held now" }, { value: "RELEASED", label: "Released" }, { value: "ALL", label: "All" }]} />}
          />
          <DataTable<HoldRow>
            rowKey="id"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data}
            empty={<EmptyState compact title={filter === "HELD" ? "No salary is being held" : "Nothing here"} description={canEdit ? "A director can hold one person's salary for a month." : "Held salaries appear here."} action={filter === "HELD" ? addButton || undefined : <Button onClick={() => setFilter("ALL")}>Show all</Button>} />}
            mobile={{
              title: (h) => h.employeeName,
              subtitle: (h) => h.employeeCode,
              status: statusChip,
              fields: [
                { label: "Month starting", render: (h) => formatDate(h.cycleStart) },
                { label: "Why", render: (h) => h.reason },
              ],
              actions: canEdit ? (h) => releaseButton(h, true) : undefined,
            }}
            columns={[
              { title: "Employee", key: "employee", render: (_, h) => <PersonCell name={h.employeeName} code={h.employeeCode} /> },
              { title: "Month starting", key: "month", render: (_, h) => formatDate(h.cycleStart) },
              { title: "Why", key: "why", render: (_, h) => <div>{h.reason}{h.releaseNote && <Caption>Released: {h.releaseNote}</Caption>}</div> },
              { title: "Status", key: "status", render: (_, h) => statusChip(h) },
              { title: "", key: "actions", align: "right", render: (_, h) => releaseButton(h) },
            ]}
          />
        </Panel>
      </Stack>
      {adding && <HoldDrawer onClose={() => setAdding(false)} onDone={refresh} />}
      {releasing && <ReleaseModal row={releasing} onClose={() => setReleasing(null)} onDone={refresh} />}
    </>
  );
}

function HoldDrawer({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [hits, setHits] = useState<PersonHit[]>([]);
  const [employeeId, setEmployeeId] = useState<string>();
  const [cycleStart, setCycleStart] = useState("");
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const ready = !!employeeId && /^\d{4}-\d{2}-\d{2}$/.test(cycleStart) && reason.trim().length >= 3;
  const hold = useMutation({
    mutationFn: () => payrollApi.addHold({ employeeId: employeeId!, cycleStart, reason: reason.trim() }),
    onSuccess: () => {
      toast.success("Held. The next calculation leaves them out of payment.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not hold it.")),
  });
  return (
    <SideDrawer
      open
      title="Hold a salary"
      subtitle="One person, one month, with a reason"
      onClose={onClose}
      footer={
        <div style={{ display: "flex", gap: space[3], width: "100%" }}>
          <Button size="large" style={{ flex: 1 }} onClick={onClose}>Cancel</Button>
          <Button size="large" type="primary" style={{ flex: 1 }} disabled={!ready} loading={hold.isPending} onClick={() => hold.mutate()}>Hold it</Button>
        </div>
      }
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Who" htmlFor="hold-employee">
          <Select
            id="hold-employee"
            showSearch
            filterOption={false}
            style={{ width: "100%" }}
            placeholder="Type a name or employee code"
            notFoundContent={null}
            value={employeeId}
            options={hits.map((h) => ({ value: h.employeeId, label: `${h.name} (${h.employeeCode})` }))}
            onSearch={(q) => {
              if (q.trim().length >= 2) void payrollApi.searchPeople(q.trim()).then(setHits);
            }}
            onChange={setEmployeeId}
          />
        </Form.Item>
        <Form.Item label="First day of the month's payroll period" htmlFor="hold-cycle" extra="For example 2026-08-01. A month whose run is already final cannot be held.">
          <Input id="hold-cycle" inputMode="numeric" maxLength={10} placeholder="YYYY-MM-DD" autoComplete="off" value={cycleStart} onChange={(e) => setCycleStart(e.target.value)} style={{ maxWidth: 220 }} />
        </Form.Item>
        <Form.Item label="Why" htmlFor="hold-reason" validateStatus={problem ? "error" : undefined} help={problem ?? undefined}>
          <Input.TextArea id="hold-reason" rows={3} maxLength={200} showCount value={reason} onChange={(e) => { setReason(e.target.value); setProblem(null); }} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

function ReleaseModal({ row, onClose, onDone }: { row: HoldRow; onClose: () => void; onDone: () => void }) {
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const release = useMutation({
    mutationFn: () => payrollApi.releaseHold(row.id, note.trim()),
    onSuccess: (r) => {
      toast.success(r.adjustmentId ? "Released. It is paid in the next run." : "Released. The next calculation pays them as usual.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "Could not release it.")),
  });
  return (
    <ConfirmModal
      open
      title={`Release ${row.employeeName}'s salary`}
      description={row.runFinal ? "The month's run is final, so the held amount is paid in the next run as a line of its own." : "The month's run is not final, so this lifts the hold and the next calculation pays them as usual."}
      confirmLabel="Release it"
      cancelLabel="Keep it held"
      confirmDisabled={note.trim().length < 3}
      loading={release.isPending}
      onCancel={onClose}
      onConfirm={() => release.mutate()}
    >
      <Form layout="vertical" component="div" requiredMark={false}>
        <Form.Item label="Why it is released" htmlFor="release-note" validateStatus={problem ? "error" : undefined} help={problem ?? "At least 3 characters."} style={{ marginBottom: 0 }}>
          <Input.TextArea id="release-note" autoFocus rows={2} maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
        </Form.Item>
      </Form>
    </ConfirmModal>
  );
}
