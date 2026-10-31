import { useQuery } from "@tanstack/react-query";
import { OfficeGate } from "../../peeps/OfficeGate";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, PageHeader, Panel, Stack, StatusChip } from "../../../ui";
import * as api from "../api";
import type { Badge, Nudge } from "../api";

const person = (p: { name: string; employeeCode: string } | null | undefined) => (p ? `${p.name} (${p.employeeCode})` : "—");

// Wellsure Office → Recognition (directors, D-28): every badge and every private nudge. Opening this page writes an audit entry for each nudge that is
// not the director's own.
export function RecognitionAdminPage() {
  return (
    <OfficeGate title="Recognition" need="director">
      <RecognitionAdminPageInner />
    </OfficeGate>
  );
}

function RecognitionAdminPageInner() {
  const badges = useQuery({ queryKey: ["recognition", "admin", "badges"], queryFn: api.allBadges });
  const nudges = useQuery({ queryKey: ["recognition", "admin", "nudges"], queryFn: api.allNudges });
  return (
    <>
      <PageHeader title="Recognition" subtitle="Every badge and every private nudge" />
      <Stack>
        <ApprovalBanner tone="info" title="Opening nudges is recorded" description="Each private nudge shown here that is not your own is written to the audit log with your name and the time." />
        <Panel title="Private nudges">
          <DataTable<Nudge>
            rowKey="id"
            loading={nudges.isLoading}
            error={nudges.error}
            onRetry={() => void nudges.refetch()}
            dataSource={nudges.data ?? []}
            pagination={{ pageSize: 20 }}
            empty={<EmptyState title="No nudges yet" description={null} compact illustration={false} />}
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
        <Panel title="Badges">
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
              { title: "", key: "s", align: "right", render: (_: unknown, b) => (b.revoked ? <StatusChip tone="neutral">Revoked</StatusChip> : b.active ? <StatusChip tone="success">Active</StatusChip> : <StatusChip tone="neutral">Expired</StatusChip>) },
            ]}
            mobile={{ title: (b) => b.badge, subtitle: (b) => person(b.recipient) }}
          />
        </Panel>
      </Stack>
    </>
  );
}
