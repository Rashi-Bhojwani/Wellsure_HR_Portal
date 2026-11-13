import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select, Space } from "antd";
import { SmileOutlined, TrophyOutlined } from "@ant-design/icons";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import * as api from "../api";
import type { Badge, Note, NudgeTag } from "../api";
import { RecipientSelect } from "../RecipientSelect";
import { BADGE_DURATION_LABELS } from "@shared/constants/peeps";

const BADGE_FORM = "give-badge-form";
const NUDGE_FORM = "give-nudge-form";

// Employee portal → Recognition (Peeps Stage 3): the badges I received, with who gave each and why; giving a badge along my reporting line (a reason
// is required); the nudge tags I received this week and before, with who gave each, and asking the directors to review one; and the old private notes
// about me, read-only. A director also gives nudge tags here.
export function RecognitionPage() {
  const queryClient = useQueryClient();
  const bStatus = useQuery({ queryKey: ["recognition", "badge-status"], queryFn: api.badgeStatus });
  const nStatus = useQuery({ queryKey: ["recognition", "nudge-status"], queryFn: api.nudgeStatus });
  const badges = useQuery({ queryKey: ["recognition", "badges", "mine"], queryFn: api.myBadges });
  const tags = useQuery({ queryKey: ["recognition", "nudges", "mine"], queryFn: api.myNudges });
  const notes = useQuery({ queryKey: ["recognition", "notes", "mine"], queryFn: api.myNotes });
  const given = useQuery({ queryKey: ["recognition", "badges", "given"], queryFn: api.givenBadges, enabled: Boolean(bStatus.data?.canGive) });
  const [giving, setGiving] = useState<string | null>(null);
  const [tagging, setTagging] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<NudgeTag | null>(null);
  const [badgeForm] = Form.useForm<{ recipientEmployeeId: string; badgeCode: string; message: string }>();
  const [nudgeForm] = Form.useForm<{ recipientEmployeeId: string; tagCode: string }>();
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["recognition"] });

  const give = useMutation({
    mutationFn: (values: { recipientEmployeeId: string; badgeCode: string; message: string }) => api.giveBadge({ ...values, idempotencyKey: giving! }),
    onSuccess: () => { setGiving(null); badgeForm.resetFields(); refresh(); toast.success("Badge given."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't give the badge.")),
  });
  const tag = useMutation({
    mutationFn: (values: { recipientEmployeeId: string; tagCode: string }) => api.giveNudge({ ...values, idempotencyKey: tagging! }),
    onSuccess: () => { setTagging(null); nudgeForm.resetFields(); refresh(); toast.success("Nudge given. It shows for a week."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't give the nudge.")),
  });
  const review = useMutation({
    mutationFn: () => api.requestNudgeReview(reviewing!.id),
    onSuccess: () => { setReviewing(null); refresh(); toast.success("Sent to the directors to review."); },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't ask for a review.")),
  });

  const actions = (
    <Space wrap size={space[2]}>
      {bStatus.data?.canGive && <Button type="primary" icon={<TrophyOutlined />} onClick={() => setGiving(api.newKey())}>Give a badge</Button>}
      {nStatus.data?.canGive && <Button icon={<SmileOutlined />} onClick={() => setTagging(api.newKey())}>Give a nudge</Button>}
    </Space>
  );
  const badgeTitle = (b: Badge) => (
    <div>
      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{b.badge}</div>
      {b.message && <div style={{ color: v.textSecondary, fontSize: fs.sm }}>{b.message}</div>}
    </div>
  );
  const badgeState = (b: Badge) => (b.revoked ? <StatusChip tone="neutral">Revoked</StatusChip> : !b.active ? <StatusChip tone="neutral">Expired</StatusChip> : <StatusChip tone="success">Active</StatusChip>);
  const tagState = (t: NudgeTag) =>
    t.removed ? <StatusChip tone="neutral">Removed</StatusChip> : !t.active ? <StatusChip tone="neutral">Ended</StatusChip> : t.review && !t.review.outcome ? <StatusChip tone="warning">Review asked</StatusChip> : t.review?.outcome === "KEPT" ? <StatusChip tone="info">Reviewed: kept</StatusChip> : <StatusChip tone="purple">This week</StatusChip>;
  const tagAction = (t: NudgeTag) => (t.active && !t.review ? <Button size="small" onClick={() => setReviewing(t)}>Ask for a review</Button> : null);
  const noteList = notes.data?.notes ?? [];

  return (
    <>
      <PageHeader title="Recognition" subtitle="Badges and nudges you have received" actions={actions} />
      <Stack>
        <Panel title="My badges" subtitle="Who gave each, and why">
          <DataTable<Badge>
            rowKey="id"
            loading={badges.isLoading}
            error={badges.error}
            onRetry={() => void badges.refetch()}
            dataSource={badges.data ?? []}
            pagination={false}
            empty={<EmptyState illustration="inbox" title="No badges yet" description="When someone along your reporting line gives you a badge, it shows here." compact />}
            columns={[
              { title: "Badge", key: "b", render: (_: unknown, b) => badgeTitle(b) },
              { title: "From", dataIndex: "from" },
              { title: "Given", dataIndex: "givenAt", render: (d: string) => formatDate(d) },
              { title: "", key: "s", align: "right", render: (_: unknown, b) => badgeState(b) },
            ]}
            mobile={{ title: (b) => b.badge, subtitle: (b) => `${b.from ?? ""} · ${formatDate(b.givenAt)}`, status: badgeState, fields: [{ label: "Why", render: (b) => b.message ?? "" }] }}
          />
        </Panel>
        <Panel title="My nudges" subtitle="Light-hearted tags from the directors. Each shows for a week; you always see who gave it.">
          <DataTable<NudgeTag>
            rowKey="id"
            loading={tags.isLoading}
            error={tags.error}
            onRetry={() => void tags.refetch()}
            dataSource={tags.data ?? []}
            pagination={false}
            empty={<EmptyState title="No nudges" description={null} compact illustration={false} />}
            columns={[
              { title: "Nudge", dataIndex: "tag", render: (t: string) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{t}</span> },
              { title: "From", dataIndex: "from" },
              { title: "Until", dataIndex: "expiresAt", render: (d: string) => formatDate(d) },
              { title: "", key: "s", align: "right", render: (_: unknown, t) => <span style={{ display: "inline-flex", gap: space[2], alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>{tagState(t)}{tagAction(t)}</span> },
            ]}
            mobile={{ title: (t) => t.tag, subtitle: (t) => `${t.from} · until ${formatDate(t.expiresAt)}`, status: tagState, actions: tagAction }}
          />
        </Panel>
        {noteList.length > 0 && (
          <Panel title="Earlier private notes" subtitle="Read-only: no new notes are sent. Only you and the directors can read these.">
            <DataTable<Note>
              rowKey="id"
              dataSource={noteList}
              pagination={false}
              columns={[
                { title: "Note", dataIndex: "body", render: (t: string) => <span style={{ color: v.textBody, whiteSpace: "pre-wrap" }}>{t}</span> },
                { title: "From", dataIndex: "from" },
                { title: "Sent", dataIndex: "sentAt", render: (d: string) => formatDateTime(d) },
              ]}
              mobile={{ title: (n) => n.from, subtitle: (n) => formatDateTime(n.sentAt), fields: [{ label: "Note", render: (n) => <span style={{ whiteSpace: "pre-wrap" }}>{n.body}</span> }] }}
            />
          </Panel>
        )}
        {bStatus.data?.canGive && (
          <Panel title="Badges I gave">
            <DataTable<Badge>
              rowKey="id"
              loading={given.isLoading}
              error={given.error}
              onRetry={() => void given.refetch()}
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
      </Stack>
      <SideDrawer open={giving !== null} onClose={() => setGiving(null)} title="Give a badge" subtitle="Along your reporting line: to people below you, or up to your manager and on to the directors." formId={BADGE_FORM} primaryLabel="Give" primaryLoading={give.isPending}>
        <Form id={BADGE_FORM} form={badgeForm} layout="vertical" requiredMark onFinish={(values) => give.mutate(values)}>
          <Form.Item name="recipientEmployeeId" label="To" rules={[{ required: true, message: "Choose who it is for." }]}>
            <RecipientSelect fetcher={api.badgeRecipients} queryKey="badge-recipients" />
          </Form.Item>
          <Form.Item name="badgeCode" label="Badge" rules={[{ required: true, message: "Choose a badge." }]}>
            <Select options={(bStatus.data?.catalogue ?? []).map((c) => ({ value: c.code, label: `${c.label} · ${BADGE_DURATION_LABELS[c.duration].toLowerCase()}` }))} />
          </Form.Item>
          <Form.Item name="message" label="Why" rules={[{ required: true, whitespace: true, min: 3, message: "Say why (at least 3 characters)." }, { max: 280 }]}>
            <Input.TextArea rows={2} showCount maxLength={280} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <SideDrawer open={tagging !== null} onClose={() => setTagging(null)} title="Give a nudge" subtitle="A light-hearted tag, shown to everyone for a week. No free text." formId={NUDGE_FORM} primaryLabel="Give" primaryLoading={tag.isPending}>
        <Form id={NUDGE_FORM} form={nudgeForm} layout="vertical" requiredMark onFinish={(values) => tag.mutate(values)}>
          <Form.Item name="recipientEmployeeId" label="To" rules={[{ required: true, message: "Choose who it is for." }]}>
            <RecipientSelect fetcher={api.nudgeRecipients} queryKey="nudge-recipients" />
          </Form.Item>
          <Form.Item name="tagCode" label="Nudge" rules={[{ required: true, message: "Choose a nudge." }]}>
            <Select options={(nStatus.data?.tags ?? []).map((t) => ({ value: t.code, label: t.label }))} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal
        open={reviewing !== null}
        onCancel={() => setReviewing(null)}
        onConfirm={() => review.mutate()}
        title="Ask the directors to review this nudge?"
        info="The directors are told a review was asked for; they keep it or remove it."
        confirmLabel="Ask for a review"
        loading={review.isPending}
      />
    </>
  );
}
