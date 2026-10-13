import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Form, Input, Modal, Radio, Select, Typography, message } from "antd";
import * as infoApi from "../../api/attendanceInfo";
import type { Eligibility, ReasonCode, TargetStatus } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";

const { Text } = Typography;
type Open = Extract<Eligibility, { ok: true }>;
type Values = { reasonCode: ReasonCode; mode: "TIMES" | "STATUS"; inTime?: string; outTime?: string; status?: TargetStatus; note?: string };
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t?: string) => (t ? t.trim().padStart(5, "0") : undefined);

/**
 * "Ask for a correction" (Phase 3 commit 1; Phase 2's forgot-to-punch request grew into this): for any
 * correctable day, a reason, a note, and either the right times or the right status. The employee's manager
 * (by grant) or HR decides; on approval the day is worked out again and marked as corrected by hand. The
 * device's punches never change.
 */
export function CorrectionModal({ date, day, open, onClose }: { date: string; day: Open["day"]; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<Values>();
  const queryClient = useQueryClient();
  const mode = Form.useWatch("mode", form) ?? "TIMES";
  const reasonCode = Form.useWatch("reasonCode", form) ?? "FORGOT_TO_PUNCH";
  const noPunches = day.punchCount === 0;
  const raise = useMutation({
    mutationFn: (v: Values) =>
      infoApi.raiseRegularization({
        date,
        reasonCode: v.reasonCode,
        note: v.note?.trim() || undefined,
        ...(v.mode === "STATUS" ? { status: v.status } : { inTime: pad(v.inTime), outTime: pad(v.outTime) }),
      }),
    onSuccess: () => {
      void message.success("Sent for approval. You'll be notified when it's decided.");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "info"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not send this request.")),
  });
  const timeRule = (required: boolean) => [{ required, message: "The time, e.g. 19:00" }, { pattern: TIME, message: "Use HH:MM, e.g. 19:00" }];
  return (
    <Modal title="Ask for a correction" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Send for approval" confirmLoading={raise.isPending} destroyOnHidden width={560}>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={
          noPunches
            ? `No punches were recorded on ${date}.`
            : `Recorded on ${date}: ${day.firstIn ?? "—"}${day.lastOut ? ` to ${day.lastOut}` : " (one punch)"}.`
        }
        description="Tell us what it should have been. Your manager or HR approves it; the device's own punches never change, and the corrected day is marked as such."
      />
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ reasonCode: "FORGOT_TO_PUNCH", mode: "TIMES" }}
        onFinish={(v) => {
          if (v.mode === "TIMES" && !v.inTime && !v.outTime) return void message.error("Give the time in, the time out, or both.");
          if (v.mode === "TIMES" && noPunches && !(v.inTime && v.outTime)) return void message.error("There are no punches that day, so give both the time in and the time out.");
          raise.mutate(v);
        }}
      >
        <Form.Item name="reasonCode" label="Why?">
          <Select options={infoApi.REASON_OPTIONS} />
        </Form.Item>
        <Form.Item name="mode" label="What should be corrected?">
          <Radio.Group options={[{ value: "TIMES", label: "The times" }, { value: "STATUS", label: "The day's status" }]} />
        </Form.Item>
        {mode === "TIMES" ? (
          <>
            <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
              {noPunches ? "Both times are needed." : "Give one time to add it to what the device recorded, or both to use them instead of the device's for the day."}
            </Text>
            <div style={{ display: "flex", gap: 16 }}>
              <Form.Item name="inTime" label="Time in" rules={timeRule(noPunches)}>
                <Input placeholder="e.g. 10:00" style={{ width: 140 }} inputMode="numeric" />
              </Form.Item>
              <Form.Item name="outTime" label="Time out" rules={timeRule(noPunches)}>
                <Input placeholder="e.g. 19:00" style={{ width: 140 }} inputMode="numeric" />
              </Form.Item>
            </div>
          </>
        ) : (
          <Form.Item name="status" label="The day should be" rules={[{ required: true, message: "Choose a status" }]}>
            <Select options={infoApi.STATUS_OPTIONS} placeholder="Choose" />
          </Form.Item>
        )}
        <Form.Item name="note" label={reasonCode === "OTHER" ? "What happened? (required)" : "Anything to add?"} rules={reasonCode === "OTHER" ? [{ required: true, min: 3, message: "A few words" }] : []}>
          <Input.TextArea rows={2} maxLength={500} placeholder="e.g. The device was off for the morning; I was in from 10" />
        </Form.Item>
        <Text type="secondary">One request per day. You can cancel it while it's waiting.</Text>
      </Form>
    </Modal>
  );
}
