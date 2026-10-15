import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, DatePicker, Descriptions, Flex, Form, Input, InputNumber, Radio, Select, Space, Table, Tag, Typography, message } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import * as adminApi from "../../../api/attendanceAdmin";
import type { RosterBody, RosterPreview } from "../../../api/attendanceAdmin";
import * as attendanceApi from "../../../api/attendance";
import { TargetPicker } from "../../../components/attendance/TargetPicker";
import { selectionOf, type TargetValues } from "../../../components/attendance/targetSelection";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;

interface Values extends TargetValues {
  start?: dayjs.Dayjs;
  mode: "ONE" | "ROTATION";
  shiftId?: string;
  steps?: Array<{ shiftId?: string; days?: number }>;
  until?: dayjs.Dayjs;
  then: "RETURN" | "STAY";
  note?: string;
}

// Workforce → Attendance → Shift Roster (Phase 3 commit 2): assign a shift to many people from a future date, or generate a
// rotation (for example one week early, one week late, repeating). It writes the same dated assignment changes as
// Attendance Settings, so it only looks forward: from tomorrow, up to the scheduling limit. Today and earlier days are
// corrected with Shift Override.
export function ShiftRosterPage() {
  const [form] = Form.useForm<Values>();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ data: RosterPreview; body: RosterBody } | null>(null);
  const [looked, setLooked] = useState(false);
  const mode = Form.useWatch("mode", form) ?? "ONE";
  const { data: shifts = [] } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const shiftOptions = shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code}: ${s.name} ${s.startTime}–${s.endTime}` }));
  const tomorrow = dayjs().add(1, "day");

  const previewMutation = useMutation({
    mutationFn: (body: RosterBody) => adminApi.previewRoster(body).then((data) => ({ data, body })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not preview this roster.")),
  });
  const confirm = useMutation({
    mutationFn: () => adminApi.confirmRoster(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      void message.success(`Roster written for ${r.people} ${r.people === 1 ? "person" : "people"} (${r.changes} shift change${r.changes === 1 ? "" : "s"}${r.replacedScheduled ? `, replacing ${r.replacedScheduled} that were scheduled` : ""}).`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setPreview(null);
      form.resetFields();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not write this roster."));
      setPreview(null);
      setLooked(false);
    },
  });

  const d = preview?.data;
  return (
    <Flex vertical gap={16}>
      <Title level={3} style={{ margin: 0 }}>
        Shift Roster
      </Title>
      <Card size="small">
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ who: "GROUP", mode: "ONE", then: "RETURN", steps: [{ days: 7 }, { days: 7 }] }}
          onValuesChange={() => {
            setPreview(null);
            setLooked(false);
          }}
          onFinish={(v) => {
            const sel = selectionOf(v);
            if (!sel.selection) return void message.error(sel.error);
            const rotation = v.mode === "ROTATION";
            const steps = rotation ? (v.steps ?? []).map((s) => ({ shiftId: s.shiftId!, days: s.days! })) : [{ shiftId: v.shiftId!, days: 1 }];
            if (rotation && steps.length < 2) return void message.error("A rotation needs at least two steps.");
            previewMutation.mutate({ selection: sel.selection, start: v.start!.format("YYYY-MM-DD"), steps, repeat: rotation, until: rotation ? v.until?.format("YYYY-MM-DD") : null, then: v.then, note: (v.note ?? "").trim() });
          }}
        >
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            Looks forward only. A roster starts tomorrow at the earliest; writing one again for the same dates replaces what was scheduled from the start date. People who have left, and you, are left out.
          </Text>
          <TargetPicker />
          <Space wrap align="start">
            <Form.Item name="start" label="Starting" rules={[{ required: true, message: "Choose the first day" }]}>
              <DatePicker format="D MMM YYYY" disabledDate={(x) => x.isBefore(tomorrow, "day")} />
            </Form.Item>
            <Form.Item name="mode" label="What?">
              <Radio.Group options={[{ value: "ONE", label: "One shift from that day" }, { value: "ROTATION", label: "A rotation that repeats" }]} />
            </Form.Item>
          </Space>
          {mode === "ONE" ? (
            <Form.Item name="shiftId" label="Shift" rules={[{ required: true, message: "Choose a shift" }]}>
              <Select style={{ width: 360 }} placeholder="Choose a shift" options={shiftOptions} />
            </Form.Item>
          ) : (
            <>
              <Form.Item label="The pattern, in order (it repeats until the end date)" required>
                <Form.List name="steps">
                  {(fields, { add, remove }) => (
                    <Space orientation="vertical" size={8}>
                      {fields.map((f, i) => (
                        <Space key={f.key} align="start">
                          <Text type="secondary" style={{ width: 52, display: "inline-block", marginTop: 5 }}>
                            Step {i + 1}
                          </Text>
                          <Form.Item name={[f.name, "shiftId"]} rules={[{ required: true, message: "Shift" }]} style={{ margin: 0 }}>
                            <Select style={{ width: 320 }} placeholder="Shift" options={shiftOptions} />
                          </Form.Item>
                          <Form.Item name={[f.name, "days"]} rules={[{ required: true, message: "Days" }]} style={{ margin: 0 }}>
                            <InputNumber min={1} max={366} addonAfter="days" style={{ width: 130 }} />
                          </Form.Item>
                          {fields.length > 2 && <Button aria-label={`Remove step ${i + 1}`} icon={<DeleteOutlined />} onClick={() => remove(f.name)} />}
                        </Space>
                      ))}
                      {fields.length < 14 && (
                        <Button icon={<PlusOutlined />} onClick={() => add({ days: 7 })}>
                          Add a step
                        </Button>
                      )}
                    </Space>
                  )}
                </Form.List>
              </Form.Item>
              <Space wrap align="start">
                <Form.Item name="until" label="Repeat until (last day, inclusive)" rules={[{ required: true, message: "Choose the last day" }]}>
                  <DatePicker format="D MMM YYYY" disabledDate={(x) => x.isBefore(tomorrow, "day")} />
                </Form.Item>
                <Form.Item name="then" label="After that">
                  <Radio.Group options={[{ value: "RETURN", label: "Go back to the shift they had before" }, { value: "STAY", label: "Stay on the last shift" }]} />
                </Form.Item>
              </Space>
            </>
          )}
          <Form.Item name="note" label="Why? (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. the October roster" }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={previewMutation.isPending}>
            Preview what will change
          </Button>
        </Form>
      </Card>

      {d && (
        <Card title="What will be written" size="small">
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            {d.people === 0 ? (
              <Alert type="warning" showIcon title="Nobody in that selection can be rostered." description="See why below." />
            ) : (
              <Descriptions size="small" bordered column={2}>
                <Descriptions.Item label="People">{d.people}</Descriptions.Item>
                <Descriptions.Item label="Shift changes written">{d.changes}</Descriptions.Item>
                <Descriptions.Item label="From">{dayjs(d.start).format("ddd D MMM YYYY")}</Descriptions.Item>
                <Descriptions.Item label="Until">{d.until ? `${dayjs(d.until).format("D MMM YYYY")}, then ${d.then === "RETURN" ? "back to their previous shift" : "staying on the last shift"}` : "No end: the shift stays"}</Descriptions.Item>
              </Descriptions>
            )}
            {d.replacedScheduled > 0 && <Alert type="warning" showIcon title={`${d.replacedScheduled} shift change${d.replacedScheduled === 1 ? "" : "s"} already scheduled from ${dayjs(d.start).format("D MMM")} will be replaced.`} description="Listed against each person below. Changes scheduled before that date stay." />}
            {d.cannotRoster.length > 0 && (
              <div>
                <Text strong>Left out, and why</Text>
                <div style={{ marginTop: 4 }}>
                  {d.cannotRoster.map((g) => (
                    <div key={g.code}>
                      <Tag color="orange">{g.count}</Tag>
                      {g.label}
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {" "}
                        e.g. {g.examples.map((e) => e.name).join(", ")}
                      </Text>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {d.people > 0 && (
              <>
                <Table
                  size="small"
                  rowKey="employeeId"
                  dataSource={d.rows}
                  pagination={{ pageSize: 8, size: "small", showSizeChanger: false }}
                  columns={[
                    { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                    { title: "Shift now", dataIndex: "currentShift", render: (v: string | null) => v ?? "—" },
                    { title: "New shifts", key: "s", render: (_, r) => r.segments.map((s) => `${dayjs(s.from).format("D MMM")} ${s.shift}`).join("  →  ") },
                    { title: "Replaces", key: "r", render: (_, r) => (r.replaces.length ? r.replaces.map((s) => `${dayjs(s.from).format("D MMM")} ${s.shift}`).join(", ") : "—") },
                  ]}
                />
                <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
                  I have looked at this roster for {d.people} {d.people === 1 ? "person" : "people"} and want it written.
                </Checkbox>
                <Button type="primary" disabled={!looked} loading={confirm.isPending} onClick={() => confirm.mutate()}>
                  Write the roster
                </Button>
              </>
            )}
          </Space>
        </Card>
      )}
    </Flex>
  );
}
