import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Descriptions, Flex, Form, Input, Modal, Space, Spin, Table, Tag, Tooltip, Typography, message } from "antd";
import { LockOutlined, UnlockOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../api/attendance";
import type { PeriodRow, PeriodStatus } from "../../../api/attendance";
import { FinalisationBlockers } from "../../../components/attendance/FinalisationBlockers";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage, apiErrorCode } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";

const { Title, Text } = Typography;

const STATUS: Record<PeriodStatus, { color: string; label: string }> = {
  OPEN: { color: "default", label: "Open" },
  FINALISED: { color: "green", label: "Finalised" },
  UNLOCKED: { color: "orange", label: "Unlocked (not finalised again)" },
};

// Workforce → Attendance → Attendance Period Finalisation (Phase 3 commit 3): lock a whole attendance cycle once nothing blocks
// it. Finalising locks every day of the period against changes (overrides, corrections, manual entry, Process Attendance);
// only a Super Admin can unlock, with a reason, and is told if payroll has already used the period.
export function FinalisationPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canUnlock = hasPermission("attendance.unlock");
  const [picked, setPicked] = useState<string | null>(null);
  const [finalising, setFinalising] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [payrollWarning, setPayrollWarning] = useState<string | null>(null);
  const [noteForm] = Form.useForm<{ note: string }>();
  const [reasonForm] = Form.useForm<{ reason: string }>();

  const { data: periods = [], isLoading } = useQuery({ queryKey: ["attendance", "finalisation", "periods"], queryFn: () => attendanceApi.listPeriods() });
  const chosen: PeriodRow | undefined = periods.find((p) => p.from === picked) ?? periods.find((p) => p.isOver && p.status !== "FINALISED") ?? periods[0];
  const { data: readiness, isFetching } = useQuery({
    queryKey: ["attendance", "finalisation", "readiness", chosen?.from, chosen?.to],
    queryFn: () => attendanceApi.finalisationReadiness(chosen!.from, chosen!.to),
    enabled: !!chosen && chosen.status !== "FINALISED",
  });

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["attendance"] });
  const finalise = useMutation({
    mutationFn: (note: string) => attendanceApi.finalisePeriod({ from: chosen!.from, to: chosen!.to, note }),
    onSuccess: (r) => {
      void message.success(`${chosen!.label} is finalised: ${r.locked} days locked.`);
      setPicked(chosen!.from); // stay on it: the view now offers Unlock
      setFinalising(false);
      noteForm.resetFields();
      refresh();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not finalise this period."));
      setFinalising(false);
      refresh(); // the blockers may have changed
    },
  });
  const unlock = useMutation({
    mutationFn: (reason: string) => attendanceApi.unlockPeriod({ from: chosen!.from, to: chosen!.to, reason, confirmPayrollConsumed: payrollWarning !== null }),
    onSuccess: (r) => {
      void message.success(`${chosen!.label} is unlocked: ${r.unlocked} days are open to changes. Finalise it again before payroll reads it.`);
      setPicked(chosen!.from);
      setUnlocking(false);
      setPayrollWarning(null);
      reasonForm.resetFields();
      refresh();
    },
    onError: (err) => {
      if (apiErrorCode(err) === "PAYROLL_CONSUMED") return setPayrollWarning(apiErrorMessage(err, "Payroll has used this period."));
      void message.error(apiErrorMessage(err, "Could not unlock this period."));
    },
  });

  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Attendance Period Finalisation
      </Title>
      <Text type="secondary">
        A period is a whole attendance cycle. Finalising it locks every day in it, so what payroll reads cannot change underneath it. It is refused while anything below still blocks it. Unlocking is for a Super Admin only,
        with a reason, and every lock and unlock is on record.
      </Text>
      <Card size="small" title="Periods" extra={<Text type="secondary">Newest first. Pick one to see what blocks it.</Text>}>
        <Table<PeriodRow>
          size="small"
          rowKey="from"
          loading={isLoading}
          dataSource={periods}
          pagination={false}
          scroll={{ x: "max-content" }}
          rowClassName={(r) => (r.from === chosen?.from ? "ant-table-row-selected" : "")}
          onRow={(r) => ({ onClick: () => setPicked(r.from), style: { cursor: "pointer" } })}
          columns={[
            { title: "Period", dataIndex: "label", render: (l: string, r) => <Text strong={r.from === chosen?.from}>{l}</Text> },
            { title: "Status", dataIndex: "status", render: (s: PeriodStatus, r) => <Tag color={STATUS[s].color}>{STATUS[s].label}{!r.isOver && s === "OPEN" ? " · in progress" : ""}</Tag> },
            { title: "Locked days", dataIndex: "lockedDays", align: "right" },
            {
              title: "Last action",
              key: "last",
              render: (_, r) =>
                r.last ? (
                  <Tooltip title={r.last.reason || undefined}>
                    <span>
                      {r.last.action === "FINALISE" ? "Finalised" : "Unlocked"} by {r.last.by ?? "someone"} on {formatDateTime(r.last.at)}
                    </span>
                  </Tooltip>
                ) : (
                  <Text type="secondary">—</Text>
                ),
            },
          ]}
        />
      </Card>

      {chosen && (
        <Card
          size="small"
          title={chosen.label}
          extra={
            <Space>
              {chosen.status === "FINALISED" && canUnlock && (
                <Button icon={<UnlockOutlined />} danger onClick={() => setUnlocking(true)}>
                  Unlock…
                </Button>
              )}
              {chosen.status !== "FINALISED" && (
                <Button type="primary" icon={<LockOutlined />} disabled={!readiness?.ready} loading={isFetching} onClick={() => setFinalising(true)}>
                  Finalise this period…
                </Button>
              )}
            </Space>
          }
        >
          {chosen.status === "FINALISED" ? (
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              <Alert
                type="success"
                showIcon
                title={`${chosen.label} is finalised.`}
                description={`${chosen.lockedDays} days are locked: no override, correction, manual entry or reprocessing can change them. ${canUnlock ? "You can unlock it with a reason." : "Only a Super Admin can unlock it."}`}
              />
              {chosen.last && (
                <Descriptions size="small" column={1} bordered items={[{ key: "by", label: "Finalised", children: `${chosen.last.by ?? "someone"} on ${formatDateTime(chosen.last.at)}` }, ...(chosen.last.reason ? [{ key: "note", label: "Note", children: chosen.last.reason }] : [])]} />
              )}
            </Space>
          ) : !readiness ? (
            <Spin />
          ) : (
            <Space orientation="vertical" size={8} style={{ width: "100%" }}>
              {chosen.status === "UNLOCKED" && chosen.last && (
                <Alert type="warning" showIcon title="This period was unlocked and has not been finalised again." description={`Unlocked by ${chosen.last.by ?? "someone"} on ${formatDate(chosen.last.at)}: ${chosen.last.reason}`} />
              )}
              {readiness.ready ? (
                <Alert type="success" showIcon title="Nothing blocks this period." description="Finalising locks every day in it." />
              ) : (
                <Text>
                  This period can't be finalised until {readiness.blockers.length === 1 ? "this is" : "these are"} resolved. The server refuses it outright while any remain.
                </Text>
              )}
              <FinalisationBlockers readiness={readiness} />
              <Button size="small" onClick={refresh}>
                Check again
              </Button>
            </Space>
          )}
        </Card>
      )}

      <Modal
        title={`Finalise ${chosen?.label ?? ""}`}
        open={finalising}
        okText="Finalise and lock"
        confirmLoading={finalise.isPending}
        onCancel={() => setFinalising(false)}
        onOk={() => noteForm.validateFields().then((v) => finalise.mutate((v.note ?? "").trim()), () => undefined)}
        destroyOnHidden
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            Every day from {chosen && formatDate(chosen.from)} to {chosen && formatDate(chosen.to)} is locked against changes. Only a Super Admin can unlock it, and that is recorded.
          </Text>
          <Form form={noteForm} layout="vertical" requiredMark={false}>
            <Form.Item name="note" label="Note (optional)">
              <Input.TextArea rows={2} maxLength={500} placeholder="For the record, for example: signed off by payroll" />
            </Form.Item>
          </Form>
        </Space>
      </Modal>

      <Modal
        title={`Unlock ${chosen?.label ?? ""}`}
        open={unlocking}
        okText={payrollWarning ? "Unlock anyway" : "Unlock"}
        okButtonProps={{ danger: true }}
        confirmLoading={unlock.isPending}
        onCancel={() => {
          setUnlocking(false);
          setPayrollWarning(null);
        }}
        onOk={() => reasonForm.validateFields().then((v) => unlock.mutate(v.reason.trim()), () => undefined)}
        destroyOnHidden
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Text>The days become open to changes again. The cycle has to be finalised again before payroll reads it.</Text>
          {payrollWarning && <Alert type="error" showIcon title="Payroll has used this period" description={`${payrollWarning} Press Unlock anyway only if you understand that.`} />}
          <Form form={reasonForm} layout="vertical" requiredMark={false}>
            <Form.Item name="reason" label="Why is it being unlocked?" rules={[{ required: true, min: 5, message: "Say why (a few words)" }]}>
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
          </Form>
        </Space>
      </Modal>
    </Flex>
  );
}
