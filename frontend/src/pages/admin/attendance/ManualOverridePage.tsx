import { useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Flex, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography, message } from "antd";
import * as adminApi from "../../../api/attendanceAdmin";
import * as employeeApi from "../../../api/employee";
import { ManualOverrideForm } from "../../../components/attendance/ManualOverrideForm";
import type { CarriedSelection } from "../../../components/attendance/targetSelection";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;

// Workforce → Attendance → Manual Override (Phase 3 commit 2): HR sets days directly (including a leave day the person
// worked, which returns the leave balance), and sees every override that was made, who made it and why.
export function ManualOverridePage() {
  const carried = (useLocation().state as { carried?: CarriedSelection } | null)?.carried; // people and dates chosen on the Exceptions queue
  const queryClient = useQueryClient();
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<adminApi.OverrideEntry | null>(null);
  const [form] = Form.useForm<{ note: string }>();
  const { data: people } = useQuery({ queryKey: ["employees", "picker", search], queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20 }) });
  const { data, isLoading } = useQuery({ queryKey: ["attendance", "overrides", employeeId, page], queryFn: () => adminApi.listOverrides({ employeeId, page, pageSize: 15 }) });
  const clear = useMutation({
    mutationFn: (note: string) => adminApi.clearOverride({ employeeId: removing!.employeeId, date: removing!.date, note }),
    onSuccess: () => {
      void message.success("Removed: the day follows the device again.");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setRemoving(null);
      form.resetFields();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not remove this override.")),
  });
  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Manual Override
      </Title>
      <Card title="Set days" size="small">
        <ManualOverrideForm onDone={() => setPage(1)} carried={carried} />
      </Card>
      <Card title="Overrides and corrections made" size="small" extra={<Text type="secondary">Newest first. Approved correction requests are here too.</Text>}>
        <Flex gap={8} style={{ marginBottom: 12 }}>
          <Select
            allowClear
            showSearch={{ filterOption: false, onSearch: setSearch }}
            placeholder="Filter by employee"
            style={{ width: 300 }}
            value={employeeId}
            onChange={(v) => {
              setEmployeeId(v);
              setPage(1);
            }}
            options={(people?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
          />
        </Flex>
        <Table<adminApi.OverrideEntry>
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={data?.entries ?? []}
          locale={{ emptyText: <EmptyState message="Nothing has been overridden yet." compact /> }}
          scroll={{ x: "max-content" }}
          pagination={{ current: page, pageSize: 15, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false, size: "small" }}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => `${r.employeeName} (${r.employeeCode})` },
            { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("ddd, D MMM YYYY") },
            {
              title: "Set to",
              key: "what",
              render: (_, r) => (
                <>
                  {r.what}{" "}
                  <Tag color={r.origin === "REGULARIZATION" ? "blue" : "purple"}>{r.origin === "REGULARIZATION" ? "request approved" : "HR override"}</Tag>
                  {r.leaveReleased.length > 0 && <Tag color="green">leave returned: {r.leaveReleased.map((l) => `${l.type} ${l.days}`).join(", ")}</Tag>}
                </>
              ),
            },
            { title: "Why", key: "why", render: (_, r) => r.reason || <Text type="secondary">—</Text> },
            { title: "By", dataIndex: "by" },
            { title: "When", dataIndex: "at", render: (v: string) => dayjs(v).format("D MMM YYYY, HH:mm") },
            {
              title: "",
              key: "state",
              render: (_, r) =>
                r.inForce ? (
                  <Tooltip title="Goes back to what the device recorded. Not possible once leave was released on that day.">
                    <Button size="small" onClick={() => setRemoving(r)}>
                      Remove
                    </Button>
                  </Tooltip>
                ) : (
                  <Text type="secondary">{r.kind === "CLEARED" ? "removal" : "replaced"}</Text>
                ),
            },
          ]}
        />
      </Card>
      <Modal
        title={removing ? `Remove the override: ${removing.employeeName}, ${dayjs(removing.date).format("D MMM")}` : ""}
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onOk={() => form.submit()}
        okText="Remove"
        confirmLoading={clear.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => clear.mutate(v.note.trim())}>
          <Form.Item name="note" label="Why? (kept on record)" rules={[{ required: true, min: 5, message: "A few words" }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
