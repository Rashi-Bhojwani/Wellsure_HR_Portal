import { useQuery } from "@tanstack/react-query";
import { Typography } from "antd";
import * as api from "../../../api/settlements";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, KeyValueGrid, Panel, SkeletonCard, StatusChip } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";

// PY-27 / PY-28 / PY-29 (docs/plans/A_PARITY_ROWS.md): beside the prepare form, the facts a settlement line is worked out from (service length, the last drawn pay,
// the leave balance in days) and the three rules it needs — each Not set until the owners choose them. Nothing here proposes an amount.
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

export function SettlementGuide({ separationId }: { separationId: string }) {
  const q = useQuery({ queryKey: ["settlements", "guide", separationId], queryFn: () => api.settlementGuide(separationId) });
  if (q.isLoading) return <SkeletonCard lines={5} style={{ marginBottom: space[4] }} />;
  if (q.error || !q.data) return <ApprovalBanner tone="warning" title="The guide could not be loaded" description={apiErrorMessage(q.error, "Try again.")} style={{ marginBottom: space[4] }} />;
  const g = q.data;
  const muted = { color: v.textSecondary, fontSize: fs.sm };
  return (
    <Panel title="Guide" subtitle={g.note} tone="subtle" style={{ marginBottom: space[4] }}>
      <KeyValueGrid
        items={[
          { key: "doj", label: "Date of joining", value: g.dateOfJoining },
          { key: "lwd", label: "Last working day", value: g.lastWorkingDate },
          { key: "svc", label: "Service, both days counted", value: `${plural(g.service.years, "year")}, ${plural(g.service.months, "month")}, ${plural(g.service.days, "day")} (${g.service.totalDays} days)`, wide: true },
          { key: "last", label: "Last drawn", value: g.lastDrawn ? `${g.lastDrawn.cycle}: gross ${formatRupees(g.lastDrawn.gross, 2)}` : "No finalised run paid them", wide: true },
        ]}
      />
      {g.lastDrawn && g.lastDrawn.earnings.length > 0 && (
        <dl style={{ margin: `${space[3]}px 0 0`, display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", gap: `${space[1]}px ${space[4]}px` }}>
          {g.lastDrawn.earnings.map((e) => (
            <div key={e.code} style={{ display: "contents" }}>
              <dt style={muted}>{e.label}</dt>
              <dd style={{ margin: 0, textAlign: "right" }}>{formatRupees(e.amount, 2)}</dd>
            </div>
          ))}
        </dl>
      )}
      <Typography.Paragraph style={{ ...muted, margin: `${space[3]}px 0 ${space[1]}px` }}>Leave balance on the last working day</Typography.Paragraph>
      <div>{g.leave.length ? g.leave.map((l) => `${l.label.replace(", days only", "")}: ${l.days} days`).join(" · ") : "None"}</div>
      <Typography.Paragraph style={{ ...muted, margin: `${space[3]}px 0 ${space[1]}px` }}>Rules a settlement amount needs</Typography.Paragraph>
      {g.rules.map((r) => (
        <div key={r.key} style={{ display: "flex", gap: space[2], alignItems: "baseline", flexWrap: "wrap", marginBottom: space[2] }}>
          <strong>{r.label}</strong>
          <StatusChip tone="warning">{r.state}</StatusChip>
          <span style={muted}>{r.why}</span>
        </div>
      ))}
    </Panel>
  );
}
