import { useQuery } from "@tanstack/react-query";
import * as leaveApi from "../../api/leave";
import { fs, fw, space, v } from "../../theme/tokens";
import { DataTable, EmptyState, StatusChip } from "../../ui";

function Days({ value }: { value: number }) {
  return (
    <span className="ws-num" style={{ fontWeight: fw.semibold, color: value < 0 ? v.danger : v.accentText }}>
      {value > 0 ? `+${value}` : value}
    </span>
  );
}

function What({ r }: { r: leaveApi.LedgerLine }) {
  return (
    <div style={{ minWidth: 0 }}>
      <span>{r.description}</span>
      {r.releasedDate && (
        <span style={{ marginInlineStart: space[2] }}>
          <StatusChip tone="success">Worked on {r.releasedDate}</StatusChip>
        </span>
      )}
      {r.remarks && <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 2 }}>{r.remarks}</div>}
    </div>
  );
}

/**
 * The leave ledger as a person reads it (Phase 3 commit 2): every credit and debit, newest first. When HR released
 * leave on a day the person worked, the days that came back are here with the date and the reason, next to the day
 * the leave was taken.
 */
export function LeaveLedgerTable({ employeeId }: { employeeId?: string }) {
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["leave", "balances", "ledger", employeeId ?? "me"], queryFn: () => leaveApi.getLeaveLedger({ employeeId }) });
  return (
    <DataTable<leaveApi.LedgerLine>
      rowKey="id"
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      dataSource={data}
      pagination={{ pageSize: 15, showSizeChanger: false }}
      empty={<EmptyState compact illustration="documents" title="No entries yet." description="Leave credits and debits will be listed here." />}
      mobile={{
        title: (r) => r.description,
        subtitle: (r) => `${r.date} · ${r.leaveTypeCode}`,
        status: (r) => <Days value={r.days} />,
        fields: [
          { label: "Worked on", render: (r) => r.releasedDate ?? "—" },
          { label: "Remarks", render: (r) => r.remarks ?? "—" },
        ],
      }}
      columns={[
        { title: "Date", dataIndex: "date", width: 120 },
        { title: "Leave", dataIndex: "leaveTypeCode", width: 90 },
        { title: "What", key: "what", render: (_, r) => <What r={r} /> },
        { title: "Days", dataIndex: "days", align: "right", width: 90, render: (value: number) => <Days value={value} /> },
      ]}
    />
  );
}
