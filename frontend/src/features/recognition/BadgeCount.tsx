import { SmileOutlined, TrophyOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { useBadgeCounts, useNudgeCounts } from "./useBadgeCounts";

const pill = { display: "inline-flex", alignItems: "center", gap: space[1], padding: `0 ${space[2]}px`, borderRadius: radius.pill, background: v.bgSubtle, color: v.textSecondary, fontSize: fs.sm, fontWeight: fw.medium } as const;

/** A person's active badge count (and nudge-tag count) on a directory card or org-chart node; nothing when they have none (or the caller may not see them). */
export function BadgeCount({ employeeId, withNudges = false }: { employeeId: string; withNudges?: boolean }) {
  const badges = useBadgeCounts();
  const nudges = useNudgeCounts();
  const n = badges.data?.counts[employeeId] ?? 0;
  const t = withNudges ? (nudges.data?.counts[employeeId] ?? 0) : 0;
  if (n === 0 && t === 0) return null;
  const label = `${n} ${n === 1 ? "badge" : "badges"}`;
  const tagLabel = `${t} ${t === 1 ? "nudge" : "nudges"}`;
  return (
    <span style={{ display: "inline-flex", gap: space[1], flexWrap: "wrap", justifyContent: "center" }}>
      {n > 0 && (
        <span aria-label={label} title={label} style={pill}>
          <TrophyOutlined aria-hidden />
          <span className="ws-num">{n}</span>
        </span>
      )}
      {t > 0 && (
        <span aria-label={tagLabel} title={tagLabel} style={pill}>
          <SmileOutlined aria-hidden />
          <span className="ws-num">{t}</span>
        </span>
      )}
    </span>
  );
}
