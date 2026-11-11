import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as biometricApi from "../../../../api/biometric";
import * as workforceApi from "../../../../api/workforce";
import { apiErrorMessage } from "../../../../lib/apiError";
import { DataTable, PageHeader, SideDrawer, StatusChip, toast } from "../../../../ui";

// A-10 G5 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 14): ask the sync agent to read a device again for a range of days (at most 31). The agent picks the
// oldest pending request up on its next heartbeat and reports it done; punches the server already has are dropped by its duplicate key.

const STATUS: Record<workforceApi.SyncRequestView["status"], { text: string; tone: "info" | "success" | "neutral" }> = {
  PENDING: { text: "Waiting for the agent", tone: "info" },
  DONE: { text: "Done", tone: "success" },
  CANCELLED: { text: "Cancelled", tone: "neutral" },
};
const fmt = (s: string) => dayjs(s).format("D MMM YYYY");

export function DeviceSyncPage() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [form] = Form.useForm<{ deviceId: string; range: [Dayjs, Dayjs]; reason: string }>();
  const rows = useQuery({ queryKey: ["workforce", "sync"], queryFn: workforceApi.listSyncRequests, refetchInterval: 30_000 });
  const devices = useQuery({ queryKey: ["biometric", "devices"], queryFn: biometricApi.listDevices, enabled: adding });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["workforce", "sync"] });
  const create = useMutation({
    mutationFn: (v: { deviceId: string; range: [Dayjs, Dayjs]; reason: string }) => workforceApi.requestSync({ deviceId: v.deviceId, fromDate: v.range[0].format("YYYY-MM-DD"), toDate: v.range[1].format("YYYY-MM-DD"), reason: v.reason.trim() }),
    onSuccess: () => {
      toast.success("Requested. The agent reads it on its next heartbeat.");
      setAdding(false);
      form.resetFields();
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not request it.")),
  });
  const cancel = useMutation({
    mutationFn: (id: string) => workforceApi.cancelSync(id),
    onSuccess: () => {
      toast.success("Cancelled.");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not cancel it.")),
  });
  return (
    <>
      <PageHeader title="Device Sync Requests" subtitle="Ask a sync agent to read a device again for some days. Pending requests are picked up on the agent's next heartbeat." actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>New request</Button>} />
      <DataTable<workforceApi.SyncRequestView>
        rowKey="id"
        loading={rows.isLoading}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        dataSource={rows.data ?? []}
        empty="No sync requests yet."
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Device", dataIndex: "device" },
          { title: "Days", key: "days", render: (_, r) => `${fmt(r.fromDate)} – ${fmt(r.toDate)}` },
          { title: "Reason", dataIndex: "reason" },
          { title: "Asked", dataIndex: "requestedAt", render: (x: string) => dayjs(x).format("D MMM, HH:mm") },
          { title: "State", key: "st", render: (_, r) => <StatusChip tone={STATUS[r.status].tone}>{STATUS[r.status].text}</StatusChip> },
          { title: "", key: "act", render: (_, r) => (r.status === "PENDING" ? <Button loading={cancel.isPending && cancel.variables === r.id} onClick={() => cancel.mutate(r.id)}>Cancel</Button> : null) },
        ]}
      />
      <SideDrawer open={adding} title="Read a device again" subtitle="At most 31 days, none in the future." onClose={() => setAdding(false)} formId="sync-form" primaryLabel="Request" primaryLoading={create.isPending}>
        <Form id="sync-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="deviceId" label="Device" rules={[{ required: true, message: "Choose a device" }]}>
            <Select loading={devices.isLoading} options={(devices.data ?? []).filter((x) => x.route === "AGENT" && x.isActive).map((x) => ({ value: x.id, label: x.name }))} />
          </Form.Item>
          <Form.Item name="range" label="Days" rules={[{ required: true, message: "Choose the days" }]}>
            <DatePicker.RangePicker format="D MMM YYYY" disabledDate={(x) => x.isAfter(dayjs(), "day")} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "Say why (a few words)" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
