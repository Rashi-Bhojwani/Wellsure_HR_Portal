import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Input, Radio, Select, Typography } from "antd";
import { ClockCircleOutlined } from "@ant-design/icons";
import * as adminApi from "../../api/attendanceAdmin";
import type { OverrideBody, OverridePreview } from "../../api/attendanceAdmin";
import { REASON_OPTIONS, type ReasonCode } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { TargetPicker } from "./TargetPicker";
import { selectionOf, type CarriedSelection, type TargetValues } from "./targetSelection";
import { fs, fw, radius, space, v as tk } from "../../theme/tokens";
import { ApprovalBanner, DataTable, FormGroupTitle, KeyValueGrid, StatusChip, toast } from "../../ui";

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
      toast.error(sel.error);
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
    onError: (err) => toast.error(apiErrorMessage(err, "Could not preview this override.")),
  });
  const confirm = useMutation({
    mutationFn: () => adminApi.confirmOverride(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      toast.success(`${r.days} employee-day${r.days === 1 ? "" : "s"} set for ${r.employees} ${r.employees === 1 ? "person" : "people"}${r.leaveDaysReleased > 0 ? `; ${r.leaveDaysReleased} day${r.leaveDaysReleased === 1 ? "" : "s"} of leave returned to balances` : ""}.`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["leave"] });
      setPreview(null);
      form.resetFields();
      onDone?.();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not apply this override."));
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
          if (v.mode === "TIMES" && !v.inTime && !v.outTime) return void toast.error("Give the time in, the time out, or both.");
          const body = bodyOf(v);
          if (body) previewMutation.mutate(body);
        }}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: space[4] }}>
          Set a day directly when a correction request is not the right route (HR knows what happened). You will see exactly what changes before anything is applied. The device's punches never change, your own days are left out
          (another HR admin does those), and a finalised day can't be touched.
        </Text>
        {fixed ? (
          <ApprovalBanner tone="info" style={{ marginBottom: space[4] }} title={`${fixed.name}, ${dayjs(fixed.date).format("ddd D MMM YYYY")}`} />
        ) : (
          <>
            <FormGroupTitle>Who and when</FormGroupTitle>
            <TargetPicker known={carried?.people} />
            <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]}>
              <DatePicker.RangePicker format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs().subtract(1, "day"), "day")} style={{ width: "100%", maxWidth: 360 }} />
            </Form.Item>
          </>
        )}
        <FormGroupTitle>What to set</FormGroupTitle>
        <Form.Item name="mode" label="What should be set?">
          <Radio.Group
            style={{ display: "flex", flexDirection: "column", gap: space[2] }}
            options={[
              { value: "STATUS", label: "The day's status" },
              { value: "TIMES", label: "The times" },
              { value: "FOLLOW", label: "Follow the device's punches (only with the leave release below)", disabled: !releaseLeave },
            ]}
          />
        </Form.Item>
        {mode === "FOLLOW" ? (
          <Text type="secondary" style={{ display: "block", marginBottom: space[3] }}>
            Nothing is set for the day itself: its times and status are worked out from what the device recorded, as on any ordinary day. Only the leave is released.
          </Text>
        ) : mode === "STATUS" ? (
          <Form.Item name="status" label="The day should be" rules={[{ required: true, message: "Choose a status" }]}>
            <Select style={{ width: "100%", maxWidth: 360 }} options={adminApi.OVERRIDE_STATUS_OPTIONS} placeholder="Choose" />
          </Form.Item>
        ) : (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 180px))", gap: space[4] }}>
              <Form.Item name="inTime" label="Time in" rules={[{ pattern: TIME, message: "HH:MM, e.g. 10:00" }]}>
                <Input placeholder="10:00" inputMode="numeric" suffix={<ClockCircleOutlined aria-hidden />} />
              </Form.Item>
              <Form.Item name="outTime" label="Time out" rules={[{ pattern: TIME, message: "HH:MM, e.g. 19:00" }]}>
                <Input placeholder="19:00" inputMode="numeric" suffix={<ClockCircleOutlined aria-hidden />} />
              </Form.Item>
            </div>
            <Text type="secondary" style={{ display: "block", marginTop: -space[2], marginBottom: space[4], fontSize: fs.sm }}>
              Both replace the device's times for the day; one adds to them. A leave day or an already-corrected day needs both.
            </Text>
          </>
        )}
        <div style={{ border: `1px solid ${tk.borderControl}`, borderRadius: radius.md, padding: space[4], marginBottom: space[4], background: tk.bgSubtle }}>
          <div style={{ fontWeight: fw.semibold, color: tk.textPrimary, marginBottom: space[3] }}>Reason (kept in the audit log)</div>
          <Form.Item name="reasonCode" label="Why?">
            <Select style={{ width: "100%", maxWidth: 320 }} options={REASON_OPTIONS} />
          </Form.Item>
          <Form.Item name="note" label="Say what happened (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. worked at the client site that day" }]} style={{ marginBottom: 0 }}>
            <Input.TextArea rows={3} maxLength={500} showCount />
          </Form.Item>
        </div>
        <Form.Item name="releaseLeave" valuePropName="checked" extra="Only for a day that is on approved leave but the person actually worked. The leave for that day is released and its days go back to their balance, in the same step, with your reason. This can't be undone by removing the override; if it was a mistake, apply the leave again.">
          <Checkbox>They worked on a day of approved leave: release the leave and return the balance</Checkbox>
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={previewMutation.isPending}>
          Preview what will change
        </Button>
      </Form>

      {data && (
        <div style={{ display: "flex", flexDirection: "column", gap: space[4], marginTop: space[6], paddingTop: space[6], borderTop: `1px solid ${tk.borderDefault}` }}>
          <FormGroupTitle>Preview</FormGroupTitle>
          {data.count === 0 ? (
            <ApprovalBanner tone="warning" title="Nothing in that selection can be set." description="See why below, then change the dates, people or what to set." />
          ) : (
            <KeyValueGrid
              items={[
                { label: "Employee-days", value: data.count },
                { label: "People", value: data.employees },
                { label: "Will be set to", value: data.correction, wide: true },
              ]}
            />
          )}
          {data.leaveDaysReleased > 0 && (
            <ApprovalBanner tone="warning" title={`${data.leaveDaysReleased} day${data.leaveDaysReleased === 1 ? "" : "s"} of approved leave will be released and returned to leave balances.`} description="It appears in the leave ledger with your reason and in the attendance day. Confirming does both together." />
          )}
          {data.ownLeftOut > 0 && <ApprovalBanner tone="info" title={`${data.ownLeftOut} of your own days are left out.`} description="Nobody changes their own attendance. Another HR admin does those." />}
          {data.cannotOverride.length > 0 && (
            <div>
              <Text strong>Not set, and why</Text>
              <div style={{ marginTop: space[2], display: "flex", flexDirection: "column", gap: space[2] }}>
                {data.cannotOverride.map((g) => (
                  <div key={g.code} style={{ display: "flex", gap: space[2], alignItems: "baseline", flexWrap: "wrap" }}>
                    <StatusChip tone="warning">{g.count}</StatusChip>
                    <span>{g.label}</span>
                    <Text type="secondary" style={{ fontSize: fs.sm }}>
                      e.g. {g.examples.map((e) => `${e.name} ${dayjs(e.date).format("D MMM")}`).join(", ")}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.count > 0 && (
            <>
              <DataTable
                density="compact"
                rowKey={(r) => `${r.employeeId}|${r.date}`}
                dataSource={data.rows}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                mobile={{
                  title: (r) => `${r.name} (${r.employeeCode})`,
                  subtitle: (r) => dayjs(r.date).format("ddd, D MMM"),
                  fields: [
                    { label: "Now", render: (r) => r.before ?? "—" },
                    { label: "After", render: (r) => <Text strong>{r.after ?? "—"}</Text> },
                    { label: "Leave returned", render: (r) => (r.leave.length ? r.leave.map((l) => `${l.type} ${l.days}`).join(", ") : "—") },
                  ],
                }}
                columns={[
                  { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                  { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("ddd, D MMM") },
                  { title: "Now", dataIndex: "before", render: (v: string | null) => v ?? "—" },
                  { title: "After", dataIndex: "after", render: (v: string | null) => <Text strong>{v ?? "—"}</Text> },
                  { title: "Replaces", dataIndex: "replaces", render: (v: string | null) => (v ? <StatusChip tone="neutral">{v === "REGULARIZATION" ? "an approved request" : "an earlier override"}</StatusChip> : "—") },
                  { title: "Leave returned", key: "leave", render: (_, r) => (r.leave.length ? r.leave.map((l) => `${l.type} ${l.days}`).join(", ") : "—") },
                ]}
              />
              <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
                I have looked at these {data.count} employee-days{releaseLeave && data.leaveDaysReleased > 0 ? " and the leave that will be returned" : ""} and want them set.
              </Checkbox>
              <div>
                <Button type="primary" size="large" disabled={!looked} loading={confirm.isPending} onClick={() => confirm.mutate()}>
                  Set {data.count} employee-day{data.count === 1 ? "" : "s"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
