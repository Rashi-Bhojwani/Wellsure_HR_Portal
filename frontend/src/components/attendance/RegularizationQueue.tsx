import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented, Select } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import * as infoApi from "../../api/attendanceInfo";
import type { QueueRow, ReasonCode, RegularizationStatus } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { fs, fw, space, v } from "../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, FilterBar, InitialsAvatar, StatusChip, toast, useIsPhone } from "../../ui";

const STATUS_LABEL: Record<string, string> = { PENDING: "Pending", APPROVED: "Approved", REJECTED: "Rejected", CANCELLED: "Cancelled" };

const punchesText = (r: QueueRow) =>
  (r.punches ? (r.punches.count === 0 ? "no punches" : `${r.punches.firstIn ?? "—"}${r.punches.lastOut ? `–${r.punches.lastOut}` : ""} (${r.punches.count} punch${r.punches.count === 1 ? "" : "es"})`) : "no record") +
  (r.shift ? ` · ${r.shift}` : "");

/**
 * Attendance corrections to decide (Phase 2 P2-E began it; Phase 3 commit 1 generalised it): a manager's
 * team (by grant) or, for HR, everyone. Approving applies the correction to the day and works it out
 * again (the device's punches never change); the employee is notified either way. `batchId` narrows it
 * to one bulk correction. Rendered inside the caller's Panel. Decisions are audited: both go through a
 * ConfirmModal that stays open until the server answers — never optimistic.
 */
export function RegularizationQueue({ emptyText = "No correction requests waiting", batchId }: { emptyText?: string; batchId?: string }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [status, setStatus] = useState<RegularizationStatus | "ALL">("PENDING");
  const [search, setSearch] = useState("");
  const [approving, setApproving] = useState<QueueRow | null>(null);
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [note, setNote] = useState("");
  const [reasonCode, setReasonCode] = useState<ReasonCode | undefined>();
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["attendance", "regularizations", status, reasonCode, batchId],
    queryFn: () => infoApi.regularizationQueue({ status: status === "ALL" ? undefined : status, reasonCode, batchId }),
    placeholderData: keepPreviousData,
  });
  // The search narrows the loaded list in the browser (name or employee code); status and reason are the server's filters.
  const rows = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    return q ? all.filter((r) => r.name.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q)) : all;
  }, [data, search]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const approve = useMutation({
    mutationFn: (r: QueueRow) => infoApi.approveRegularization(r.id),
    onSuccess: () => {
      toast.success("Approved. The day has been worked out again with the correction.");
      setApproving(null);
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not approve.")),
  });
  const reject = useMutation({
    mutationFn: () => infoApi.rejectRegularization(rejecting!.id, note),
    onSuccess: () => {
      toast.success("Rejected. The employee has been told why.");
      setRejecting(null);
      setNote("");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not reject.")),
  });

  const btnSize = phone ? "middle" : "small";
  const decision = (r: QueueRow) =>
    r.canDecide ? (
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "flex-start" : "flex-end" }}>
        <Button size={btnSize} type="primary" icon={<CheckOutlined />} onClick={() => setApproving(r)}>
          Approve
        </Button>
        <Button size={btnSize} danger icon={<CloseOutlined />} onClick={() => setRejecting(r)}>
          Reject
        </Button>
      </div>
    ) : (
      <div style={{ display: "flex", flexDirection: "column", gap: space[1], alignItems: phone ? "flex-start" : "flex-end" }}>
        <StatusChip status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</StatusChip>
        {r.decidedBy && (
          <span style={{ fontSize: fs.sm, color: v.textSecondary }}>
            by {r.decidedBy}
            {r.decisionNote ? `: "${r.decisionNote}"` : ""}
          </span>
        )}
      </div>
    );

  const secondary = (text: string) => <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{text}</div>;
  const filtered = !!search || !!reasonCode || status !== "PENDING";

  return (
    <>
      <FilterBar
        onSearch={setSearch}
        searchValue={search}
        searchPlaceholder="Search employee"
        activeCount={reasonCode ? 1 : 0}
        onClear={() => setReasonCode(undefined)}
        filters={
          <Select allowClear placeholder="Any reason" aria-label="Filter by reason" style={{ width: phone ? "100%" : 200 }} value={reasonCode} onChange={setReasonCode} options={infoApi.REASON_OPTIONS} />
        }
        actions={
          <Segmented
            aria-label="Request status"
            value={status}
            onChange={(val) => setStatus(val as RegularizationStatus | "ALL")}
            block={phone}
            options={[
              { value: "PENDING", label: "Waiting" },
              { value: "APPROVED", label: "Approved" },
              { value: "REJECTED", label: "Rejected" },
              { value: "ALL", label: "All" },
            ]}
          />
        }
      />
      <DataTable<QueueRow>
        rowKey="id"
        loading={isLoading || isFetching}
        error={error}
        onRetry={() => void refetch()}
        dataSource={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        empty={
          <EmptyState
            compact
            kind={filtered ? "no-results" : "empty"}
            illustration="inbox"
            title={filtered ? "No requests match these filters" : emptyText}
            description={filtered ? "Try another status or reason, or clear the search." : "New correction requests appear here as soon as they are raised."}
          />
        }
        mobile={{
          avatar: (r) => <InitialsAvatar name={r.name} size={40} />,
          title: (r) => r.name,
          subtitle: (r) => `${r.employeeCode} · ${dayjs(r.date).format("ddd, D MMM")}`,
          status: (r) => (r.canDecide ? <StatusChip status={r.status}>{STATUS_LABEL[r.status] ?? r.status}</StatusChip> : null),
          fields: [
            { label: "Asks for", render: (r) => <strong>{r.correctionText}</strong> },
            { label: "Reason", render: (r) => `${r.reasonLabel}${r.batchId ? " (bulk)" : ""}` },
            { label: "The day now", render: (r) => `${r.dayStatus ?? "—"} · ${punchesText(r)}` },
            { label: "Raised", render: (r) => dayjs(r.createdAt).format("D MMM, HH:mm") },
            { label: "Note", render: (r) => (r.reason ? `"${r.reason}"` : "—") },
          ],
          actions: decision,
        }}
        columns={[
          {
            title: "Employee",
            key: "who",
            render: (_, r) => (
              <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
                <InitialsAvatar name={r.name} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.name}</div>
                  {secondary(r.employeeCode)}
                </div>
              </div>
            ),
          },
          { title: "Day", dataIndex: "date", render: (d: string) => <span className="ws-num">{dayjs(d).format("ddd, D MMM")}</span> },
          {
            title: "Reason",
            key: "why",
            render: (_, r) => (
              <div style={{ display: "flex", flexDirection: "column", gap: space[1], alignItems: "flex-start" }}>
                <span>{r.reasonLabel}</span>
                {r.batchId && <StatusChip tone="neutral">bulk</StatusChip>}
              </div>
            ),
          },
          {
            title: "The day now",
            key: "now",
            render: (_, r) => (
              <>
                <div>{r.dayStatus ?? "—"}</div>
                {secondary(punchesText(r))}
              </>
            ),
          },
          { title: "Asks for", key: "asks", render: (_, r) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.correctionText}</span> },
          {
            title: "Note",
            dataIndex: "reason",
            render: (val: string) => (val ? <span style={{ maxWidth: 240, display: "inline-block" }}>"{val}"</span> : <span style={{ color: v.textSecondary }}>—</span>),
          },
          { title: "Raised", dataIndex: "createdAt", render: (val: string) => <span className="ws-num">{dayjs(val).format("D MMM, HH:mm")}</span> },
          { title: status === "PENDING" ? "Decide" : "Status", key: "actions", align: "right", render: (_, r) => decision(r) },
        ]}
      />

      <ConfirmModal
        open={!!approving}
        onCancel={() => !approve.isPending && setApproving(null)}
        onConfirm={() => approving && approve.mutate(approving)}
        title={approving ? `Apply "${approving.correctionText}" to ${dayjs(approving.date).format("D MMM")}?` : "Approve this request?"}
        description="The day is worked out again with this correction; the punches never change."
        info={approving ? `${approving.name} (${approving.employeeCode}) · ${approving.reasonLabel}` : undefined}
        confirmLabel="Approve"
        loading={approve.isPending}
      />

      <ConfirmModal
        open={!!rejecting}
        onCancel={() => !reject.isPending && setRejecting(null)}
        onConfirm={() => reject.mutate()}
        title="Reject this request?"
        description={`Say why, so ${rejecting?.name ?? "they"} knows what to do next. The day stays as it is.`}
        confirmLabel="Reject"
        danger
        loading={reject.isPending}
        confirmDisabled={note.trim().length < 3}
      >
        <label htmlFor="regularization-reject-note" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>
          Reason for rejecting
        </label>
        <Input.TextArea
          id="regularization-reject-note"
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. The security register shows you left at 15:00"
          maxLength={500}
          showCount
          status={note.length > 0 && note.trim().length < 3 ? "warning" : undefined}
        />
      </ConfirmModal>
    </>
  );
}
