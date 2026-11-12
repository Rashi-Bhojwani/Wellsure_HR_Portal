import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { CheckOutlined, CloseOutlined, RollbackOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, InitialsAvatar, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

// M task 1 (docs/plans/M_CHECKLIST.md): bank and statutory changes HR entered, waiting for a director other than the person who entered them. Masked
// throughout: the API never sends a whole number here, and nothing on this screen asks for one.

type Row = employeeApi.IdentityChange;
const KIND_LABEL: Record<Row["kind"], string> = { BANK: "Bank account", STATUTORY: "Statutory numbers" };
const SOURCE_LABEL: Record<Row["source"], string> = { HR_EDIT: "Entered by HR", ADD_EMPLOYEE: "Add Employee", EMPLOYEE_REQUEST: "Employee's own request", DIRECTOR_EDIT: "Entered by a director" };
const STATUS_OPTIONS: Array<{ value: employeeApi.IdentityChangeStatus; label: string }> = [
  { value: "PENDING", label: "Waiting" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "REJECTED", label: "Rejected" },
  { value: "WITHDRAWN", label: "Withdrawn" },
];
const fmt = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** "Account ending 1234, Test Bank (TEST0000123)" or "PAN ending 999Z, UAN ending 1111". */
function maskedText(r: Pick<Row, "kind" | "masked">): string {
  const m = r.masked;
  if (r.kind === "BANK") return `Account ending ${m.accountNumberLast4 ?? "—"}, ${m.bankName ?? ""}${m.ifsc ? ` (${m.ifsc})` : ""}`;
  const parts = [
    m.panLast4 !== undefined && `PAN ending ${m.panLast4}`,
    m.aadhaarLast4 !== undefined && `Aadhaar ending ${m.aadhaarLast4}`,
    m.uanLast4 !== undefined && `UAN ending ${m.uanLast4}`,
    m.esiLast4 !== undefined && (m.esiLast4 === "(cleared)" ? "ESI number cleared" : `ESI ending ${m.esiLast4}`),
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "—";
}

function useDecisions() {
  const queryClient = useQueryClient();
  const done = (msg: string) => {
    void queryClient.invalidateQueries({ queryKey: ["employees", "identity-changes"] });
    void queryClient.invalidateQueries({ queryKey: ["employees", "profile"] });
    toast.success(msg);
  };
  const confirm = useMutation({ mutationFn: employeeApi.confirmIdentityChange, onSuccess: () => done("Confirmed. The change is now in force."), onError: (e) => toast.error(errorMessage(e, "Could not confirm it.")) });
  const reject = useMutation({ mutationFn: (a: { id: string; reason: string }) => employeeApi.rejectIdentityChange(a.id, a.reason), onSuccess: () => done("Rejected. The person who entered it is told."), onError: (e) => toast.error(errorMessage(e, "Could not reject it.")) });
  const withdraw = useMutation({ mutationFn: employeeApi.withdrawIdentityChange, onSuccess: () => done("Withdrawn."), onError: (e) => toast.error(errorMessage(e, "Could not withdraw it.")) });
  return { confirm, reject, withdraw };
}

/** The panel on Employee → Change Requests: every held change the viewer may see, with Confirm / Reject for a director and Withdraw for the person who entered it. */
export function IdentityChangesPanel() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const [status, setStatus] = useState<employeeApi.IdentityChangeStatus>("PENDING");
  const [deciding, setDeciding] = useState<{ row: Row; action: "confirm" | "reject" | "withdraw" } | null>(null);
  const [reason, setReason] = useState("");
  const q = useQuery({ queryKey: ["employees", "identity-changes", status], queryFn: () => employeeApi.listIdentityChanges({ status }) });
  const { confirm, reject, withdraw } = useDecisions();
  const busy = confirm.isPending || reject.isPending || withdraw.isPending;
  const close = () => {
    if (busy) return;
    setDeciding(null);
    setReason("");
  };
  const act = () => {
    if (!deciding) return;
    const after = { onSuccess: () => { setDeciding(null); setReason(""); } };
    if (deciding.action === "confirm") confirm.mutate(deciding.row.id, after);
    else if (deciding.action === "reject") reject.mutate({ id: deciding.row.id, reason }, after);
    else withdraw.mutate(deciding.row.id, after);
  };

  const actions = (r: Row) =>
    r.status === "PENDING" && (r.canDecide || r.canWithdraw) ? (
      <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end", width: phone ? "100%" : undefined }} onClick={(e) => e.stopPropagation()}>
        {r.canDecide && (
          <>
            <Button danger icon={<CloseOutlined />} onClick={() => setDeciding({ row: r, action: "reject" })} block={phone}>Reject</Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={() => setDeciding({ row: r, action: "confirm" })} block={phone}>Confirm</Button>
          </>
        )}
        {r.canWithdraw && <Button icon={<RollbackOutlined />} onClick={() => setDeciding({ row: r, action: "withdraw" })} block={phone}>Withdraw</Button>}
      </div>
    ) : null;

  return (
    <Panel title="Bank and statutory changes waiting for a director" subtitle="Entered by HR (or by a director on their own record). A director other than the person who entered it confirms it before it takes effect. Shown masked.">
      <div style={{ marginBottom: space[3] }}>
        <Select aria-label="Filter by status" style={{ width: phone ? "100%" : 200 }} value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </div>
      <DataTable<Row>
        rowKey="id"
        loading={q.isLoading || q.isFetching}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        pagination={{ pageSize: 10 }}
        onRowOpen={(r) => navigate(`/admin/employee/profile/${r.employeeId}`)}
        empty={<EmptyState compact kind="empty" illustration="inbox" title={status === "PENDING" ? "Nothing is waiting for a director" : "None in this list"} description="A bank or statutory change entered by HR appears here until a director decides it." />}
        mobile={{
          avatar: (r) => <InitialsAvatar name={r.employeeName} size={40} />,
          title: (r) => r.employeeName,
          subtitle: (r) => `${r.employeeCode} · ${KIND_LABEL[r.kind]}`,
          status: (r) => <StatusChip status={r.status} />,
          fields: [
            { label: "Change", render: (r) => maskedText(r) },
            { label: "Entered", render: (r) => `${r.enteredBy}, ${fmt(r.createdAt)}` },
            { label: "Reason", render: (r) => r.reason ?? "—" },
          ],
          actions,
        }}
        columns={[
          {
            title: "Employee",
            key: "employee",
            render: (_, r) => (
              <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
                <InitialsAvatar name={r.employeeName} size={36} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.employeeName}</div>
                  <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{r.employeeCode}</div>
                </div>
              </div>
            ),
          },
          {
            title: "Change",
            key: "change",
            render: (_, r) => (
              <div style={{ minWidth: 0 }}>
                <div><StatusChip tone="neutral">{KIND_LABEL[r.kind]}</StatusChip> {maskedText(r)}</div>
                <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{SOURCE_LABEL[r.source]}: {r.enteredBy}, {fmt(r.createdAt)}</div>
              </div>
            ),
          },
          { title: "Status", dataIndex: "status", render: (s: string, r) => <span><StatusChip status={s} />{r.decidedBy && <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{r.decidedBy}{r.reason ? `: ${r.reason}` : ""}</span>}</span> },
          { title: "Actions", key: "actions", align: "right", render: (_, r) => actions(r) },
        ]}
      />
      <ConfirmModal
        open={deciding !== null}
        onCancel={close}
        onConfirm={act}
        loading={busy}
        danger={deciding?.action === "reject"}
        confirmDisabled={deciding?.action === "reject" && reason.trim().length < 3}
        title={deciding?.action === "confirm" ? "Confirm this change" : deciding?.action === "reject" ? "Reject this change" : "Withdraw this change"}
        confirmLabel={deciding?.action === "confirm" ? "Confirm" : deciding?.action === "reject" ? "Reject" : "Withdraw"}
        description={
          deciding
            ? `${deciding.row.employeeName} (${deciding.row.employeeCode}): ${maskedText(deciding.row)}.` +
              (deciding.action === "confirm"
                ? deciding.row.kind === "BANK"
                  ? ` It takes effect from ${deciding.row.effectiveFrom}. Check it against the person's own document before confirming.`
                  : " It takes effect now. Check it against the person's own document before confirming."
                : deciding.action === "reject"
                  ? " Nothing changes on the record. The person who entered it is told."
                  : " Nothing changes on the record.")
            : undefined
        }
      >
        {deciding?.action === "reject" && (
          <>
            <label htmlFor="identity-reject-reason" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>Reason (required)</label>
            <Input.TextArea id="identity-reject-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
          </>
        )}
      </ConfirmModal>
    </Panel>
  );
}

/** On a profile's Bank or Statutory tab: what is waiting for a director for this person, masked. Renders nothing when nothing waits. */
export function PendingIdentityNotice({ employeeId, kind }: { employeeId: string; kind: Row["kind"] }) {
  const q = useQuery({ queryKey: ["employees", "identity-changes", "PENDING", employeeId], queryFn: () => employeeApi.listIdentityChanges({ status: "PENDING", employeeId }) });
  const navigate = useNavigate();
  const row = (q.data ?? []).find((r) => r.kind === kind);
  if (!row) return null;
  return (
    <ApprovalBanner
      tone="warning"
      title={`A change waits for a director: ${maskedText(row)}`}
      description={`${SOURCE_LABEL[row.source]} by ${row.enteredBy}, ${fmt(row.createdAt)}. The details below stay in force until a director other than the person who entered it confirms the change.`}
      actions={<Button onClick={() => navigate("/admin/employee/change-requests")}>Open Change Requests</Button>}
      style={{ marginBottom: space[3] }}
    />
  );
}
