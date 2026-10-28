import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Tooltip } from "antd";
import { LockOutlined, ReloadOutlined, UnlockOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../api/attendance";
import type { PeriodRow, PeriodStatus } from "../../../api/attendance";
import { FinalisationBlockers } from "../../../components/attendance/FinalisationBlockers";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage, apiErrorCode } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, Skel, Stack, StatusChip, toast, useIsPhone, type ChipTone } from "../../../ui";

const STATUS: Record<PeriodStatus, { tone: ChipTone; label: string }> = {
  OPEN: { tone: "neutral", label: "Open" },
  FINALISED: { tone: "success", label: "Finalised" },
  UNLOCKED: { tone: "warning", label: "Unlocked (not finalised again)" },
};

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const lastActionText = (r: PeriodRow) => (r.last ? `${r.last.action === "FINALISE" ? "Finalised" : "Unlocked"} by ${r.last.by ?? "someone"} on ${formatDateTime(r.last.at)}` : null);

function PeriodStatusChips({ r }: { r: PeriodRow }) {
  return (
    <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
      <StatusChip tone={STATUS[r.status].tone} icon={r.status === "FINALISED" ? <LockOutlined /> : undefined}>
        {STATUS[r.status].label}
        {!r.isOver && r.status === "OPEN" ? " · in progress" : ""}
      </StatusChip>
      {r.unprocessed && r.unprocessed.employees > 0 && <StatusChip tone="warning">{r.unprocessed.employees} waiting</StatusChip>}
    </div>
  );
}

// Workforce → Attendance → Attendance Period Finalisation (Phase 3 commit 3): lock a whole attendance cycle once nothing blocks
// it. Finalising locks every day of the period against changes (overrides, corrections, manual entry, Process Attendance);
// only a Super Admin can unlock, with a reason, and is told if payroll has already used the period.
// Audited both ways: the ConfirmModal stays open until the server answers, never optimistic.
export function FinalisationPage() {
  const { hasPermission } = useAuth();
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const canUnlock = hasPermission("attendance.unlock");
  const [picked, setPicked] = useState<string | null>(null);
  const [finalising, setFinalising] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [payrollWarning, setPayrollWarning] = useState<string | null>(null);
  const [noteForm] = Form.useForm<{ note: string }>();
  const [reasonForm] = Form.useForm<{ reason: string }>();

  const { data: periods = [], isLoading, isFetching: periodsFetching, error, refetch } = useQuery({ queryKey: ["attendance", "finalisation", "periods"], queryFn: () => attendanceApi.listPeriods() });
  const chosen: PeriodRow | undefined = periods.find((p) => p.from === picked) ?? periods.find((p) => p.isOver && p.status !== "FINALISED") ?? periods[0];
  const {
    data: readiness,
    isFetching,
    error: readinessError,
    refetch: refetchReadiness,
  } = useQuery({
    queryKey: ["attendance", "finalisation", "readiness", chosen?.from, chosen?.to],
    queryFn: () => attendanceApi.finalisationReadiness(chosen!.from, chosen!.to),
    enabled: !!chosen && chosen.status !== "FINALISED",
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["attendance"] });
  const finalise = useMutation({
    mutationFn: (note: string) => attendanceApi.finalisePeriod({ from: chosen!.from, to: chosen!.to, note }),
    onSuccess: (r) => {
      toast.success(`${chosen!.label} is finalised: ${r.locked} days locked.`);
      setPicked(chosen!.from); // stay on it: the view now offers Unlock
      setFinalising(false);
      noteForm.resetFields();
      refresh();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not finalise this period."));
      setFinalising(false);
      refresh(); // the blockers may have changed
    },
  });
  const unlock = useMutation({
    mutationFn: (reason: string) => attendanceApi.unlockPeriod({ from: chosen!.from, to: chosen!.to, reason, confirmPayrollConsumed: payrollWarning !== null }),
    onSuccess: (r) => {
      toast.success(`${chosen!.label} is unlocked: ${r.unlocked} days are open to changes. Finalise it again before payroll reads it.`);
      setPicked(chosen!.from);
      setUnlocking(false);
      setPayrollWarning(null);
      reasonForm.resetFields();
      refresh();
    },
    onError: (err) => {
      if (apiErrorCode(err) === "PAYROLL_CONSUMED") return setPayrollWarning(apiErrorMessage(err, "Payroll has used this period."));
      toast.error(apiErrorMessage(err, "Could not unlock this period."));
    },
  });

  // On a phone the period's detail sits below the whole list: bring it into view when one is picked.
  const openPeriod = (from: string, scroll = phone) => {
    setPicked(from);
    if (scroll) requestAnimationFrame(() => document.getElementById("finalisation-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };
  const waiting = periods.filter((p) => p.unprocessed && p.unprocessed.employees > 0);

  const detailActions = chosen && (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
      {chosen.status === "FINALISED" && canUnlock && (
        <Button icon={<UnlockOutlined />} danger onClick={() => setUnlocking(true)} block={phone}>
          Unlock…
        </Button>
      )}
      {chosen.status !== "FINALISED" && (
        <Tooltip title={readiness && !readiness.ready ? "Resolve everything that blocks it first" : undefined}>
          <Button type="primary" icon={<LockOutlined />} disabled={!readiness?.ready} loading={isFetching} onClick={() => setFinalising(true)} block={phone}>
            Finalise this period…
          </Button>
        </Tooltip>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        title="Attendance Period Finalisation"
        subtitle="Lock a whole attendance cycle so what payroll reads cannot change underneath it"
        actions={
          <Tooltip title="Check again">
            <Button icon={<ReloadOutlined />} aria-label="Check again" loading={periodsFetching && !isLoading} onClick={refresh} />
          </Tooltip>
        }
      />
      <Stack>
        <ApprovalBanner
          tone="info"
          title="Finalising is refused while anything still blocks the period"
          description="Unlocking is for a Super Admin only, with a reason, and every lock and unlock is on record."
        />
        {waiting.map((p) => (
          <ApprovalBanner
            key={p.from}
            tone="warning"
            title={`${p.unprocessed!.employees} employee${plural(p.unprocessed!.employees, " has", "s have")} unprocessed days in the locked cycle ${p.label}`}
            description="They were employed in the cycle but have days in it that are not locked, for example a joiner dated inside it. Nothing is written inside a finalised cycle, so those days wait. Open the period to see who."
            actions={<Button onClick={() => openPeriod(p.from, true)}>Open {p.label}</Button>}
          />
        ))}

        <div style={{ display: "grid", gridTemplateColumns: phone ? "minmax(0, 1fr)" : "repeat(auto-fit, minmax(min(100%, 420px), 1fr))", gap: phone ? space[4] : space[6], alignItems: "start" }}>
          <Panel title="Periods" subtitle="Newest first. Pick one to see what blocks it.">
              <DataTable<PeriodRow>
                rowKey="from"
                density="compact"
                loading={isLoading}
                error={error}
                onRetry={() => void refetch()}
                dataSource={periods}
                pagination={false}
                onRowOpen={(r) => openPeriod(r.from)}
                rowClassName={(r) => (r.from === chosen?.from ? "ant-table-row-selected" : "")}
                empty={<EmptyState compact illustration="calendar" title="No attendance periods yet" description="Periods appear here once the attendance cycle is set up in Attendance Settings." />}
                mobile={{
                  title: (r) => (
                    <span style={{ color: r.from === chosen?.from ? v.accentText : undefined }}>
                      {r.label}
                      {r.from === chosen?.from ? " · selected" : ""}
                    </span>
                  ),
                  subtitle: (r) => lastActionText(r) ?? "No action yet",
                  status: (r) => <PeriodStatusChips r={r} />,
                  fields: [{ label: "Locked days", render: (r) => <span className="ws-num">{r.lockedDays}</span> }],
                }}
                columns={[
                  {
                    title: "Period",
                    dataIndex: "label",
                    render: (l: string, r) => (
                      <span aria-current={r.from === chosen?.from ? "true" : undefined} style={{ fontWeight: r.from === chosen?.from ? fw.semibold : fw.regular, color: v.textPrimary }}>
                        {l}
                      </span>
                    ),
                  },
                  { title: "Status", dataIndex: "status", render: (_: PeriodStatus, r) => <PeriodStatusChips r={r} /> },
                  { title: "Locked days", dataIndex: "lockedDays", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
                  {
                    title: "Last action",
                    key: "last",
                    render: (_, r) =>
                      r.last ? (
                        <Tooltip title={r.last.reason || undefined}>
                          <span style={{ fontSize: fs.sm, color: v.textSecondary }}>{lastActionText(r)}</span>
                        </Tooltip>
                      ) : (
                        <span style={{ color: v.textSecondary }}>—</span>
                      ),
                  },
                ]}
              />
          </Panel>

          {chosen && (
            <Panel id="finalisation-detail" title={chosen.label} subtitle={`${formatDate(chosen.from)} – ${formatDate(chosen.to)}`} extra={phone ? undefined : detailActions}>
              <div aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                {phone && detailActions}
                {chosen.status === "FINALISED" ? (
                  <>
                    <ApprovalBanner
                      tone="success"
                      icon={<LockOutlined />}
                      title={`${chosen.label} is finalised.`}
                      description={`${chosen.lockedDays} days are locked: no override, correction, manual entry or reprocessing can change them. ${canUnlock ? "You can unlock it with a reason." : "Only a Super Admin can unlock it."}`}
                    />
                    {chosen.unprocessed && chosen.unprocessed.employees > 0 && (
                      <ApprovalBanner
                        tone="warning"
                        title={`${chosen.unprocessed.employees} employee${plural(chosen.unprocessed.employees, " has", "s have")} unprocessed days in this locked cycle (${chosen.unprocessed.days} day${plural(chosen.unprocessed.days, "", "s")})`}
                        description={
                          <>
                            <div>
                              {chosen.unprocessed.people.map((p) => `${p.name ?? p.employeeCode} (${p.employeeCode}): ${p.days} day${plural(p.days, "", "s")}`).join("; ")}
                              {chosen.unprocessed.employees > chosen.unprocessed.people.length ? `; and ${chosen.unprocessed.employees - chosen.unprocessed.people.length} more` : ""}
                            </div>
                            <div style={{ marginTop: space[1] }}>
                              The engine writes nothing inside a finalised cycle. To bring them in: {canUnlock ? "unlock the cycle" : "ask a Super Admin to unlock the cycle"}, run Process Attendance for it, then finalise it again.
                            </div>
                          </>
                        }
                      />
                    )}
                    {chosen.last && (
                      <KeyValueGrid
                        columns={1}
                        items={[{ label: "Finalised", value: `${chosen.last.by ?? "someone"} on ${formatDateTime(chosen.last.at)}` }, ...(chosen.last.reason ? [{ label: "Note", value: chosen.last.reason }] : [])]}
                      />
                    )}
                  </>
                ) : readinessError && !readiness ? (
                  <EmptyState compact kind="error" title="Could not check this period" onRetry={() => void refetchReadiness()} />
                ) : !readiness ? (
                  <div aria-busy="true" aria-label="Checking what blocks this period" style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
                    <Skel h={48} r={radius.md} />
                    <Skel h={72} r={radius.md} />
                    <Skel h={72} r={radius.md} />
                  </div>
                ) : (
                  <>
                    {chosen.status === "UNLOCKED" && chosen.last && (
                      <ApprovalBanner
                        tone="warning"
                        icon={<UnlockOutlined />}
                        title="This period was unlocked and has not been finalised again."
                        description={`Unlocked by ${chosen.last.by ?? "someone"} on ${formatDate(chosen.last.at)}: ${chosen.last.reason}`}
                      />
                    )}
                    {readiness.ready ? (
                      <ApprovalBanner tone="success" title="Nothing blocks this period." description="Finalising locks every day in it." />
                    ) : (
                      <p style={{ margin: 0, color: v.textBody, fontSize: fs.md }}>
                        This period can't be finalised until {readiness.blockers.length === 1 ? "this is" : "these are"} resolved. The server refuses it outright while any remain.
                      </p>
                    )}
                    <FinalisationBlockers readiness={readiness} />
                    <div>
                      <Button icon={<ReloadOutlined />} onClick={refresh} loading={isFetching}>
                        Check again
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Panel>
          )}
        </div>
      </Stack>

      <ConfirmModal
        open={finalising}
        title={`Finalise ${chosen?.label ?? ""}`}
        description={chosen ? `Every day from ${formatDate(chosen.from)} to ${formatDate(chosen.to)} is locked against changes. Only a Super Admin can unlock it, and that is recorded.` : undefined}
        confirmLabel="Finalise and lock"
        loading={finalise.isPending}
        onCancel={() => !finalise.isPending && setFinalising(false)}
        onConfirm={() => noteForm.validateFields().then((val) => finalise.mutate((val.note ?? "").trim()), () => undefined)}
      >
        <Form form={noteForm} layout="vertical" requiredMark={false}>
          <Form.Item name="note" label="Note (optional)" style={{ marginBottom: 0 }}>
            <Input.TextArea rows={2} maxLength={500} placeholder="For the record, for example: signed off by payroll" />
          </Form.Item>
        </Form>
      </ConfirmModal>

      <ConfirmModal
        open={unlocking}
        title={`Unlock ${chosen?.label ?? ""}`}
        description="The days become open to changes again. The cycle has to be finalised again before payroll reads it."
        confirmLabel={payrollWarning ? "Unlock anyway" : "Unlock"}
        danger
        loading={unlock.isPending}
        onCancel={() => {
          if (unlock.isPending) return;
          setUnlocking(false);
          setPayrollWarning(null);
        }}
        onConfirm={() => reasonForm.validateFields().then((val) => unlock.mutate(val.reason.trim()), () => undefined)}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          {payrollWarning && <ApprovalBanner tone="danger" title="Payroll has used this period" description={`${payrollWarning} Press Unlock anyway only if you understand that.`} />}
          <Form form={reasonForm} layout="vertical" requiredMark={false}>
            <Form.Item name="reason" label="Why is it being unlocked?" rules={[{ required: true, min: 5, message: "Say why (a few words)" }]} style={{ marginBottom: 0 }}>
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
          </Form>
        </div>
      </ConfirmModal>
    </>
  );
}
