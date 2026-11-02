import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { AppstoreAddOutlined } from "@ant-design/icons";
import { OfficeGate } from "../../peeps/OfficeGate";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { space, v } from "../../../theme/tokens";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";
import * as api from "../api";
import type { Badge, Nudge } from "../api";

const person = (p: { name: string; employeeCode: string } | null | undefined) => (p ? `${p.name} (${p.employeeCode})` : "—");

// Wellsure Office → Recognition (directors, D-28, D-36, D-37): every badge (revoke one with a reason; load the starter catalogue for a second director to
// confirm) and every corrective note. Opening this page writes an audit entry for each note that is not the director's own.
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
  const nudges = useQuery({ queryKey: ["recognition", "admin", "nudges"], queryFn: api.allNudges });
  const [revoking, setRevoking] = useState<Badge | null>(null);
  const [reason, setReason] = useState("");
  const revoke = useMutation({
    mutationFn: () => api.revokeBadge(revoking!.id, reason.trim()),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["recognition"] });
      toast.success("Badge revoked. The reason is in the audit log.");
      setRevoking(null);
      setReason("");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't revoke the badge.")),
  });
  const starter = useMutation({
    mutationFn: api.loadStarterCatalogue,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["peeps", "settings"] });
      toast.success("Starter catalogue entered. Edit it in Peeps settings; a different director confirms it.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't load the starter catalogue.")),
  });
  const badgeState = (b: Badge) => (b.revoked ? <StatusChip tone="neutral">Revoked</StatusChip> : b.active ? <StatusChip tone="success">Active</StatusChip> : <StatusChip tone="neutral">Expired</StatusChip>);
  const badgeActions = (b: Badge) => (b.active && !b.revoked ? <Button size="small" danger onClick={() => setRevoking(b)}>Revoke</Button> : null);
  return (
    <>
      <PageHeader
        title="Recognition"
        subtitle="Every badge and every corrective note"
        actions={
          <Button icon={<AppstoreAddOutlined />} loading={starter.isPending} onClick={() => starter.mutate()}>
            Load starter catalogue
          </Button>
        }
      />
      <Stack>
        <ApprovalBanner tone="info" title="Opening notes is recorded" description="Each corrective note shown here that is not your own is written to the audit log with your name and the time. The starter catalogue is never loaded on its own: this button enters it for you to edit, and a different director confirms it." />
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
              { title: "Given", dataIndex: "givenAt", render: (d: string) => formatDate(d) },
              { title: "Until", dataIndex: "expiresAt", render: (d: string | null) => (d ? formatDate(d) : "Permanent") },
              { title: "", key: "s", align: "right", render: (_: unknown, b) => <span style={{ display: "inline-flex", gap: space[2], alignItems: "center" }}>{badgeState(b)}{badgeActions(b)}</span> },
            ]}
            mobile={{ title: (b) => b.badge, subtitle: (b) => person(b.recipient), status: badgeState, actions: badgeActions }}
          />
        </Panel>
        <Panel title="Corrective notes">
          <DataTable<Nudge>
            rowKey="id"
            loading={nudges.isLoading}
            error={nudges.error}
            onRetry={() => void nudges.refetch()}
            dataSource={nudges.data ?? []}
            pagination={{ pageSize: 20 }}
            empty={<EmptyState title="No corrective notes" description={null} compact illustration={false} />}
            columns={[
              { title: "To", key: "to", render: (_: unknown, n) => person(n.recipient) },
              { title: "From", dataIndex: "from" },
              { title: "Note", dataIndex: "body", render: (t: string) => <span style={{ color: v.textBody, whiteSpace: "pre-wrap" }}>{t}</span> },
              { title: "Sent", dataIndex: "sentAt", render: (d: string) => formatDateTime(d) },
              { title: "", key: "s", align: "right", render: (_: unknown, n) => (n.withdrawn ? <StatusChip tone="neutral">Withdrawn</StatusChip> : n.readAt ? <StatusChip tone="success">Read</StatusChip> : <StatusChip tone="warning">Unread</StatusChip>) },
            ]}
            mobile={{ title: (n) => person(n.recipient), subtitle: (n) => `${n.from} · ${formatDateTime(n.sentAt)}`, fields: [{ label: "Note", render: (n) => n.body }] }}
          />
        </Panel>
      </Stack>
      <ConfirmModal
        open={revoking !== null}
        onCancel={() => setRevoking(null)}
        onConfirm={() => revoke.mutate()}
        title="Revoke this badge?"
        info="It disappears from profiles, the directory and the home page. Your reason is kept in the audit log."
        confirmLabel="Revoke"
        danger
        loading={revoke.isPending}
        confirmDisabled={reason.trim().length < 3}
      >
        <label htmlFor="badge-revoke-reason" style={{ display: "block", marginBottom: space[2], color: v.textBody }}>
          Why is it being revoked?
        </label>
        <Input.TextArea id="badge-revoke-reason" rows={3} maxLength={500} showCount value={reason} onChange={(e) => setReason(e.target.value)} />
      </ConfirmModal>
    </>
  );
}
