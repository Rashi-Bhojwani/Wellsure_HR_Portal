import { useQuery } from "@tanstack/react-query";
import { Table } from "antd";
import * as biometricApi from "../../../api/biometric";
import type { BatchRow, RejectedLine } from "../../../api/biometric";
import { fs, v } from "../../../theme/tokens";
import { DataTable, EmptyState, StatusChip, type ChipTone } from "../../../ui";
import { ROUTE_LABEL, when } from "./deviceLabels";

const Count = ({ n, tone }: { n: number; tone: ChipTone }) => (n ? <StatusChip tone={tone}>{String(n)}</StatusChip> : <>0</>);

export function BatchesTab() {
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["biometric", "batches"], queryFn: () => biometricApi.listBatches() });
  return (
    <DataTable<BatchRow>
      rowKey="id"
      density="compact"
      loading={isLoading}
      error={error}
      onRetry={() => void refetch()}
      dataSource={data}
      pagination={false}
      empty={<EmptyState compact title="Nothing received yet." description="Batches appear here as punches arrive from an agent, ADMS push or a file upload." />}
      expandable={{
        rowExpandable: (b) => b.rejectedLines.length > 0,
        expandedRowRender: (b) => (
          <Table<RejectedLine>
            size="small"
            rowKey="lineNumber"
            pagination={false}
            dataSource={b.rejectedLines}
            scroll={{ x: "max-content" }}
            columns={[
              { title: "Line", dataIndex: "lineNumber" },
              { title: "As received", dataIndex: "raw", render: (val: string) => <code style={{ fontSize: fs.sm, color: v.textPrimary }}>{val}</code> },
              { title: "Why rejected", dataIndex: "reason" },
            ]}
          />
        ),
      }}
      columns={[
        { title: "Received", dataIndex: "receivedAt", render: when },
        { title: "Route", dataIndex: "route", render: (r: string) => ROUTE_LABEL[r] ?? r },
        { title: "Device", key: "device", render: (_, b) => b.device.name },
        { title: "New", dataIndex: "newCount", align: "right" },
        { title: "Duplicate", dataIndex: "duplicateCount", align: "right" },
        { title: "Unmapped", dataIndex: "unmappedCount", align: "right", render: (n: number) => <Count n={n} tone="warning" /> },
        { title: "Flagged", dataIndex: "flaggedCount", align: "right", render: (n: number) => <Count n={n} tone="warning" /> },
        { title: "Rejected", dataIndex: "rejectedCount", align: "right", render: (n: number) => <Count n={n} tone="danger" /> },
        { title: "Upload reason", dataIndex: "reason", render: (val: string | null) => val ?? "" },
      ]}
      mobile={{
        title: (b) => b.device.name,
        subtitle: (b) => `${when(b.receivedAt)} · ${ROUTE_LABEL[b.route] ?? b.route}`,
        fields: [
          { label: "New", render: (b) => b.newCount },
          { label: "Duplicate", render: (b) => b.duplicateCount },
          { label: "Unmapped", render: (b) => <Count n={b.unmappedCount} tone="warning" /> },
          { label: "Flagged", render: (b) => <Count n={b.flaggedCount} tone="warning" /> },
          { label: "Rejected", render: (b) => (b.rejectedLines.length ? `${b.rejectedCount}: ${b.rejectedLines.map((l) => `line ${l.lineNumber} (${l.reason})`).join("; ")}` : <Count n={b.rejectedCount} tone="danger" />) },
          { label: "Upload reason", render: (b) => b.reason ?? "—" },
        ],
      }}
    />
  );
}
