import dayjs from "dayjs";
import { ClockCircleOutlined } from "@ant-design/icons";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Form, Input, Radio, Select, Typography } from "antd";
import * as infoApi from "../../api/attendanceInfo";
import type { Eligibility, ReasonCode, TargetStatus } from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";
import { ApprovalBanner, SideDrawer, toast } from "../../ui";
import { space } from "../../theme/tokens";

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
      toast.success("Sent for approval. You'll be notified when it's decided.");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "info"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not send this request.")),
  });
  const timeRule = (required: boolean) => [{ required, message: "The time, e.g. 19:00" }, { pattern: TIME, message: "Use HH:MM, e.g. 19:00" }];
  return (
    <SideDrawer
      title="Ask for a correction"
      subtitle={dayjs(date).format("dddd, D MMM YYYY")}
      open={open}
      onClose={onClose}
      formId="att-correction-form"
      primaryLabel="Send for approval"
      primaryLoading={raise.isPending}
    >
      <ApprovalBanner
        tone="info"
        style={{ marginBottom: space[5] }}
        title={
          noPunches
            ? `No punches were recorded on ${dayjs(date).format("D MMM")}.`
            : `Recorded on ${dayjs(date).format("D MMM")}: ${day.firstIn ?? "—"}${day.lastOut ? ` to ${day.lastOut}` : " (one punch)"}.`
        }
        description="Tell us what it should have been. Your manager or HR approves it; the device's own punches never change, and the corrected day is marked as such."
      />
      <Form
        id="att-correction-form"
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ reasonCode: "FORGOT_TO_PUNCH", mode: "TIMES" }}
        onFinish={(v) => {
          if (v.mode === "TIMES" && !v.inTime && !v.outTime) return toast.error("Give the time in, the time out, or both.");
          if (v.mode === "TIMES" && noPunches && !(v.inTime && v.outTime)) return toast.error("There are no punches that day, so give both the time in and the time out.");
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
            <Text type="secondary" style={{ display: "block", marginBottom: space[2] }}>
              {noPunches ? "Both times are needed." : "Give one time to add it to what the device recorded, or both to use them instead of the device's for the day."}
            </Text>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: space[4] }}>
              <Form.Item name="inTime" label="Time in" rules={timeRule(noPunches)}>
                <Input placeholder="e.g. 10:00" inputMode="numeric" suffix={<ClockCircleOutlined aria-hidden />} />
              </Form.Item>
              <Form.Item name="outTime" label="Time out" rules={timeRule(noPunches)}>
                <Input placeholder="e.g. 19:00" inputMode="numeric" suffix={<ClockCircleOutlined aria-hidden />} />
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
    </SideDrawer>
  );
}
