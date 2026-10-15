import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Flex, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import * as adminApi from "../../../api/attendanceAdmin";
import type { ShiftOverrideBody, ShiftOverridePreview } from "../../../api/attendanceAdmin";
import * as attendanceApi from "../../../api/attendance";
import * as employeeApi from "../../../api/employee";
import { TargetPicker } from "../../../components/attendance/TargetPicker";
import { selectionOf, type TargetValues } from "../../../components/attendance/targetSelection";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;

interface Values extends TargetValues {
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  shiftId?: string;
  note?: string;
}

// Workforce → Attendance → Shift Override (Phase 3 commit 2): a shift for specific dates for one person or many, ahead of
// their usual assignment. It changes the shift only (the week-off pattern and policy stay theirs), is previewed first, and
// every change is on record. For a repeating pattern from tomorrow, use Shift Roster instead.
export function ShiftOverridePage() {
  const [form] = Form.useForm<Values>();
  const [noteForm] = Form.useForm<{ note: string }>();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ data: ShiftOverridePreview; body: ShiftOverrideBody } | null>(null);
  const [looked, setLooked] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<adminApi.ShiftOverrideEntry | null>(null);
  const { data: shifts = [] } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const { data: people } = useQuery({ queryKey: ["employees", "picker", search], queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20 }) });
  const { data, isLoading } = useQuery({ queryKey: ["attendance", "shift-overrides", employeeId, page], queryFn: () => adminApi.listShiftOverrides({ employeeId, page, pageSize: 15 }) });

  const previewMutation = useMutation({
    mutationFn: (body: ShiftOverrideBody) => adminApi.previewShiftOverride(body).then((d) => ({ data: d, body })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not preview this shift override.")),
  });
  const confirm = useMutation({
    mutationFn: () => adminApi.confirmShiftOverride(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      void message.success(`Shift set for ${r.days} employee-day${r.days === 1 ? "" : "s"} (${r.employees} ${r.employees === 1 ? "person" : "people"}).`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setPreview(null);
      form.resetFields();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not apply this shift override."));
      setPreview(null);
      setLooked(false);
    },
  });
  const clear = useMutation({
    mutationFn: (note: string) => adminApi.clearShiftOverride({ employeeId: removing!.employeeId, date: removing!.date, note }),
    onSuccess: () => {
      void message.success("Removed: the day follows their usual shift again.");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setRemoving(null);
      noteForm.resetFields();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not remove this shift override.")),
  });

  const d = preview?.data;
  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Shift Override
      </Title>
      <Card title="Set a shift for specific dates" size="small">
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ who: "LIST" }}
          onValuesChange={() => {
            setPreview(null);
            setLooked(false);
          }}
          onFinish={(v) => {
            const sel = selectionOf(v);
            if (!sel.selection) return void message.error(sel.error);
            previewMutation.mutate({ selection: sel.selection, from: v.range![0].format("YYYY-MM-DD"), to: v.range![1].format("YYYY-MM-DD"), shiftId: v.shiftId!, note: (v.note ?? "").trim() });
          }}
        >
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            For a swap or cover on particular days: a past day in the current or previous cycle, or a day up to the usual scheduling limit ahead. Only the shift changes; the week-off pattern and policy stay the person's own. Your own
            days are left out.
          </Text>
          <TargetPicker />
          <Space wrap align="start">
            <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]}>
              <DatePicker.RangePicker format="D MMM YYYY" />
            </Form.Item>
            <Form.Item name="shiftId" label="Shift" rules={[{ required: true, message: "Choose a shift" }]}>
              <Select style={{ width: 300 }} placeholder="Choose a shift" options={shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code}: ${s.name} ${s.startTime}–${s.endTime}` }))} />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="Why? (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. covering the late counter" }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={previewMutation.isPending}>
            Preview what will change
          </Button>
        </Form>
        {d && (
          <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
            {d.count === 0 ? (
              <Alert type="warning" showIcon title="Nothing in that selection can be changed." description="See why below." />
            ) : (
              <Descriptions size="small" bordered column={2}>
                <Descriptions.Item label="Employee-days">{d.count}</Descriptions.Item>
                <Descriptions.Item label="People">{d.employees}</Descriptions.Item>
                <Descriptions.Item label="Shift" span={2}>{d.shift}</Descriptions.Item>
              </Descriptions>
            )}
            {d.ownLeftOut > 0 && <Alert type="info" showIcon title={`${d.ownLeftOut} of your own days are left out.`} description="Nobody changes their own shift. Another HR admin does that." />}
            {d.cannotOverride.length > 0 && (
              <div>
                <Text strong>Not changed, and why</Text>
                <div style={{ marginTop: 4 }}>
                  {d.cannotOverride.map((g) => (
                    <div key={g.code}>
                      <Tag color="orange">{g.count}</Tag>
                      {g.label}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {" "}
                        e.g. {g.examples.map((e) => `${e.name} ${dayjs(e.date).format("D MMM")}`).join(", ")}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {d.count > 0 && (
              <>
                <Table
                  size="small"
                  rowKey={(r) => `${r.employeeId}|${r.date}`}
                  dataSource={d.rows}
                  pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
                  columns={[
                    { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                    { title: "Day", dataIndex: "date", render: (v: string) => dayjs(v).format("ddd, D MMM") },
                    { title: "Shift now", dataIndex: "shiftBefore", render: (v: string | null) => v ?? "—" },
                    { title: "Day now", dataIndex: "statusBefore", render: (v: string | null) => v ?? "—" },
                    { title: "Day after", dataIndex: "statusAfter", render: (v: string | null) => (v ? <Text strong>{v}</Text> : <Text type="secondary">worked out when the day comes</Text>) },
                  ]}
                />
                <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
                  I have looked at these {d.count} employee-days and want their shift set.
                </Checkbox>
                <Button type="primary" disabled={!looked} loading={confirm.isPending} onClick={() => confirm.mutate()}>
                  Set shift for {d.count} employee-day{d.count === 1 ? "" : "s"}
                </Button>
              </>
            )}
          </Space>
        )}
      </Card>
      <Card title="Shift overrides made" size="small">
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
        <Table<adminApi.ShiftOverrideEntry>
          size="small"
          rowKey="id"
          loading={isLoading}
          dataSource={data?.entries ?? []}
          locale={{ emptyText: <EmptyState message="No shift has been overridden yet." compact /> }}
          scroll={{ x: "max-content" }}
          pagination={{ current: page, pageSize: 15, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false, size: "small" }}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => `${r.employeeName} (${r.employeeCode})` },
            { title: "Day", dataIndex: "date", render: (v: string) => dayjs(v).format("ddd, D MMM YYYY") },
            { title: "Shift", dataIndex: "shift" },
            { title: "Why", dataIndex: "reason", render: (v: string) => v || <Text type="secondary">—</Text> },
            { title: "By", dataIndex: "by" },
            { title: "When", dataIndex: "at", render: (v: string) => dayjs(v).format("D MMM YYYY, HH:mm") },
            {
              title: "",
              key: "state",
              render: (_, r) =>
                r.inForce ? (
                  <Tooltip title="Goes back to the person's usual shift for that day.">
                    <Button size="small" onClick={() => setRemoving(r)}>
                      Remove
                    </Button>
                  </Tooltip>
                ) : (
                  <Text type="secondary">{r.cleared ? "removal" : "replaced"}</Text>
                ),
            },
          ]}
        />
      </Card>
      <Modal
        title={removing ? `Remove the shift override: ${removing.employeeName}, ${dayjs(removing.date).format("D MMM")}` : ""}
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        onOk={() => noteForm.submit()}
        okText="Remove"
        confirmLoading={clear.isPending}
        destroyOnHidden
      >
        <Form form={noteForm} layout="vertical" requiredMark={false} onFinish={(v) => clear.mutate(v.note.trim())}>
          <Form.Item name="note" label="Why? (kept on record)" rules={[{ required: true, min: 5, message: "A few words" }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Flex>
  );
}
