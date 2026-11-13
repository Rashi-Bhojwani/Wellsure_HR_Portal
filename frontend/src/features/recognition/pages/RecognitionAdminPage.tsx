import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { OfficeGate } from "../../peeps/OfficeGate";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";
import * as api from "../api";
import type { Badge, Note, NudgeTag } from "../api";

const person = (p: { name: string; employeeCode: string } | null | undefined) => (p ? `${p.name} (${p.employeeCode})` : "—");

type Pending = { kind: "revoke"; badge: Badge } | { kind: "remove"; tag: NudgeTag } | { kind: "decide-remove"; tag: NudgeTag } | null;

// Wellsure Office → Recognition (directors, D-28, Peeps Stage 3): every badge (revoke one with a reason), every nudge tag (remove one at once with a
// reason; decide the reviews receivers asked for) and the old corrective notes, read-only. Opening this page writes an audit entry for each note that
// is not about the director. Catalogues, limits and off-limits words are in Peeps settings.
export function RecognitionAdminPage() {
  return (
    <OfficeGate title="Recognition" need="director">
      <RecognitionAdminPageInner />
    </OfficeGate>
  );
}

function RecognitionAdminPageInner() {
  const queryClient = useQueryClient();
  const badges = useQuery({ queryKey: ["recognition", "admin", "badges"], queryFn: api.allBadges });
  const tags = useQuery({ queryKey: ["recognition", "admin", "nudges"], queryFn: api.allNudges });
  const notes = useQuery({ queryKey: ["recognition", "admin", "notes"], queryFn: api.allNotes });
  const [pending, setPending] = useState<Pending>(null);
  const [reason, setReason] = useState("");
  const done = (msg: string) => {
    void queryClient.invalidateQueries({ queryKey: ["recognition"] });
    toast.success(msg);
    setPending(null);
    setReason("");
  };
  const act = useMutation({
    mutationFn: async () => {
      if (!pending) return;
      if (pending.kind === "revoke") await api.revokeBadge(pending.badge.id, reason.trim());
      else if (pending.kind === "remove") await api.removeNudge(pending.tag.id, reason.trim());
      else await api.decideNudgeReview(pending.tag.id, "REMOVED", reason.trim());
    },
    onSuccess: () => done("Done. The reason is in the audit log."),
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't do that.")),
  });
  const keep = useMutation({
    mutationFn: (t: NudgeTag) => api.decideNudgeReview(t.id, "KEPT"),
    onSuccess: () => done("Kept. The receiver is told the review is decided."),
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't decide the review.")),
  });
  const badgeState = (b: Badge) => (b.revoked ? <StatusChip tone="neutral">Revoked</StatusChip> : b.active ? <StatusChip tone="success">Active</StatusChip> : <StatusChip tone="neutral">Expired</StatusChip>);
  const badgeActions = (b: Badge) => (b.active && !b.revoked ? <Button size="small" danger onClick={() => setPending({ kind: "revoke", badge: b })}>Revoke</Button> : null);
  const openReview = (t: NudgeTag) => Boolean(t.review && !t.review.outcome && !t.removed);
  const tagState = (t: NudgeTag) => (t.removed ? <StatusChip tone="neutral">Removed</StatusChip> : openReview(t) ? <StatusChip tone="warning">Review asked</StatusChip> : t.active ? <StatusChip tone="purple">This week</StatusChip> : <StatusChip tone="neutral">Ended</StatusChip>);
  const tagActions = (t: NudgeTag) =>
    openReview(t) ? (
      <span style={{ display: "inline-flex", gap: space[2], flexWrap: "wrap" }}>
        <Button size="small" loading={keep.isPending} onClick={() => keep.mutate(t)}>Keep</Button>
        <Button size="small" danger onClick={() => setPending({ kind: "decide-remove", tag: t })}>Remove</Button>
      </span>
    ) : t.active && !t.removed ? (
      <Button size="small" danger onClick={() => setPending({ kind: "remove", tag: t })}>Remove</Button>
    ) : null;
  const reviews = (tags.data ?? []).filter(openReview);
  const title = pending?.kind === "revoke" ? "Revoke this badge?" : "Remove this nudge?";
  return (
    <>
      <PageHeader title="Recognition" subtitle="Every badge, every nudge, and the earlier private notes (read-only)" />
      <Stack>
        <ApprovalBanner tone="info" title="Opening notes is recorded" description="Each earlier private note shown here that is not about you is written to the audit log with your name and the time. No new private notes can be sent." />
        {reviews.length > 0 && (
          <Panel title="Reviews asked for" subtitle="Keep the nudge, or remove it with a reason">
            <DataTable<NudgeTag>
              rowKey="id"
              dataSource={reviews}
              pagination={false}
              columns={[
                { title: "Nudge", dataIndex: "tag" },
                { title: "To", key: "to", render: (_: unknown, t) => person(t.recipient) },
                { title: "From", dataIndex: "from" },
                { title: "Asked", key: "a", render: (_: unknown, t) => formatDateTime(t.review!.requestedAt) },
                { title: "", key: "x", align: "right", render: (_: unknown, t) => tagActions(t) },
              ]}
              mobile={{ title: (t) => t.tag, subtitle: (t) => person(t.recipient), actions: tagActions }}
            />
          </Panel>
        )}
        <Panel title="Badges and cheers">
          <DataTable<Badge>
            rowKey="id"
            loading={badges.isLoading}
            error={badges.error}
            onRetry={() => void badges.refetch()}
            dataSource={badges.data ?? []}
            pagination={{ pageSize: 20 }}
            empty={<EmptyState title="No badges yet" description={null} compact illustration={false} />}
            columns={[
              { title: "Badge", dataIndex: "badge" },
              { title: "To", key: "to", render: (_: unknown, b) => person(b.recipient) },
              { title: "From", dataIndex: "from" },
              { title: "Why", dataIndex: "message", render: (m: string | null) => <span style={{ color: v.textBody }}>{m ?? ""}</span> },
              { title: "Until", dataIndex: "expiresAt", render: (d: string | null) => (d ? formatDate(d) : "Permanent") },
              { title: "", key: "s", align: "right", render: (_: unknown, b) => <span style={{ display: "inline-flex", gap: space[2], alignItems: "center" }}>{badgeState(b)}{badgeActions(b)}</span> },
            ]}
            mobile={{ title: (b) => b.badge, subtitle: (b) => person(b.recipient), status: badgeState, actions: badgeActions }}
          />
        </Panel>
        <Panel title="Nudges">
          <DataTable<NudgeTag>
            rowKey="id"
            loading={tags.isLoading}
            error={tags.error}
            onRetry={() => void tags.refetch()}
            dataSource={tags.data ?? []}
            pagination={{ pageSize: 20 }}
            empty={<EmptyState title="No nudges yet" description="Give one from Recognition. Tags and off-limits words are in Peeps settings." compact illustration={false} />}
            columns={[
              { title: "Nudge", dataIndex: "tag" },
              { title: "To", key: "to", render: (_: unknown, t) => person(t.recipient) },
              { title: "From", dataIndex: "from" },
              { title: "Until", dataIndex: "expiresAt", render: (d: string) => formatDate(d) },
              { title: "", key: "s", align: "right", render: (_: unknown, t) => <span style={{ display: "inline-flex", gap: space[2], alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>{tagState(t)}{tagActions(t)}</span> },
            ]}
            mobile={{ title: (t) => t.tag, subtitle: (t) => person(t.recipient), status: tagState, actions: tagActions }}
          />
        </Panel>
        <Panel title="Earlier private notes (read-only)">
          <DataTable<Note>
            rowKey="id"
            loading={notes.isLoading}
            error={notes.error}
            onRetry={() => void notes.refetch()}
            dataSource={notes.data?.notes ?? []}
            pagination={{ pageSize: 20 }}
            empty={<EmptyState title="No earlier notes" description={null} compact illustration={false} />}
            columns={[
              { title: "To", key: "to", render: (_: unknown, n) => person(n.recipient) },
              { title: "From", dataIndex: "from" },
              { title: "Note", dataIndex: "body", render: (t: string) => <span style={{ color: v.textBody, whiteSpace: "pre-wrap" }}>{t}</span> },
              { title: "Sent", dataIndex: "sentAt", render: (d: string) => formatDateTime(d) },
            ]}
            mobile={{ title: (n) => person(n.recipient), subtitle: (n) => `${n.from} · ${formatDateTime(n.sentAt)}`, fields: [{ label: "Note", render: (n) => n.body }] }}
          />
        </Panel>
      </Stack>
      <ConfirmModal
        open={pending !== null}
        onCancel={() => setPending(null)}
        onConfirm={() => act.mutate()}
        title={title}
        info="It disappears from profiles, the directory and the home page at once. Your reason is kept in the audit log."
        confirmLabel={pending?.kind === "revoke" ? "Revoke" : "Remove"}
        danger
        loading={act.isPending}
        confirmDisabled={reason.trim().length < 3}
      >
        <label htmlFor="recognition-reason" style={{ display: "block", marginBottom: space[2], color: v.textBody }}>
          Why?
        </label>
        <Input.TextArea id="recognition-reason" rows={3} maxLength={500} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
