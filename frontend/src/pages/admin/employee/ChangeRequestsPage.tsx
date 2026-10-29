import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

type Row = employeeApi.ChangeRequestSummary;

const FIELD_GROUP_LABEL: Record<Row["fieldGroup"], string> = { bank: "Bank details", statutory: "Statutory IDs", personal: "Personal details" };
const ALL = "ALL";
const STATUS_OPTIONS = [
  { value: "PENDING", label: "Pending" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: ALL, label: "All" },
];

const fmtDateTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function ChangeRequestsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [statusFilter, setStatusFilter] = useState<string | undefined>("PENDING");
  const [search, setSearch] = useState("");
  const [decision, setDecision] = useState<{ row: Row; action: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");

  const { data: requests, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["employees", "change-requests", statusFilter],
    queryFn: () => employeeApi.listChangeRequests(statusFilter),
    placeholderData: keepPreviousData,
  });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = requests ?? [];
    if (!q) return all;
    return all.filter((r) => r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q));
  }, [requests, search]);

  // Audited, maker-checker decision: never optimistic. The modal stays open until the server answers.
  const decideMutation = useMutation({
    mutationFn: () =>
      decision!.action === "approve" ? employeeApi.approveChangeRequest(decision!.row.id, remarks) : employeeApi.rejectChangeRequest(decision!.row.id, remarks),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "change-requests"] });
      toast.success(decision?.action === "approve" ? "Change approved and applied." : "Change rejected.");
      setDecision(null);
      setRemarks("");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not record decision.")),
  });

  const closeDecision = () => {
    if (decideMutation.isPending) return;
    setDecision(null);
    setRemarks("");
  };

  const openProfile = (r: Row) => navigate(`/admin/employee/profile/${r.employeeId}`);

  const rowActions = (r: Row) =>
    r.status === "PENDING" ? (
      <div style={{ display: "flex", gap: space[2], justifyContent: phone ? "stretch" : "flex-end", width: phone ? "100%" : undefined }} onClick={(e) => e.stopPropagation()}>
        <Button danger icon={<CloseOutlined />} onClick={() => setDecision({ row: r, action: "reject" })} block={phone}>
          Reject
        </Button>
        <Button type="primary" icon={<CheckOutlined />} onClick={() => setDecision({ row: r, action: "approve" })} block={phone}>
          Approve
        </Button>
      </div>
    ) : null;

  const muted = (val: string | null) => val ?? <span style={{ color: v.textSecondary }}>—</span>;
  const filtered = Boolean(search) || statusFilter !== "PENDING";
  const statusLabel = statusFilter ? (STATUS_OPTIONS.find((o) => o.value === statusFilter)?.label.toLowerCase() ?? "") : "";

  return (
    <>
      <PageHeader title="Profile Change Requests" subtitle="Bank, statutory and personal detail changes employees asked for — approving applies the change" />

      <Panel title="Requests" subtitle={requests ? `${rows.length}${statusLabel ? ` ${statusLabel}` : ""} request${rows.length === 1 ? "" : "s"}` : undefined}>
        <FilterBar
          onSearch={setSearch}
          searchValue={search}
          searchPlaceholder="Search employee"
          activeCount={statusFilter !== "PENDING" ? 1 : 0}
          onClear={() => setStatusFilter("PENDING")}
          filters={
            <Select
              aria-label="Filter by status"
              style={{ width: phone ? "100%" : 200 }}
              value={statusFilter ?? ALL}
              onChange={(val: string) => setStatusFilter(val === ALL ? undefined : val)}
              options={STATUS_OPTIONS}
            />
          }
        />
        <DataTable<Row>
          rowKey="id"
          loading={isLoading || isFetching}
          error={error}
          onRetry={() => void refetch()}
          dataSource={rows}
          pagination={{ pageSize: 20 }}
          onRowOpen={openProfile}
          empty={
            <EmptyState
              compact
              kind={filtered ? "no-results" : "empty"}
              illustration="inbox"
              title={filtered ? "No change requests match" : "No pending change requests"}
              description={filtered ? "Try another status or clear the search." : "When an employee asks to change their bank, statutory or personal details, it shows up here."}
            />
          }
          mobile={{
            avatar: (r) => <InitialsAvatar name={r.employeeName} size={40} />,
            title: (r) => r.employeeName,
            subtitle: (r) => `${r.employeeCode} · ${FIELD_GROUP_LABEL[r.fieldGroup] ?? r.fieldGroup}`,
            status: (r) => <StatusChip status={r.status} />,
            fields: [
              { label: "Submitted", render: (r) => fmtDateTime(r.createdAt) },
              { label: "Remarks", render: (r) => muted(r.remarks) },
            ],
            actions: rowActions,
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
            { title: "Field Group", dataIndex: "fieldGroup", render: (g: Row["fieldGroup"]) => <StatusChip tone="neutral">{FIELD_GROUP_LABEL[g] ?? g}</StatusChip> },
            { title: "Status", dataIndex: "status", render: (s: string) => <StatusChip status={s} /> },
            { title: "Submitted", dataIndex: "createdAt", render: (d: string) => <span className="ws-num">{fmtDateTime(d)}</span> },
            { title: "Remarks", dataIndex: "remarks", render: muted },
            { title: "Actions", key: "actions", align: "right", render: (_, r) => rowActions(r) },
          ]}
        />
      </Panel>

      <ConfirmModal
        open={decision !== null}
        onCancel={closeDecision}
        onConfirm={() => decideMutation.mutate()}
        title={decision?.action === "approve" ? "Approve change request" : "Reject change request"}
        description={
          decision
            ? `${decision.row.employeeName} (${decision.row.employeeCode}) · ${FIELD_GROUP_LABEL[decision.row.fieldGroup] ?? decision.row.fieldGroup}.` +
              (decision.action === "approve" ? " Approving applies the change to their profile and is recorded in the audit log." : " The employee's details stay as they are.")
            : undefined
        }
        confirmLabel={decision?.action === "approve" ? "Approve" : "Reject"}
        danger={decision?.action === "reject"}
        loading={decideMutation.isPending}
      >
        <label htmlFor="change-request-remarks" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>
          Remarks (optional)
        </label>
        <Input.TextArea id="change-request-remarks" placeholder="Remarks (optional)" rows={3} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
