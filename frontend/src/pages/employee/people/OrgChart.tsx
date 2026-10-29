import { memo, useMemo, useRef, useState, useTransition, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Tooltip } from "antd";
import { MinusSquareOutlined, PlusSquareOutlined } from "@ant-design/icons";
import { getOrgChart, photoUrl, type OrgChart as OrgChartData, type OrgChartNode } from "../../../api/people";
import { usePhotoToken } from "../../../hooks/usePhotoToken";
import { useAuth } from "../../../hooks/useAuth";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { EmptyState, InitialsAvatar, QueryState, Skel, StatusChip, toast, useIsPhone } from "../../../ui";

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

const ellipsis = { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } as const;
// Connector lines between levels: the stronger border token, so the tree reads in both themes.
const LINE = `2px solid ${v.borderControl}`;

const OrgCard = memo(function OrgCard({
  node,
  subtitle,
  photoToken,
  onOpen,
  highlighted,
  reportCount,
}: {
  node: OrgChartNode;
  subtitle: string;
  photoToken: string | undefined;
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
      aria-current={highlighted ? "true" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: space[3],
        width: "100%",
        minWidth: 0,
        minHeight: 60,
        padding: `${space[2]}px ${space[3]}px`,
        textAlign: "left",
        cursor: "pointer",
        font: "inherit",
        color: v.textPrimary,
        background: highlighted ? v.accentSubtle : v.bgSurface,
        border: `1px solid ${highlighted ? v.accent : v.borderDefault}`,
        boxShadow: highlighted ? `0 0 0 2px ${v.accent}` : undefined,
        borderRadius: radius.md,
        transition: "border-color 0.15s, background 0.15s",
      }}
    >
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" width={40} height={40} style={{ borderRadius: radius.pill, flexShrink: 0, objectFit: "cover" }} />
      ) : (
        <InitialsAvatar name={node.name} size={40} />
      )}
      <span style={{ minWidth: 0, flex: 1 }}>
        <span style={{ display: "block", fontWeight: fw.semibold, fontSize: fs.md, ...ellipsis }}>{node.name}</span>
        <span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary, ...ellipsis }}>{subtitle}</span>
      </span>
      <KindBadge kind={node.kind} reportCount={reportCount} />
    </button>
  );
});

// E2: a manager is always labelled as one — "Manager · No team yet" is
// visibly different from a plain employee (who has no badge) and from an HR
// Admin (top level, never a team). That was the old chart's ambiguity.
function KindBadge({ kind, reportCount }: { kind: OrgChartNode["kind"]; reportCount: number }) {
  if (kind === "employee") return null;
  const text = kind === "manager" ? `Manager · ${reportCount === 0 ? "No team yet" : reportCount}` : kind === "adminStaff" ? "HR Admin" : "Super Admin";
  const label = kind === "manager" ? (reportCount === 0 ? "Manager with no team yet" : `Manager with ${reportCount} direct reports`) : text;
  return (
    <span aria-label={label} style={{ flexShrink: 0, display: "inline-flex" }}>
      <StatusChip tone={kind === "manager" ? "info" : kind === "adminStaff" ? "purple" : "neutral"} title={label}>
        {text}
      </StatusChip>
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
  depth: number;
  indent: number;
}

const subtitleFor = (chart: OrgChartData, node: OrgChartNode) => `${chart.designations[node.designationId]} · ${chart.departments[node.departmentId]}`;

function Branch({ node, chart, childrenOf, expanded, toggle, onOpen, highlightId, photoToken, depth, indent }: BranchProps) {
  const reports = childrenOf.get(node.id) ?? [];
  const isOpen = expanded.has(node.id);
  // Lowest level (a team): a compact grid of cards instead of more nesting.
  const leafTeam = reports.length > 0 && reports.every((r) => !childrenOf.get(r.id)?.length);
  const card = (n: OrgChartNode, count: number) => (
    <OrgCard node={n} subtitle={subtitleFor(chart, n)} photoToken={photoToken} onOpen={onOpen} highlighted={highlightId === n.id} reportCount={count} />
  );
  return (
    <div style={{ marginLeft: depth === 0 ? 0 : indent, borderLeft: depth === 0 ? undefined : LINE, paddingLeft: depth === 0 ? 0 : space[3] }}>
      <div style={{ display: "flex", alignItems: "center", gap: space[1], marginTop: space[2], minWidth: 0 }}>
        {reports.length > 0 ? (
          <Tooltip title={`${isOpen ? "Collapse" : "Expand"} team`}>
            <Button
              type="text"
              size="small"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? "Collapse" : "Expand"} ${node.name}'s team`}
              icon={isOpen ? <MinusSquareOutlined /> : <PlusSquareOutlined />}
              onClick={() => toggle(node.id)}
              style={{ color: v.accentText, flexShrink: 0 }}
            />
          </Tooltip>
        ) : (
          <span style={{ width: 24, flexShrink: 0 }} />
        )}
        <div style={{ flex: "0 1 360px", minWidth: 0 }}>{card(node, reports.length)}</div>
      </div>
      {isOpen &&
        (leafTeam ? (
          <div
            role="group"
            aria-label={`${node.name}'s team`}
            style={{
              marginLeft: indent,
              borderLeft: LINE,
              padding: `${space[2]}px 0 0 ${space[3]}px`,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))",
              gap: space[2],
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
              depth={depth + 1}
              indent={indent}
            />
          ))
        ))}
    </div>
  );
}

function OrgChartSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[3] }} aria-busy="true" aria-label="Loading the org chart">
      <Skel h={40} w="min(420px, 100%)" />
      <Skel h={56} />
      {[0, 1, 2, 3].map((i) => (
        <div key={i} style={{ marginLeft: space[8], display: "flex", gap: space[3], alignItems: "center" }}>
          <Skel w={40} h={40} r={radius.pill} />
          <Skel w="min(300px, 70%)" h={16} />
        </div>
      ))}
    </div>
  );
}

// Drag to pan the chart with a mouse (touch and trackpads scroll natively). Clicks on cards and buttons are left alone.
function PanCanvas({ children, style }: { children: ReactNode; style: CSSProperties }) {
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const end = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    e.currentTarget.style.cursor = "";
  };
  return (
    <div
      style={style}
      onPointerDown={(e) => {
        if (e.pointerType !== "mouse" || e.button !== 0 || (e.target as HTMLElement).closest("button, a, input")) return;
        const el = e.currentTarget;
        drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        el.setPointerCapture(e.pointerId);
        el.style.cursor = "grabbing";
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        e.currentTarget.scrollLeft = d.left - (e.clientX - d.x);
        e.currentTarget.scrollTop = d.top - (e.clientY - d.y);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {children}
    </div>
  );
}

export function OrgChart({ onOpenPerson }: { onOpenPerson: (id: string) => void }) {
  const { data: chart, isLoading, error, refetch } = useQuery({ queryKey: ["people", "org-chart"], queryFn: getOrgChart });
  // Unassigned people are shown to whoever can fix it (Manager Management).
  const canAssign = useAuth().hasPermission("manager.team.assign");
  const photoToken = usePhotoToken();
  const phone = useIsPhone();
  const [expandedOverride, setExpanded] = useState<Set<string> | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const indent = phone ? space[3] : space[5];

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
      if (el) el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      else if (tries > 0) setTimeout(() => scroll(tries - 1), 50);
    };
    scroll(20);
  }

  if (isLoading || error || !chart) {
    return (
      <div style={{ paddingTop: space[2] }}>
        <QueryState isLoading={isLoading || (!error && !chart)} error={error} onRetry={() => void refetch()} skeleton={<OrgChartSkeleton />}>
          {null}
        </QueryState>
      </div>
    );
  }
  if (chart.nodes.length === 0) return <EmptyState illustration="people" title="No one to show yet." description="The chart fills in as HR adds people and assigns their managers." />;

  const managerCount = chart.rootIds.filter((id) => byId.get(id)?.kind === "manager").length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4], paddingTop: space[2] }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
        <Input.Search
          allowClear
          placeholder="Find someone in the chart"
          style={{ width: phone ? "100%" : 300 }}
          aria-label="Find someone in the org chart"
          onSearch={(q) => {
            const term = q.trim().toLowerCase();
            if (!term) return;
            const match = chart.nodes.find((n) => `${n.name} (${n.code})`.toLowerCase().includes(term));
            if (match) reveal(match.id);
            else toast.info(`No one in the chart matches "${q.trim()}".`);
          }}
        />
        <div style={{ display: "flex", gap: space[2], flex: phone ? "1 1 100%" : undefined }}>
          <Button icon={<PlusSquareOutlined />} onClick={() => setExpandedSoon(new Set(managerIds))} style={{ flex: phone ? 1 : undefined }}>
            Expand all
          </Button>
          <Button icon={<MinusSquareOutlined />} onClick={() => setExpandedSoon(new Set())} style={{ flex: phone ? 1 : undefined }}>
            Collapse all
          </Button>
        </div>
        <span style={{ color: v.textSecondary, fontSize: fs.sm, marginLeft: phone ? 0 : "auto" }} aria-live="polite">
          {chart.nodes.length} people{isPending ? " · Updating…" : ""}
        </span>
      </div>

      <PanCanvas
        style={{
          overflow: "auto",
          maxHeight: phone ? undefined : "min(72vh, 960px)",
          background: v.bgSubtle,
          border: `1px solid ${v.borderDefault}`,
          borderRadius: radius.lg,
          padding: phone ? space[3] : space[5],
          opacity: isPending ? 0.85 : 1,
          transition: "opacity 0.15s",
        }}
      >
        {/* The synthetic Admin root (model A): the Super Admins, not one person. */}
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: space[2],
            padding: space[3],
            background: v.bgSurface,
            border: `1px solid ${v.borderDefault}`,
            borderRadius: radius.md,
            maxWidth: 720,
          }}
        >
          <span style={{ fontWeight: fw.bold, color: v.textPrimary, fontSize: fs.md, marginRight: space[1] }}>Admin</span>
          {chart.adminIds.map((id) => {
            const a = byId.get(id);
            return a ? (
              <Button key={id} size="small" onClick={() => onOpenPerson(id)} style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                <InitialsAvatar name={a.name} size={20} />
                {a.name}
              </Button>
            ) : null;
          })}
          <span style={{ color: v.textSecondary, fontSize: fs.sm }}>· {managerCount} managers</span>
        </div>
        <div style={{ marginLeft: space[3], borderLeft: LINE, paddingLeft: space[2], minWidth: phone ? 0 : 420 }}>
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
                depth={0}
                indent={indent}
              />
            ) : null;
          })}
        </div>
      </PanCanvas>

      {canAssign && chart.unassignedIds.length > 0 && (
        <section style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, padding: phone ? space[4] : space[5] }}>
          <h3 style={{ margin: `0 0 ${space[1]}px`, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textPrimary }}>
            Unassigned — no reporting manager ({chart.unassignedIds.length})
          </h3>
          <div style={{ color: v.textSecondary, fontSize: fs.sm, marginBottom: space[3] }}>Assign them a manager in Manager Management so they appear in the tree.</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(240px, 100%), 1fr))", gap: space[2] }}>
            {chart.unassignedIds.map((id) => {
              const node = byId.get(id);
              return node ? (
                <OrgCard key={id} node={node} subtitle={subtitleFor(chart, node)} photoToken={photoToken} onOpen={onOpenPerson} highlighted={highlightId === id} reportCount={0} />
              ) : null;
            })}
          </div>
        </section>
      )}
    </div>
  );
}
