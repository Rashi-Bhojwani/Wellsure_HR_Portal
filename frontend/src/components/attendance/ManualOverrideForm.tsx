import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, DatePicker, Descriptions, Form, Input, Radio, Select, Space, Table, Tag, Typography, message } from "antd";
import * as adminApi from "../../api/attendanceAdmin";
import type { OverrideBody, OverridePreview } from "../../api/attendanceAdmin";
import { REASON_OPTIONS, type ReasonCode } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { TargetPicker } from "./TargetPicker";
import { selectionOf, type CarriedSelection, type TargetValues } from "./targetSelection";
import { fs } from "../../theme/tokens";

const { Text } = Typography;
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t?: string) => (t ? t.trim().padStart(5, "0") : undefined);

interface Values extends TargetValues {
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  reasonCode: ReasonCode;
  mode: "STATUS" | "TIMES" | "FOLLOW";
  status?: adminApi.OverrideStatus;
  inTime?: string;
  outTime?: string;
  note?: string;
  releaseLeave?: boolean;
}

/**
 * Manual Override (Phase 3 commit 2): HR sets a day's status or times directly, for one person or many, after a preview that
 * shows exactly what changes. The device's own punches never change; the day is marked as set by hand everywhere it
 * appears. "They worked on a day of approved leave" is the explicit action that releases that leave and returns the
 * days to the balance, in the same step.
 */
export function ManualOverrideForm({ fixed, onDone, carried }: { fixed?: { employeeId: string; name: string; date: string }; onDone?: () => void; carried?: CarriedSelection }) {
  const [form] = Form.useForm<Values>();
  useEffect(() => {
    if (carried) form.setFieldsValue({ who: "LIST", employeeIds: carried.employeeIds, range: [dayjs(carried.from), dayjs(carried.to)] });
  }, [carried, form]);
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ data: OverridePreview; body: OverrideBody } | null>(null);
  const [looked, setLooked] = useState(false);
  const mode = Form.useWatch("mode", form) ?? "STATUS";
  const releaseLeave = Form.useWatch("releaseLeave", form) ?? false;

  const bodyOf = (v: Values): OverrideBody | null => {
    const sel = selectionOf(v, fixed?.employeeId);
    if (!sel.selection) {
      void message.error(sel.error);
      return null;
    }
    const range = fixed ? ([dayjs(fixed.date), dayjs(fixed.date)] as const) : v.range!;
    return {
      selection: sel.selection,
      from: range[0].format("YYYY-MM-DD"),
      to: range[1].format("YYYY-MM-DD"),
      reasonCode: v.reasonCode,
      note: (v.note ?? "").trim(),
      releaseLeave: !!v.releaseLeave,
      ...(v.mode === "STATUS" ? { status: v.status } : v.mode === "FOLLOW" ? { followDevice: true } : { inTime: pad(v.inTime), outTime: pad(v.outTime) }),
    };
  };
  const previewMutation = useMutation({
    mutationFn: (body: OverrideBody) => adminApi.previewOverride(body).then((data) => ({ data, body })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not preview this override.")),
  });
  const confirm = useMutation({
    mutationFn: () => adminApi.confirmOverride(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      void message.success(`${r.days} employee-day${r.days === 1 ? "" : "s"} set for ${r.employees} ${r.employees === 1 ? "person" : "people"}${r.leaveDaysReleased > 0 ? `; ${r.leaveDaysReleased} day${r.leaveDaysReleased === 1 ? "" : "s"} of leave returned to balances` : ""}.`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["leave"] });
      setPreview(null);
      form.resetFields();
      onDone?.();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not apply this override."));
      setPreview(null); // the set may have changed: look again
      setLooked(false);
    },
  });

  const data = preview?.data;
  return (
    <>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ who: "GROUP", reasonCode: "ON_DUTY_ELSEWHERE", mode: "STATUS", releaseLeave: false }}
        onValuesChange={(changed) => {
          setPreview(null);
          setLooked(false);
          if ("releaseLeave" in changed && !changed.releaseLeave && form.getFieldValue("mode") === "FOLLOW") form.setFieldValue("mode", "STATUS");
        }}
        onFinish={(v) => {
          if (v.mode === "TIMES" && !v.inTime && !v.outTime) return void message.error("Give the time in, the time out, or both.");
          const body = bodyOf(v);
          if (body) previewMutation.mutate(body);
        }}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Set a day directly when a correction request is not the right route (HR knows what happened). You will see exactly what changes before anything is applied. The device's punches never change, your own days are left out
          (another HR admin does those), and a finalised day can't be touched.
        </Text>
        {fixed ? (
          <Alert type="info" showIcon style={{ marginBottom: 12 }} title={`${fixed.name}, ${dayjs(fixed.date).format("ddd D MMM YYYY")}`} />
        ) : (
          <>
            <TargetPicker known={carried?.people} />
            <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]}>
              <DatePicker.RangePicker format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs().subtract(1, "day"), "day")} />
            </Form.Item>
          </>
        )}
        <Form.Item name="mode" label="What should be set?">
          <Radio.Group
            options={[
              { value: "STATUS", label: "The day's status" },
              { value: "TIMES", label: "The times" },
              { value: "FOLLOW", label: "Follow the device's punches (only with the leave release below)", disabled: !releaseLeave },
            ]}
          />
        </Form.Item>
        {mode === "FOLLOW" ? (
          <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
            Nothing is set for the day itself: its times and status are worked out from what the device recorded, as on any ordinary day. Only the leave is released.
          </Text>
        ) : mode === "STATUS" ? (
          <Form.Item name="status" label="The day should be" rules={[{ required: true, message: "Choose a status" }]}>
            <Select style={{ width: 320 }} options={adminApi.OVERRIDE_STATUS_OPTIONS} placeholder="Choose" />
          </Form.Item>
        ) : (
          <Space wrap align="start">
            <Form.Item name="inTime" label="Time in" rules={[{ pattern: TIME, message: "HH:MM, e.g. 10:00" }]}>
              <Input placeholder="10:00" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="outTime" label="Time out" rules={[{ pattern: TIME, message: "HH:MM, e.g. 19:00" }]}>
              <Input placeholder="19:00" style={{ width: 120 }} />
            </Form.Item>
            <Text type="secondary" style={{ display: "block", marginTop: 30 }}>
              Both replace the device's times for the day; one adds to them. A leave day or an already-corrected day needs both.
            </Text>
          </Space>
        )}
        <Form.Item name="reasonCode" label="Why?">
          <Select style={{ width: 240 }} options={REASON_OPTIONS} />
        </Form.Item>
        <Form.Item name="note" label="Say what happened (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. worked at the client site that day" }]}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <Form.Item name="releaseLeave" valuePropName="checked" extra="Only for a day that is on approved leave but the person actually worked. The leave for that day is released and its days go back to their balance, in the same step, with your reason. This can't be undone by removing the override; if it was a mistake, apply the leave again.">
          <Checkbox>They worked on a day of approved leave: release the leave and return the balance</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={previewMutation.isPending}>
          Preview what will change
        </Button>
      </Form>

      {data && (
        <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
          {data.count === 0 ? (
            <Alert type="warning" showIcon title="Nothing in that selection can be set." description="See why below, then change the dates, people or what to set." />
          ) : (
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Employee-days">{data.count}</Descriptions.Item>
              <Descriptions.Item label="People">{data.employees}</Descriptions.Item>
              <Descriptions.Item label="Will be set to" span={2}>{data.correction}</Descriptions.Item>
            </Descriptions>
          )}
          {data.leaveDaysReleased > 0 && (
            <Alert type="warning" showIcon title={`${data.leaveDaysReleased} day${data.leaveDaysReleased === 1 ? "" : "s"} of approved leave will be released and returned to leave balances.`} description="It appears in the leave ledger with your reason and in the attendance day. Confirming does both together." />
          )}
          {data.ownLeftOut > 0 && <Alert type="info" showIcon title={`${data.ownLeftOut} of your own days are left out.`} description="Nobody changes their own attendance. Another HR admin does those." />}
          {data.cannotOverride.length > 0 && (
            <div>
              <Text strong>Not set, and why</Text>
              <div style={{ marginTop: 4 }}>
                {data.cannotOverride.map((g) => (
                  <div key={g.code}>
                    <Tag color="orange">{g.count}</Tag>
                    {g.label}
                    <Text type="secondary" style={{ fontSize: fs.sm }}>
                      {" "}
                      e.g. {g.examples.map((e) => `${e.name} ${dayjs(e.date).format("D MMM")}`).join(", ")}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.count > 0 && (
            <>
              <Table
                size="small"
                rowKey={(r) => `${r.employeeId}|${r.date}`}
                dataSource={data.rows}
                pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
                columns={[
                  { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                  { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("ddd, D MMM") },
                  { title: "Now", dataIndex: "before", render: (v: string | null) => v ?? "—" },
                  { title: "After", dataIndex: "after", render: (v: string | null) => <Text strong>{v ?? "—"}</Text> },
                  { title: "Replaces", dataIndex: "replaces", render: (v: string | null) => (v ? <Tag>{v === "REGULARIZATION" ? "an approved request" : "an earlier override"}</Tag> : "—") },
                  { title: "Leave returned", key: "leave", render: (_, r) => (r.leave.length ? r.leave.map((l) => `${l.type} ${l.days}`).join(", ") : "—") },
                ]}
              />
              <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
                I have looked at these {data.count} employee-days{releaseLeave && data.leaveDaysReleased > 0 ? " and the leave that will be returned" : ""} and want them set.
              </Checkbox>
              <Button type="primary" disabled={!looked} loading={confirm.isPending} onClick={() => confirm.mutate()}>
                Set {data.count} employee-day{data.count === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </Space>
      )}
    </>
  );
}
