import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select, Space } from "antd";
import { SendOutlined, TrophyOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import * as api from "../api";
import type { Badge, Nudge } from "../api";
import { RecipientSelect } from "../RecipientSelect";

const BADGE_FORM = "give-badge-form";
const NUDGE_FORM = "send-nudge-form";

// Employee portal → Recognition (D-29): the badges I received, my private nudges (only I, the sender and the directors can read them), and — when the
// directors' settings let me — giving a badge or sending a private nudge. A badge or nudge from the Wellsure Office shows as the workspace, not the person.
export function RecognitionPage() {
  const queryClient = useQueryClient();
  const bStatus = useQuery({ queryKey: ["recognition", "badge-status"], queryFn: api.badgeStatus });
  const nStatus = useQuery({ queryKey: ["recognition", "nudge-status"], queryFn: api.nudgeStatus });
  const badges = useQuery({ queryKey: ["recognition", "badges", "mine"], queryFn: api.myBadges });
  const nudges = useQuery({ queryKey: ["recognition", "nudges", "mine"], queryFn: api.myNudges });
  const given = useQuery({ queryKey: ["recognition", "badges", "given"], queryFn: api.givenBadges, enabled: Boolean(bStatus.data?.canGive) });
  const sent = useQuery({ queryKey: ["recognition", "nudges", "sent"], queryFn: api.sentNudges, enabled: Boolean(nStatus.data?.canSend) });
  const [giving, setGiving] = useState<string | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [badgeForm] = Form.useForm<{ recipientEmployeeId: string; badgeCode: string; message?: string }>();
  const [nudgeForm] = Form.useForm<{ recipientEmployeeId: string; body: string }>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["recognition"] });

  const give = useMutation({
    mutationFn: (values: { recipientEmployeeId: string; badgeCode: string; message?: string }) => api.giveBadge({ ...values, idempotencyKey: giving! }),
    onSuccess: () => { setGiving(null); badgeForm.resetFields(); refresh(); toast.success("Badge given."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't give the badge.")),
  });
  const send = useMutation({
    mutationFn: (values: { recipientEmployeeId: string; body: string }) => api.sendNudge({ ...values, idempotencyKey: sending! }),
    onSuccess: () => { setSending(null); nudgeForm.resetFields(); refresh(); toast.success("Sent. They are told only that something is waiting."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't send the nudge.")),
  });

  const actions = (
    <Space wrap size={space[2]}>
      {bStatus.data?.canGive && <Button type="primary" icon={<TrophyOutlined />} onClick={() => setGiving(api.newKey())}>Give a badge</Button>}
      {nStatus.data?.canSend && <Button icon={<SendOutlined />} onClick={() => setSending(api.newKey())}>Send a private nudge</Button>}
    </Space>
  );
  const badgeTitle = (b: Badge) => (
    <div>
      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{b.badge}</div>
      {b.message && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{b.message}</div>}
    </div>
  );
  const badgeState = (b: Badge) => (b.revoked ? <StatusChip tone="neutral">Revoked</StatusChip> : !b.active ? <StatusChip tone="neutral">Expired</StatusChip> : <StatusChip tone="success">Active</StatusChip>);

  return (
    <>
      <PageHeader title="Recognition" subtitle="Badges and private notes you have received" actions={actions} />
      <Stack>
        <Panel title="My badges">
          <DataTable<Badge>
            rowKey="id"
            loading={badges.isLoading}
            error={badges.error}
            onRetry={() => void badges.refetch()}
            dataSource={badges.data ?? []}
            pagination={false}
            empty={<EmptyState illustration="inbox" title="No badges yet" description={bStatus.data && !bStatus.data.active ? "Badges open once the directors set them up." : null} compact />}
            columns={[
              { title: "Badge", key: "b", render: (_: unknown, b) => badgeTitle(b) },
              { title: "From", dataIndex: "from" },
              { title: "Given", dataIndex: "givenAt", render: (d: string) => formatDate(d) },
              { title: "", key: "s", align: "right", render: (_: unknown, b) => badgeState(b) },
            ]}
            mobile={{ title: (b) => b.badge, subtitle: (b) => `${b.from ?? ""} · ${formatDate(b.givenAt)}`, status: badgeState }}
          />
        </Panel>
        <Panel title="Private nudges" subtitle="Only you, the sender and the directors can read these">
          <DataTable<Nudge>
            rowKey="id"
            loading={nudges.isLoading}
            error={nudges.error}
            onRetry={() => void nudges.refetch()}
            dataSource={nudges.data ?? []}
            pagination={false}
            empty={<EmptyState title="Nothing here" description={null} compact illustration={false} />}
            columns={[
              { title: "Note", dataIndex: "body", render: (t: string) => <span style={{ color: v.textBody, whiteSpace: "pre-wrap" }}>{t}</span> },
              { title: "From", dataIndex: "from" },
              { title: "Sent", dataIndex: "sentAt", render: (d: string) => formatDateTime(d) },
            ]}
            mobile={{ title: (n) => n.from, subtitle: (n) => formatDateTime(n.sentAt), fields: [{ label: "Note", render: (n) => <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span> }] }}
          />
        </Panel>
        {bStatus.data?.canGive && (
          <Panel title="Badges I gave">
            <DataTable<Badge>
              rowKey="id"
              loading={given.isLoading}
              dataSource={given.data ?? []}
              pagination={{ pageSize: 20 }}
              empty={<EmptyState title="None yet" description={null} compact illustration={false} />}
              columns={[
                { title: "Badge", key: "b", render: (_: unknown, b) => badgeTitle(b) },
                { title: "To", key: "to", render: (_: unknown, b) => (b.recipient ? `${b.recipient.name} (${b.recipient.employeeCode})` : "—") },
                { title: "Given", dataIndex: "givenAt", render: (d: string) => formatDate(d) },
                { title: "", key: "s", align: "right", render: (_: unknown, b) => badgeState(b) },
              ]}
              mobile={{ title: (b) => b.badge, subtitle: (b) => (b.recipient ? b.recipient.name : ""), status: badgeState }}
            />
          </Panel>
        )}
        {nStatus.data?.canSend && (
          <Panel title="Nudges I sent">
            <DataTable<Nudge>
              rowKey="id"
              loading={sent.isLoading}
              dataSource={sent.data ?? []}
              pagination={{ pageSize: 20 }}
              empty={<EmptyState title="None yet" description={null} compact illustration={false} />}
              columns={[
                { title: "To", key: "to", render: (_: unknown, n) => (n.recipient ? `${n.recipient.name} (${n.recipient.employeeCode})` : "—") },
                { title: "Note", dataIndex: "body", render: (t: string) => <span style={{ whiteSpace: "pre-wrap" }}>{t}</span> },
                { title: "Read", dataIndex: "readAt", render: (d: string | null) => (d ? formatDateTime(d) : "Not yet") },
              ]}
              mobile={{ title: (n) => (n.recipient ? n.recipient.name : ""), subtitle: (n) => (n.readAt ? "Read" : "Not read yet"), fields: [{ label: "Note", render: (n) => n.body }] }}
            />
          </Panel>
        )}
      </Stack>
      <SideDrawer open={giving !== null} onClose={() => setGiving(null)} title="Give a badge" formId={BADGE_FORM} primaryLabel="Give" primaryLoading={give.isPending}>
        <Form id={BADGE_FORM} form={badgeForm} layout="vertical" requiredMark onFinish={(values) => give.mutate(values)}>
          <Form.Item name="recipientEmployeeId" label="To" rules={[{ required: true }]}>
            <RecipientSelect fetcher={api.badgeRecipients} queryKey="badge-recipients" />
          </Form.Item>
          <Form.Item name="badgeCode" label="Badge" rules={[{ required: true }]}>
            <Select options={(bStatus.data?.catalogue ?? []).map((c) => ({ value: c.code, label: c.label }))} />
          </Form.Item>
          <Form.Item name="message" label="Message (optional)" rules={[{ max: 280 }]}>
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <SideDrawer open={sending !== null} onClose={() => setSending(null)} title="Send a private nudge" subtitle="Only they, you and the directors can read it. They are told only that something is waiting." formId={NUDGE_FORM} primaryLabel="Send" primaryLoading={send.isPending}>
        <Form id={NUDGE_FORM} form={nudgeForm} layout="vertical" requiredMark onFinish={(values) => send.mutate(values)}>
          <Form.Item name="recipientEmployeeId" label="To" rules={[{ required: true }]}>
            <RecipientSelect fetcher={api.nudgeRecipients} queryKey="nudge-recipients" />
          </Form.Item>
          <Form.Item name="body" label="Note" rules={[{ required: true, max: 2000 }]}>
            <Input.TextArea rows={5} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
