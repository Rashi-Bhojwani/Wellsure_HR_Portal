import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Input, InputNumber, Popconfirm, Space, Table, Tag, Typography, message } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { YearEndRunItemRow, YearEndRunRow, YearEndRunStatus } from "../../../api/leave";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { EmptyState } from "../../../components/common/EmptyState";
import { ProvisionalRateAlert } from "../../../components/leave/ProvisionalRateAlert";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;

const STATUS_COLORS: Record<YearEndRunStatus, string> = { PREVIEW: "gold", SUPERSEDED: "default", COMMITTED: "green" };
const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

// Year End Process (spec §5.4/§5.5) — preview -> discard/re-preview ->
// commit. A run stays PREVIEW until explicitly committed or discarded
// (superseded); generating a new preview for a year that already has one
// automatically supersedes the old one — see modules/leave/yearEnd.ts.
export function YearEndProcessPage() {
  const queryClient = useQueryClient();
  const [leaveYear, setLeaveYear] = useState(new Date().getFullYear());
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [confirmText, setConfirmText] = useState("");

  const { data: runs = [], isLoading } = useQuery({ queryKey: ["leave", "year-end", "runs"], queryFn: () => leaveApi.listYearEndRuns() });
  const { data: detail } = useQuery({
    queryKey: ["leave", "year-end", "run", selectedRunId],
    queryFn: () => leaveApi.getYearEndRun(selectedRunId!),
    enabled: !!selectedRunId,
  });

  const previewMutation = useMutation({
    mutationFn: () => leaveApi.previewYearEnd(leaveYear),
    onSuccess: (run) => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "runs"] });
      setSelectedRunId(run.id);
      void message.success(`Preview generated: ${run.totalEmployees} employee(s), ${money(run.totalEncashedAmount)} total.`);
    },
    onError: (err) => void message.error(errorMessage(err, "Could not generate a preview.")),
  });

  const discardMutation = useMutation({
    mutationFn: (id: string) => leaveApi.discardYearEndRun(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "runs"] });
      void message.success("Preview discarded.");
      setSelectedRunId(null);
    },
    onError: (err) => void message.error(errorMessage(err, "Could not discard this preview.")),
  });

  const commitMutation = useMutation({
    mutationFn: (id: string) => leaveApi.commitYearEndRun(id, confirmText),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "runs"] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "year-end", "run", selectedRunId] });
      void queryClient.invalidateQueries({ queryKey: ["leave", "balances"] });
      void message.success("Year end committed — encashment entries written.");
      setConfirmText("");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not commit this run — balances may have drifted since preview.")),
  });

  async function downloadReport(id: string, run: YearEndRunRow) {
    const blob = await leaveApi.downloadYearEndReport(id);
    saveBlob(blob, `year-end-${run.leaveYear}-${run.status.toLowerCase()}.xlsx`);
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Year End Process
      </Title>
      <HelpStrip storageKey="year-end-process">
        Generate a preview of PL encashment for a leave year, review it, then commit — commit re-checks every balance
        against the ledger and rejects the whole run if anything changed since preview. A new preview for the same
        year supersedes any existing one.
      </HelpStrip>

      <Card size="small">
        <Space wrap align="end">
          <Space orientation="vertical" size={0}>
            <Text type="secondary" style={{ fontSize: fs.sm }}>
              Leave Year
            </Text>
            <InputNumber value={leaveYear} onChange={(v) => setLeaveYear(v ?? new Date().getFullYear())} min={2000} max={2100} style={{ width: 120 }} />
          </Space>
          <Button type="primary" loading={previewMutation.isPending} onClick={() => previewMutation.mutate()}>
            Generate Preview
          </Button>
        </Space>
      </Card>

      <Table<YearEndRunRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={runs}
        onRow={(row) => ({ onClick: () => setSelectedRunId(row.id), style: { cursor: "pointer" } })}
        rowClassName={(row) => (row.id === selectedRunId ? "ant-table-row-selected" : "")}
        pagination={false}
        locale={{ emptyText: <EmptyState message="No year-end runs yet" compact /> }}
        columns={[
          { title: "Year", dataIndex: "leaveYear" },
          { title: "Status", dataIndex: "status", render: (v: YearEndRunStatus) => <Tag color={STATUS_COLORS[v]}>{v}</Tag> },
          { title: "Employees", dataIndex: "totalEmployees" },
          { title: "Total Days", dataIndex: "totalEncashedDays" },
          { title: "Total Amount", dataIndex: "totalEncashedAmount", render: (v: number) => money(v) },
          { title: "Previewed", dataIndex: "previewedAt", render: (v: string) => new Date(v).toLocaleString() },
          { title: "Committed", dataIndex: "committedAt", render: (v: string | null) => (v ? new Date(v).toLocaleString() : "—") },
          {
            title: "",
            key: "actions",
            render: (_, row) => (
              <Button size="small" icon={<DownloadOutlined />} onClick={(e) => { e.stopPropagation(); void downloadReport(row.id, row); }}>
                Report
              </Button>
            ),
          },
        ]}
      />

      {detail && (
        <Card size="small" title={`${detail.leaveYear} run detail`} extra={<Tag color={STATUS_COLORS[detail.status]}>{detail.status}</Tag>}>
          <Space orientation="vertical" size={16} style={{ width: "100%" }}>
            {detail.items.some((i) => i.rateSource === "MANUAL_SETTING") && <ProvisionalRateAlert />}
            <Table<YearEndRunItemRow>
              rowKey="id"
              size="small"
              dataSource={detail.items}
              pagination={{ pageSize: 10 }}
              locale={{ emptyText: <EmptyState message="No employees had a positive PL balance to encash" compact /> }}
              columns={[
                { title: "Employee Code", dataIndex: "employeeCode" },
                { title: "Employee", dataIndex: "employeeName" },
                { title: "Closing PL Balance", dataIndex: "closingPlBalance" },
                { title: "Encashed Days", dataIndex: "encashedDays" },
                { title: "Daily Rate", dataIndex: "dailyRate", render: (v: number) => money(v) },
                { title: "Amount", dataIndex: "encashedAmount", render: (v: number) => money(v) },
              ]}
            />

            {detail.status === "PREVIEW" && (
              <>
                <Alert
                  type="warning"
                  showIcon
                  message='Committing writes an ENCASHMENT ledger entry per employee and resets each PL balance to zero. Type "COMMIT YEAR END" to confirm.'
                />
                <Space wrap>
                  <Popconfirm title="Discard this preview?" onConfirm={() => discardMutation.mutate(detail.id)}>
                    <Button loading={discardMutation.isPending}>Discard</Button>
                  </Popconfirm>
                  <Input
                    placeholder='Type "COMMIT YEAR END" to confirm'
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    style={{ width: 260 }}
                  />
                  <Button
                    type="primary"
                    danger
                    disabled={confirmText !== "COMMIT YEAR END"}
                    loading={commitMutation.isPending}
                    onClick={() => commitMutation.mutate(detail.id)}
                  >
                    Commit
                  </Button>
                </Space>
              </>
            )}
          </Space>
        </Card>
      )}
    </Space>
  );
}
