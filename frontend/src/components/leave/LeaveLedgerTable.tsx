import { useQuery } from "@tanstack/react-query";
import { Table, Tag, Typography } from "antd";
import * as leaveApi from "../../api/leave";
import { EmptyState } from "../common/EmptyState";

const { Text } = Typography;

/**
 * The leave ledger as a person reads it (Phase 3 commit 2): every credit and debit, newest first. When HR released
 * leave on a day the person worked, the days that came back are here with the date and the reason, next to the day
 * the leave was taken.
 */
export function LeaveLedgerTable({ employeeId }: { employeeId?: string }) {
  const { data = [], isLoading } = useQuery({ queryKey: ["leave", "balances", "ledger", employeeId ?? "me"], queryFn: () => leaveApi.getLeaveLedger({ employeeId }) });
  return (
    <Table<leaveApi.LedgerLine>
      size="small"
      rowKey="id"
      loading={isLoading}
      dataSource={data}
      pagination={{ pageSize: 15, size: "small", showSizeChanger: false }}
      locale={{ emptyText: <EmptyState message="No entries yet." compact /> }}
      columns={[
        { title: "Date", dataIndex: "date", width: 110 },
        { title: "Leave", dataIndex: "leaveTypeCode", width: 70 },
        {
          title: "What",
          key: "what",
          render: (_, r) => (
            <>
              {r.description}
              {r.releasedDate && (
                <Tag color="green" style={{ marginInlineStart: 8 }}>
                  Worked on {r.releasedDate}
                </Tag>
              )}
              {r.remarks && (
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {r.remarks}
                  </Text>
                </div>
              )}
            </>
          ),
        },
        { title: "Days", dataIndex: "days", align: "right", width: 80, render: (v: number) => <Text type={v < 0 ? "danger" : "success"}>{v > 0 ? `+${v}` : v}</Text> },
      ]}
    />
  );
}
