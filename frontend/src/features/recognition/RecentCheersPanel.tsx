import { useQuery } from "@tanstack/react-query";
import { formatDate } from "../../lib/dates";
import { fs, fw, space, v } from "../../theme/tokens";
// Direct ui/* imports: this panel sits on the home page, which has a bundle budget.
import { Panel } from "../../ui/Panel";
import { Skel } from "../../ui/Skeletons";
import { recentBadges } from "./api";
import { EmployeeAvatar } from "../../components/common/EmployeeAvatar";

// Home page: the latest badges and cheers across the company (D-36: public to signed-in staff). Who gave each and their message appear only when the
// directors' setting says so. Corrective notes are never here. Nothing renders when there are none, or for a caller who may not see badges.
export function RecentCheersPanel() {
  const { data, isLoading, isError } = useQuery({ queryKey: ["recognition", "recent"], queryFn: recentBadges, staleTime: 60_000, retry: false });
  if (isError || (!isLoading && (data ?? []).length === 0)) return null;
  return (
    <Panel title="Recent cheers" subtitle="Badges given across the company">
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>{[0, 1, 2].map((i) => <Skel key={i} h={36} />)}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3] }}>
          {data!.slice(0, 8).map((b) => (
            <li key={b.id} style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
              <EmployeeAvatar employeeId={b.recipient?.employeeId} name={b.recipient?.name ?? "?"} size={32} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ color: v.textPrimary }}>
                  <span style={{ fontWeight: fw.semibold }}>{b.recipient?.name ?? "A colleague"}</span> · {b.badge}
                </span>
                <span style={{ fontSize: fs.sm, color: v.textSecondary }}>
                  {formatDate(b.givenAt)}
                  {b.from ? ` · from ${b.from}` : ""}
                </span>
                {b.message && <span style={{ fontSize: fs.sm, color: v.textBody }}>{b.message}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
