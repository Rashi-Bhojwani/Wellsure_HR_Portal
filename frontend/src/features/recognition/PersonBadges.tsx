import { useQuery } from "@tanstack/react-query";
import { Space } from "antd";
import { fs, fw, space, v } from "../../theme/tokens";
import { StatusChip } from "../../ui";
import * as api from "./api";

/** A person's active badges and nudge tags on their directory profile (company-wide to signed-in staff; the server decides, nothing renders without any). */
export function PersonBadges({ employeeId }: { employeeId: string }) {
  const badges = useQuery({ queryKey: ["recognition", "person", employeeId], queryFn: () => api.personBadges(employeeId) });
  const tags = useQuery({ queryKey: ["recognition", "person-nudges", employeeId], queryFn: () => api.personNudges(employeeId), retry: false });
  const list = badges.data?.shown ? badges.data.badges : [];
  const tagList = tags.data?.tags ?? [];
  if (list.length === 0 && tagList.length === 0) return null;
  const heading = { fontSize: fs.sm, fontWeight: fw.semibold, color: v.textSecondary, marginBottom: space[2] } as const;
  return (
    <>
      {list.length > 0 && (
        <section aria-label="Badges" style={{ marginTop: space[4] }}>
          <div style={heading}>Badges</div>
          <Space wrap size={space[1]}>
            {list.map((b) => (
              <StatusChip key={b.id} tone="success" title={[b.from ? `From ${b.from}` : null, b.message ?? null].filter(Boolean).join(": ") || undefined}>
                {b.badge}
              </StatusChip>
            ))}
          </Space>
        </section>
      )}
      {tagList.length > 0 && (
        <section aria-label="Nudges" style={{ marginTop: space[3] }}>
          <div style={heading}>Nudges this week</div>
          <Space wrap size={space[1]}>
            {tagList.map((t) => (
              <StatusChip key={t.id} tone="purple" title={`From ${t.from}`}>
                {t.tag}
              </StatusChip>
            ))}
          </Space>
        </section>
      )}
    </>
  );
}
