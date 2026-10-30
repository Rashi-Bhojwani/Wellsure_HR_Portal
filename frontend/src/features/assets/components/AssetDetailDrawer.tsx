import { useQuery } from "@tanstack/react-query";
import { Button, Space } from "antd";
import { ASSET_EVENT_LABELS, type AssetEventKind } from "@shared/constants/assets";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { EmptyState, KeyValueGrid, QueryState, SideDrawer, SkeletonCard, StatusChip, Timeline } from "../../../ui";
import * as assetsApi from "../api";
import { isHidden, type AssetDetail, type AssetEventView } from "../api";
import { holderText } from "../helpers";
import type { AssetAction } from "../helpers";

const ENDED = { RETURNED: "returned", REASSIGNED: "transferred", LOST: "reported lost" } as const;
const TONE: Partial<Record<AssetEventKind, "accent" | "neutral" | "danger" | "warning" | "info">> = { ISSUED: "accent", REASSIGNED: "info", RETURNED: "neutral", ACKNOWLEDGED: "accent", LOST: "danger", DAMAGED: "warning" };

function eventSentence(e: AssetEventView) {
  const label = ASSET_EVENT_LABELS[e.kind as AssetEventKind] ?? e.kind;
  return (
    <span>
      <strong style={{ fontWeight: fw.semibold }}>{label}</strong>
      {e.holder && ` — ${holderText(e.holder)}`}
      {e.condition && ` · condition: ${e.condition.label}`}
      {e.status && ` · status: ${e.status.label}`}
      {e.note && <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 2 }}>{e.note}</div>}
    </span>
  );
}

// One asset: details, who holds it, and its full history (the event log, newest first). Actions are offered only to people who may manage the register,
// and only those the asset's state allows; the server checks again.
export function AssetDetailDrawer({ assetId, canManage, ready, onClose, onAction }: { assetId: string | null; canManage: boolean; ready: boolean; onClose: () => void; onAction: (a: AssetAction, asset: AssetDetail) => void }) {
  const { data: asset, isLoading, error, refetch } = useQuery({ queryKey: ["assets", "detail", assetId], queryFn: () => assetsApi.getAsset(assetId!), enabled: assetId !== null });
  const held = Boolean(asset?.openAssignmentId);
  const act = (a: AssetAction, label: string, opts: { danger?: boolean; primary?: boolean } = {}) =>
    asset && (
      <Button key={a} type={opts.primary ? "primary" : "default"} danger={opts.danger} onClick={() => onAction(a, asset)}>
        {label}
      </Button>
    );
  const actions =
    asset && canManage && ready ? (
      <Space wrap size={space[2]}>
        {!held && asset.status.issuable && act("issue", "Issue", { primary: true })}
        {held && asset.holder && !isHidden(asset.holder) && act("return", "Take back", { primary: true })}
        {held && act("transfer", "Transfer")}
        {act("damaged", "Record damage")}
        {act("lost", "Report lost", { danger: true })}
        {act("edit", "Edit details")}
      </Space>
    ) : null;

  return (
    <SideDrawer
      open={assetId !== null}
      onClose={onClose}
      size="wide"
      title={asset ? asset.name : "Asset"}
      subtitle={asset?.assetId}
      status={asset ? <StatusChip tone={asset.status.issuable ? "success" : "neutral"}>{asset.status.label}</StatusChip> : undefined}
      footer={null}
    >
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonCard />}>
        {asset && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[6] }}>
            {actions}
            <KeyValueGrid
              items={[
                { label: "Asset ID", value: asset.assetId },
                { label: "Category", value: asset.category.label },
                { label: "Held by", value: holderText(asset.holder) },
                { label: "Receipt", value: asset.acknowledged === null ? "—" : asset.acknowledged ? "Acknowledged" : "Waiting for the holder" },
                { label: "Serial number", value: asset.serialNumber ?? "—" },
                { label: "Model", value: asset.model ?? "—" },
                { label: "Added", value: formatDate(asset.createdAt) },
                { label: "Notes", value: asset.notes ?? "—", wide: true },
              ]}
            />
            <section aria-label="Assignments">
              <h3 style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, margin: `0 0 ${space[3]}px` }}>Assignments</h3>
              {asset.assignments.length === 0 ? (
                <EmptyState title="Never issued" description={null} illustration={false} compact />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
                  {asset.assignments.map((a) => (
                    <li key={a.id} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.sm, padding: space[3], color: v.textBody, fontSize: fs.md }}>
                      <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{holderText(a.holder)}</div>
                      <div style={{ color: v.textSecondary, fontSize: fs.sm }}>
                        {formatDate(a.issuedAt)} → {a.endedAt ? formatDate(a.endedAt) : "now"} · issued {a.issueCondition.label}
                        {a.returnCondition ? ` · returned ${a.returnCondition.label}` : ""}
                        {a.endReason ? ` · ${ENDED[a.endReason]}` : ""}
                        {a.acknowledgedAt ? ` · acknowledged ${formatDate(a.acknowledgedAt)}` : a.endedAt ? "" : " · not yet acknowledged"}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section aria-label="History">
              <h3 style={{ fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary, margin: `0 0 ${space[3]}px` }}>History</h3>
              <Timeline
                items={asset.events.map((e) => ({
                  key: e.id,
                  tone: TONE[e.kind as AssetEventKind] ?? "neutral",
                  content: eventSentence(e),
                  time: `${formatDateTime(e.at)}${e.actorName ? ` · ${e.actorName}` : ""}`,
                }))}
              />
            </section>
          </div>
        )}
      </QueryState>
    </SideDrawer>
  );
}
