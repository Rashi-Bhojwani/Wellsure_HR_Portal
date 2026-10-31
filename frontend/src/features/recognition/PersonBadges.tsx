import { useQuery } from "@tanstack/react-query";
import { Space } from "antd";
import { fs, fw, space, v } from "../../theme/tokens";
import { StatusChip } from "../../ui";
import * as api from "./api";

/** A person's active badges on their directory profile (Q-16: company-wide to signed-in staff; the server decides, nothing renders without badges). */
export function PersonBadges({ employeeId }: { employeeId: string }) {
  const { data } = useQuery({ queryKey: ["recognition", "person", employeeId], queryFn: () => api.personBadges(employeeId) });
  if (!data?.shown || data.badges.length === 0) return null;
  return (
    <section aria-label="Badges" style={{ marginTop: space[4] }}>
      <div style={{ fontSize: fs.sm, fontWeight: fw.semibold, color: v.textSecondary, marginBottom: space[2] }}>Badges</div>
      <Space wrap size={space[1]}>
        {data.badges.map((b) => (
          <StatusChip key={b.id} tone="success" title={b.from ? `From ${b.from}` : undefined}>
            {b.badge}
          </StatusChip>
        ))}
      </Space>
    </section>
  );
}
