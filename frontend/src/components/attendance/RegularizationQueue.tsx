import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Modal, Popconfirm, Segmented, Select, Space, Table, Tag, Typography, message } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import * as infoApi from "../../api/attendanceInfo";
import type { QueueRow, ReasonCode, RegularizationStatus } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { EmptyState } from "../common/EmptyState";
import { fs } from "../../theme/tokens";

const { Text } = Typography;
const STATUS_COLOR: Record<string, string> = { PENDING: "gold", APPROVED: "green", REJECTED: "red", CANCELLED: "default" };

/**
 * Attendance corrections to decide (Phase 2 P2-E began it; Phase 3 commit 1 generalised it): a manager's
 * team (by grant) or, for HR, everyone. Approving applies the correction to the day and works it out
 * again (the device's punches never change); the employee is notified either way. `batchId` narrows it
 * to one bulk correction.
 */
export function RegularizationQueue({ emptyText = "No correction requests waiting", batchId }: { emptyText?: string; batchId?: string }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<RegularizationStatus | "ALL">("PENDING");
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [note, setNote] = useState("");
  const [reasonCode, setReasonCode] = useState<ReasonCode | undefined>();
  const { data = [], isLoading } = useQuery({
    queryKey: ["attendance", "regularizations", status, reasonCode, batchId],
    queryFn: () => infoApi.regularizationQueue({ status: status === "ALL" ? undefined : status, reasonCode, batchId }),
  });
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ["attendance"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const approve = useMutation({
    mutationFn: (r: QueueRow) => infoApi.approveRegularization(r.id),
    onSuccess: () => {
      void message.success("Approved. The day has been worked out again with the correction.");
      refresh();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not approve.")),
  });
  const reject = useMutation({
    mutationFn: () => infoApi.rejectRegularization(rejecting!.id, note),
    onSuccess: () => {
      void message.success("Rejected. The employee has been told why.");
      setRejecting(null);
      setNote("");
      refresh();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not reject.")),
  });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Segmented
          value={status}
          onChange={(v) => setStatus(v as RegularizationStatus | "ALL")}
          options={[
            { value: "PENDING", label: "Waiting" },
            { value: "APPROVED", label: "Approved" },
            { value: "REJECTED", label: "Rejected" },
            { value: "ALL", label: "All" },
          ]}
        />
        <Select allowClear placeholder="Any reason" style={{ width: 190 }} value={reasonCode} onChange={setReasonCode} options={infoApi.REASON_OPTIONS} />
      </Space>
      <Table<QueueRow>
        rowKey="id"
        size="small"
        loading={isLoading}
        dataSource={data}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        locale={{ emptyText: <EmptyState message={emptyText} compact /> }}
        columns={[
          { title: "Employee", key: "who", render: (_, r) => (<><div>{r.name}</div><Text type="secondary" style={{ fontSize: fs.sm }}>{r.employeeCode}</Text></>) },
          { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("ddd, D MMM") },
          { title: "Reason", key: "why", render: (_, r) => (<><div>{r.reasonLabel}</div>{r.batchId && <Tag>bulk</Tag>}</>) },
          {
            title: "The day now",
            key: "now",
            render: (_, r) => (
              <>
                <div>{r.dayStatus ?? "—"}</div>
                <Text type="secondary" style={{ fontSize: fs.sm }}>
                  {r.punches ? (r.punches.count === 0 ? "no punches" : `${r.punches.firstIn ?? "—"}${r.punches.lastOut ? `–${r.punches.lastOut}` : ""} (${r.punches.count} punch${r.punches.count === 1 ? "" : "es"})`) : "no record"}
                  {r.shift ? ` · ${r.shift}` : ""}
                </Text>
              </>
            ),
          },
          { title: "Asks for", key: "asks", render: (_, r) => <Text strong>{r.correctionText}</Text> },
          { title: "Note", dataIndex: "reason", render: (v: string) => (v ? <Text style={{ maxWidth: 240, display: "inline-block" }}>"{v}"</Text> : <Text type="secondary">—</Text>) },
          { title: "Raised", dataIndex: "createdAt", render: (v: string) => dayjs(v).format("D MMM, HH:mm") },
          {
            title: status === "PENDING" ? "Decide" : "Status",
            key: "actions",
            render: (_, r) =>
              r.canDecide ? (
                <Space>
                  <Popconfirm title={`Apply "${r.correctionText}" to ${dayjs(r.date).format("D MMM")}?`} description="The day is worked out again with this correction; the punches never change." onConfirm={() => approve.mutate(r)}>
                    <Button size="small" type="primary" icon={<CheckOutlined />} loading={approve.isPending && approve.variables?.id === r.id}>
                      Approve
                    </Button>
                  </Popconfirm>
                  <Button size="small" danger icon={<CloseOutlined />} onClick={() => setRejecting(r)}>
                    Reject
                  </Button>
                </Space>
              ) : (
                <>
                  <Tag color={STATUS_COLOR[r.status]}>{r.status.toLowerCase()}</Tag>
                  {r.decidedBy && (
                    <Text type="secondary" style={{ fontSize: fs.sm }}>
                      by {r.decidedBy}
                      {r.decisionNote ? `: "${r.decisionNote}"` : ""}
                    </Text>
                  )}
                </>
              ),
          },
        ]}
      />
      <Modal title="Reject this request?" open={!!rejecting} onCancel={() => setRejecting(null)} onOk={() => reject.mutate()} okText="Reject" okButtonProps={{ danger: true, disabled: note.trim().length < 3 }} confirmLoading={reject.isPending}>
        <Text>Say why, so {rejecting?.name ?? "they"} knows what to do next. The day stays as it is.</Text>
        <Input.TextArea rows={3} style={{ marginTop: 8 }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The security register shows you left at 15:00" maxLength={500} />
      </Modal>
    </Space>
  );
}
