import { TrophyOutlined } from "@ant-design/icons";
import { fs, fw, radius, space, v } from "../../theme/tokens";
import { useBadgeCounts } from "./useBadgeCounts";

/** A person's active badge count on a directory card or org-chart node; nothing when they have none (or the caller may not see badges). */
export function BadgeCount({ employeeId }: { employeeId: string }) {
  const { data } = useBadgeCounts();
  const n = data?.counts[employeeId] ?? 0;
  if (n === 0) return null;
  const label = `${n} ${n === 1 ? "badge" : "badges"}`;
  return (
    <span
      aria-label={label}
      title={label}
      style={{ display: "inline-flex", alignItems: "center", gap: space[1], padding: `0 ${space[2]}px`, borderRadius: radius.pill, background: v.bgSubtle, color: v.textSecondary, fontSize: fs.sm, fontWeight: fw.medium }}
    >
      <TrophyOutlined aria-hidden />
      <span className="ws-num">{n}</span>
    </span>
  );
}
