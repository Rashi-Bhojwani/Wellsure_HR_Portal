import { memo, useMemo, useState, useTransition } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Card, Empty, Input, Space, Spin, Typography, theme } from "antd";
import { MinusSquareOutlined, PlusSquareOutlined } from "@ant-design/icons";
import { getOrgChart, photoUrl, type OrgChart as OrgChartData, type OrgChartNode } from "../../../api/people";
import { EmptyState } from "../../../components/common/EmptyState";
import { usePhotoToken } from "../../../hooks/usePhotoToken";
import { useAuth } from "../../../hooks/useAuth";
import { fs } from "../../../theme/tokens";

// The company org chart: Admin (the Super Admins) → Managers and HR Admins →
// teams (the three-level structure, hierarchy model A — E2). The whole company arrives
// in one compact, gzipped payload, but a team's cards are only mounted once
// its manager is expanded — managers start collapsed.
//
// Performance at ~500 people (measured, see docs/PROGRESS.md): cards are
// deliberately plain memoised elements — CSS ellipsis instead of AntD
// Typography's measured ellipsis, one shared photo token passed down instead
// of a query hook per card — and expand/collapse run inside startTransition,
// so even "Expand all" renders in interruptible slices instead of one long
// main-thread block.

interface Palette {
  cardBg: string;
  border: string;
  primary: string;
  text: string;
  textSecondary: string;
  line: string;
  tagBg: string;
}

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "")).toUpperCase();
}

const OrgCard = memo(function OrgCard({
  node,
  subtitle,
  photoToken,
  palette,
  onOpen,
  highlighted,
  reportCount,
}: {
  node: OrgChartNode;
  subtitle: string;
  photoToken: string | undefined;
  palette: Palette;
  onOpen: (id: string) => void;
  highlighted: boolean;
  reportCount: number;
}) {
  const src = node.photoVersion && photoToken ? photoUrl(node.id, node.photoVersion, "thumb", photoToken) : null;
  return (
    <button
      type="button"
      data-orgchart-id={node.id}
      onClick={() => onOpen(node.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        minWidth: 0,
        padding: 10,
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: palette.text,
        background: palette.cardBg,
        border: `1px solid ${highlighted ? palette.primary : palette.border}`,
        boxShadow: highlighted ? `0 0 0 2px ${palette.primary}40` : undefined,
        borderRadius: 8,
      }}
    >
      {src ? (
        <img src={src} alt={node.name} loading="lazy" decoding="async" width={40} height={40} style={{ borderRadius: "50%", flexShrink: 0, objectFit: "cover" }} />
      ) : (
        <span
          aria-hidden
          style={{
            width: 40,
            height: 40,
            borderRadius: "50%",
            background: palette.primary,
            color: "#fff",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            fontSize: fs.lg,
          }}
        >
          {initials(node.name)}
        </span>
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontWeight: 600, ...ellipsis }}>{node.name}</span>
        <span style={{ display: "block", fontSize: fs.sm, color: palette.textSecondary, ...ellipsis }}>{subtitle}</span>
      </span>
      <KindBadge kind={node.kind} reportCount={reportCount} palette={palette} />
    </button>
  );
});

// E2: a manager is always labelled as one — "Manager · No team yet" is
// visibly different from a plain employee (who has no badge) and from an HR
// Admin (top level, never a team). That was the old chart's ambiguity.
function KindBadge({ kind, reportCount, palette }: { kind: OrgChartNode["kind"]; reportCount: number; palette: Palette }) {
  if (kind === "employee") return null;
  const text = kind === "manager" ? `Manager · ${reportCount === 0 ? "No team yet" : reportCount}` : kind === "adminStaff" ? "HR Admin" : "Super Admin";
  const label = kind === "manager" ? (reportCount === 0 ? "Manager with no team yet" : `Manager with ${reportCount} direct reports`) : text;
  return (
    <span
      title={label}
      aria-label={label}
      style={{
        flexShrink: 0,
        fontSize: fs.sm,
        padding: "0 7px",
        borderRadius: 4,
        whiteSpace: "nowrap",
        border: `1px solid ${kind === "manager" ? palette.primary : palette.border}`,
        color: kind === "manager" ? palette.primary : palette.textSecondary,
        background: palette.tagBg,
      }}
    >
      {text}
    </span>
  );
}

interface BranchProps {
  node: OrgChartNode;
  chart: OrgChartData;
  childrenOf: Map<string, OrgChartNode[]>;
  expanded: Set<string>;
  toggle: (id: string) => void;
  onOpen: (id: string) => void;
  highlightId: string | null;
  photoToken: string | undefined;
  palette: Palette;
  depth: number;
}

const subtitleFor = (chart: OrgChartData, node: OrgChartNode) => `${chart.designations[node.designationId]} · ${chart.departments[node.departmentId]}`;

function Branch({ node, chart, childrenOf, expanded, toggle, onOpen, highlightId, photoToken, palette, depth }: BranchProps) {
  const reports = childrenOf.get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  // Lowest level (a team): a compact grid of cards instead of more nesting.
  const leafTeam = reports.length > 0 && reports.every((r) => !childrenOf.get(r.id)?.length);
  const card = (n: OrgChartNode, count: number) => (
    <OrgCard node={n} subtitle={subtitleFor(chart, n)} photoToken={photoToken} palette={palette} onOpen={onOpen} highlighted={highlightId === n.id} reportCount={count} />
  );
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : 20, borderLeft: depth === 0 ? undefined : `2px solid ${palette.line}`, paddingLeft: depth === 0 ? 0 : 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, minWidth: 0 }}>
        {reports.length > 0 ? (
          <Button
            type="text"
            size="small"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}'s team`}
            icon={isOpen ? <MinusSquareOutlined /> : <PlusSquareOutlined />}
            onClick={() => toggle(node.id)}
          />
        ) : (
          <span style={{ width: 24, flexShrink: 0 }} />
        )}
        <div style={{ flex: "0 1 340px", minWidth: 0 }}>{card(node, reports.length)}</div>
      </div>
      {isOpen &&
        (leafTeam ? (
          <div
            style={{
              marginLeft: 20,
              borderLeft: `2px solid ${palette.line}`,
              padding: "8px 0 0 12px",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))",
              gap: 8,
            }}
          >
            {reports.map((r) => (
              <div key={r.id} style={{ minWidth: 0 }}>
                {card(r, 0)}
              </div>
            ))}
          </div>
        ) : (
          reports.map((r) => (
            <Branch
              key={r.id}
              node={r}
              chart={chart}
              childrenOf={childrenOf}
              expanded={expanded}
              toggle={toggle}
              onOpen={onOpen}
              highlightId={highlightId}
              photoToken={photoToken}
              palette={palette}
              depth={depth + 1}
            />
          ))
        ))}
    </div>
  );
}

export function OrgChart({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const { data: chart, isLoading } = useQuery({ queryKey: ["people", "org-chart"], queryFn: getOrgChart });
  // Unassigned people are shown to whoever can fix it (Manager Management).
  const canAssign = useAuth().hasPermission("manager.team.assign");
  const photoToken = usePhotoToken();
  const { token } = theme.useToken();
  const [expandedOverride, setExpanded] = useState<Set<string> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const palette = useMemo<Palette>(
    () => ({
      cardBg: token.colorBgContainer,
      border: token.colorBorderSecondary,
      primary: token.colorPrimary,
      text: token.colorText,
      textSecondary: token.colorTextSecondary,
      line: token.colorSplit,
      tagBg: token.colorFillQuaternary,
    }),
    [token],
  );

  const { byId, childrenOf, managerIds } = useMemo(() => {
    const byId = new Map<string, OrgChartNode>();
    const childrenOf = new Map<string, OrgChartNode[]>();
    for (const node of chart?.nodes ?? []) {
      byId.set(node.id, node);
      if (node.managerId) childrenOf.set(node.managerId, [...(childrenOf.get(node.managerId) ?? []), node]);
    }
    return { byId, childrenOf, managerIds: [...childrenOf.keys()] };
  }, [chart]);

  // Default: everyone directly under Admin visible, every manager's team collapsed.
  const expanded = expandedOverride ?? new Set<string>();
  const setExpandedSoon = (next: Set<string>) => startTransition(() => setExpanded(next));

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedSoon(next);
  }

  function reveal(id: string) {
    const next = new Set(expanded);
    for (let cursor = byId.get(id)?.managerId; cursor; cursor = byId.get(cursor)?.managerId) next.add(cursor);
    setHighlightId(id);
    setExpandedSoon(next);
    // Bring it into view once the transition has rendered it.
    const scroll = (tries: number) => {
      const el = document.querySelector(`[data-orgchart-id="${id}"]`);
      if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      else if (tries > 0) setTimeout(() => scroll(tries - 1), 50);
    };
    scroll(20);
  }

  if (isLoading || !chart) return <EmptyState message="Loading…" />;
  if (chart.nodes.length === 0) return <Empty description="No one to show yet." />;

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Input.Search
          allowClear
          placeholder="Find someone in the chart"
          style={{ width: 280 }}
          aria-label="Find someone in the org chart"
          onSearch={(q) => {
            const term = q.trim().toLowerCase();
            const match = term && chart.nodes.find((n) => `${n.name} (${n.code})`.toLowerCase().includes(term));
            if (match) reveal(match.id);
          }}
        />
        <Button onClick={() => setExpandedSoon(new Set(managerIds))}>Expand all</Button>
        <Button onClick={() => setExpandedSoon(new Set())}>Collapse all</Button>
        <Typography.Text type="secondary">{chart.nodes.length} people</Typography.Text>
        {isPending && <Spin size="small" />}
      </Space>
      {/* The synthetic Admin root (model A): the Super Admins, not one person. */}
      <Card size="small" styles={{ body: { padding: 12 } }}>
        <Space wrap size={[8, 8]} align="center">
          <Typography.Text strong>Admin</Typography.Text>
          {chart.adminIds.map((id) => {
            const a = byId.get(id);
            return a ? (
              <Button key={id} size="small" onClick={() => onOpenPerson(id)}>
                {a.name}
              </Button>
            ) : null;
          })}
          <Typography.Text type="secondary">
            · {chart.rootIds.filter((id) => byId.get(id)?.kind === "manager").length} managers
          </Typography.Text>
        </Space>
      </Card>
      <div style={{ marginLeft: 12, borderLeft: `2px solid ${palette.line}`, paddingLeft: 8 }}>
        {chart.rootIds.map((id) => {
          const node = byId.get(id);
          return node ? (
            <Branch
              key={id}
              node={node}
              chart={chart}
              childrenOf={childrenOf}
              expanded={expanded}
              toggle={toggle}
              onOpen={onOpenPerson}
              highlightId={highlightId}
              photoToken={photoToken}
              palette={palette}
              depth={0}
            />
          ) : null;
        })}
      </div>
      {canAssign && chart.unassignedIds.length > 0 && (
        <Card size="small" title={`Unassigned — no reporting manager (${chart.unassignedIds.length})`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: 8 }}>
            {chart.unassignedIds.map((id) => {
              const node = byId.get(id);
              return node ? (
                <OrgCard
                  key={id}
                  node={node}
                  subtitle={subtitleFor(chart, node)}
                  photoToken={photoToken}
                  palette={palette}
                  onOpen={onOpenPerson}
                  highlighted={highlightId === id}
                  reportCount={0}
                />
              ) : null;
            })}
          </div>
        </Card>
      )}
    </Space>
  );
}
