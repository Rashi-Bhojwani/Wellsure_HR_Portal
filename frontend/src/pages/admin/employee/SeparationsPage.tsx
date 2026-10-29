import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select } from "antd";
import { StopOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as employeeApi from "../../../api/employee";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, StatusChip, toast, useIsPhone } from "../../../ui";

type Row = employeeApi.SeparationSummary;

const STATUS_TONE = { INITIATED: "warning", COMPLETED: "neutral", CANCELLED: "danger" } as const;
const STATUS_LABEL: Record<Row["status"], string> = { INITIATED: "Initiated", COMPLETED: "Completed", CANCELLED: "Cancelled" };
const fmtDate = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });

export function SeparationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<Row["status"] | undefined>();
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const { data: separations, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ["employees", "separations"], queryFn: employeeApi.listSeparations });

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (separations ?? []).filter(
      (r) => (!status || r.status === status) && (!q || r.employeeName.toLowerCase().includes(q) || r.employeeCode.toLowerCase().includes(q) || r.reason.toLowerCase().includes(q)),
    );
  }, [separations, search, status]);

  const cancelMutation = useMutation({
    mutationFn: (id: string) => employeeApi.cancelSeparation(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["employees", "separations"] });
      toast.success("Separation cancelled.");
      setCancelling(null);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not cancel separation.")),
  });

  const chip = (s: Row["status"]) => <StatusChip tone={STATUS_TONE[s] ?? "neutral"}>{STATUS_LABEL[s] ?? s}</StatusChip>;
  const rowActions = (r: Row) =>
    r.status === "INITIATED" ? (
      <Button danger icon={<StopOutlined />} block={phone} onClick={(e) => { e.stopPropagation(); setCancelling(r); }}>
        Cancel
      </Button>
    ) : null;

  const filtered = Boolean(search || status);

  return (
    <>
      <PageHeader title="Separations" subtitle="Employees leaving the company — start a separation from the employee's profile" />

      <Panel title="Separations" subtitle={separations ? `${rows.length} on record` : undefined}>
        <FilterBar
          onSearch={setSearch}
          searchValue={search}
          searchPlaceholder="Search employee or reason"
          activeCount={status ? 1 : 0}
          onClear={() => setStatus(undefined)}
          filters={
            <Select
              allowClear
              placeholder="All statuses"
              aria-label="Filter by status"
              style={{ width: phone ? "100%" : 200 }}
              value={status}
              onChange={(val) => setStatus(val)}
              options={(Object.keys(STATUS_LABEL) as Row["status"][]).map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
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
          onRowOpen={(r) => navigate(`/admin/employee/profile/${r.employeeId}`)}
          empty={
            <EmptyState
              compact
              kind={filtered ? "no-results" : "empty"}
              illustration="people"
              title={filtered ? "No separations match" : "No separations on record."}
              description={filtered ? "Try another status or clear the search." : "Separations are started from an employee's profile."}
            />
          }
          mobile={{
            avatar: (r) => <InitialsAvatar name={r.employeeName} size={40} />,
            title: (r) => r.employeeName,
            subtitle: (r) => r.employeeCode,
            status: (r) => chip(r.status),
            fields: [
              { label: "Last working date", render: (r) => fmtDate(r.lastWorkingDate) },
              { label: "Reason", render: (r) => r.reason },
              { label: "Initiated", render: (r) => fmtDate(r.initiatedAt) },
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
            { title: "Last Working Date", dataIndex: "lastWorkingDate", render: (d: string) => <span className="ws-num">{fmtDate(d)}</span> },
            { title: "Reason", dataIndex: "reason" },
            { title: "Status", dataIndex: "status", render: chip },
            { title: "Initiated", dataIndex: "initiatedAt", render: (d: string) => <span className="ws-num">{fmtDate(d)}</span> },
            { title: "Actions", key: "actions", align: "right", render: (_, r) => rowActions(r) },
          ]}
        />
      </Panel>

      <ConfirmModal
        open={cancelling !== null}
        onCancel={() => !cancelMutation.isPending && setCancelling(null)}
        onConfirm={() => cancelling && cancelMutation.mutate(cancelling.id)}
        title="Cancel this separation?"
        description={cancelling ? `${cancelling.employeeName} (${cancelling.employeeCode}) — the separation is withdrawn. Last working date was ${fmtDate(cancelling.lastWorkingDate)}.` : undefined}
        confirmLabel="Cancel separation"
        cancelLabel="Keep it"
        danger
        loading={cancelMutation.isPending}
      />
    </>
  );
}
