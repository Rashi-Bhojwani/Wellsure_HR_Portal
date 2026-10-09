import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Alert, Form, Input, Modal, Radio, Typography, message } from "antd";
import * as infoApi from "../../api/attendanceInfo";
import { apiErrorMessage } from "../../lib/apiError";

const { Text } = Typography;

/**
 * "Forgot to punch?" (Phase 2 P2-E, regularization's first kind): the
 * employee gives the missing IN or OUT time and why. Their manager (by grant)
 * or HR decides; on approval the day is recomputed with that time.
 */
export function MissingPunchModal({ date, punchTime, open, onClose }: { date: string; punchTime: string; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ missing: "IN" | "OUT"; time: string; reason: string }>();
  const queryClient = useQueryClient();
  const missing = Form.useWatch("missing", form) ?? "OUT";
  const raise = useMutation({
    mutationFn: (v: { missing: "IN" | "OUT"; time: string; reason: string }) => infoApi.raiseRegularization({ date, ...v, time: v.time.trim().padStart(5, "0") }),
    onSuccess: () => {
      void message.success("Sent for approval. You'll be notified when it's decided.");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "info"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not send this request.")),
  });
  return (
    <Modal title="Forgot to punch?" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Send for approval" confirmLoading={raise.isPending} destroyOnHidden>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title={`Only one punch was recorded on ${date}: ${punchTime}.`} description="Tell us the time that's missing. Your manager or HR approves it, and the day is worked out again with that time." />
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ missing: "OUT" }} onFinish={(v) => raise.mutate(v)}>
        <Form.Item name="missing" label="What's missing?">
          <Radio.Group
            options={[
              { value: "OUT", label: `I forgot to punch out (${punchTime} was my arrival)` },
              { value: "IN", label: `I forgot to punch in (${punchTime} was when I left)` },
            ]}
          />
        </Form.Item>
        <Form.Item name="time" label={missing === "OUT" ? "When did you leave?" : "When did you arrive?"} rules={[{ required: true, message: "The time, e.g. 19:00" }, { pattern: /^([01]?\d|2[0-3]):[0-5]\d$/, message: "HH:MM, 24-hour, e.g. 19:00" }]}>
          <Input placeholder="e.g. 19:00" style={{ width: 140 }} inputMode="numeric" />
        </Form.Item>
        <Form.Item name="reason" label="What happened?" rules={[{ required: true, min: 3, message: "A few words, e.g. left with the team for the client visit" }]}>
          <Input.TextArea rows={2} maxLength={500} placeholder="e.g. Forgot to punch out, left at 7 pm with the team" />
        </Form.Item>
        <Text type="secondary">One request per day. You can cancel it while it's waiting.</Text>
      </Form>
    </Modal>
  );
}
