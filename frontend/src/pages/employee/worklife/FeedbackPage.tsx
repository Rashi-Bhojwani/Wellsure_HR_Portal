import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/feedback";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, space, v } from "../../../theme/tokens";
import { EmptyState, PageHeader, Panel, QueryState, SideDrawer, Stack, StatusChip, toast } from "../../../ui";

// M session block 2, SS-13: send feedback or a suggestion to HR. Without a name, nothing links it to you, so it cannot be answered and does not
// appear below.
export function FeedbackPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<{ category: api.FeedbackCategory; message: string; anonymous: boolean }>();
  const opts = useQuery({ queryKey: ["feedback", "options"], queryFn: api.feedbackOptions });
  const mine = useQuery({ queryKey: ["feedback", "mine"], queryFn: api.myFeedback });
  const send = useMutation({
    mutationFn: api.sendFeedback,
    onSuccess: (_, vals) => { toast.success(vals.anonymous ? "Sent without your name. Thank you." : "Sent. HR's replies appear here."); setOpen(false); void queryClient.invalidateQueries({ queryKey: ["feedback"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not send it.")),
  });
  return (
    <>
      <PageHeader title="Feedback" subtitle="Tell HR what works and what could be better." actions={<Button type="primary" icon={<PlusOutlined />} onClick={() => { form.resetFields(); form.setFieldsValue({ category: "SUGGESTION", anonymous: false }); setOpen(true); }}>Send feedback</Button>} />
      <QueryState isLoading={mine.isLoading} error={mine.error} onRetry={() => void mine.refetch()} isEmpty={(mine.data?.length ?? 0) === 0} empty={<EmptyState title="You have not sent feedback with your name" description="Feedback sent without a name is not listed here: nothing links it to you." />}>
        <Stack>
          {mine.data?.map((f) => (
            <Panel key={f.id} title={api.CATEGORY_LABEL[f.category]} subtitle={formatDate(f.createdAt)} extra={<StatusChip tone={f.status === "OPEN" ? "info" : "neutral"}>{f.status === "OPEN" ? "Open" : "Closed"}</StatusChip>}>
              <p style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{f.message}</p>
              {f.replies.map((r, i) => (
                <div key={i} style={{ borderLeft: `3px solid ${v.borderDefault}`, paddingLeft: space[3], marginTop: space[2] }}>
                  <div style={{ fontSize: fs.sm, color: v.textSecondary }}>HR · {formatDate(r.at)}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>
                </div>
              ))}
            </Panel>
          ))}
        </Stack>
      </QueryState>
      <SideDrawer open={open} title="Send feedback" onClose={() => setOpen(false)} formId="feedback-form" primaryLabel="Send" primaryLoading={send.isPending}>
        <Form id="feedback-form" form={form} layout="vertical" requiredMark={false} onFinish={(vals) => send.mutate({ ...vals, anonymous: !!vals.anonymous })}>
          <Form.Item name="category" label="Kind" rules={[{ required: true }]}><Select options={Object.entries(api.CATEGORY_LABEL).map(([value, label]) => ({ value, label }))} /></Form.Item>
          <Form.Item name="message" label="Your feedback" rules={[{ required: true, min: 5, message: "A few words" }]}><Input.TextArea rows={5} maxLength={2000} showCount /></Form.Item>
          {opts.data?.anonymousAllowed && (
            <Form.Item name="anonymous" valuePropName="checked" extra="Without your name, nothing links this feedback to you, and HR cannot reply.">
              <Checkbox>Send without my name</Checkbox>
            </Form.Item>
          )}
        </Form>
      </SideDrawer>
    </>
  );
}
