import { useQuery } from "@tanstack/react-query";
import { formatDate } from "../../lib/dates";
import { fs, fw, space, v } from "../../theme/tokens";
// Direct ui/* imports: this panel sits on the home page, which has a bundle budget.
import { Panel } from "../../ui/Panel";
import { Skel } from "../../ui/Skeletons";
import { recentBadges, recentNudges } from "./api";
import { EmployeeAvatar } from "../../components/common/EmployeeAvatar";

type Item = { id: string; at: string; who?: { employeeId: string; name: string } | null; what: string; from?: string; message?: string | null };

// Home page: the latest badges and nudge tags across the company (public to signed-in staff). Who gave each and why appear unless the directors hid them
// (nudge tags always name the giver). Private notes are never here. Nothing renders when there are none, or for a caller who may not see them.
export function RecentCheersPanel() {
  const badges = useQuery({ queryKey: ["recognition", "recent"], queryFn: recentBadges, staleTime: 60_000, retry: false });
  const tags = useQuery({ queryKey: ["recognition", "recent-nudges"], queryFn: recentNudges, staleTime: 60_000, retry: false });
  const isLoading = badges.isLoading || tags.isLoading;
  const items: Item[] = [
    ...(badges.data ?? []).map((b) => ({ id: `b-${b.id}`, at: b.givenAt, who: b.recipient, what: b.badge, from: b.from, message: b.message })),
    ...(tags.data ?? []).map((t) => ({ id: `n-${t.id}`, at: t.givenAt, who: t.recipient, what: t.tag, from: t.from, message: null })),
  ].sort((a, b) => b.at.localeCompare(a.at));
  if ((badges.isError && tags.isError) || (!isLoading && items.length === 0)) return null;
  return (
    <Panel title="Recent cheers" subtitle="Badges and nudges across the company">
      {isLoading ? (
        <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>{[0, 1, 2].map((i) => <Skel key={i} h={36} />)}</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[3] }}>
          {items.slice(0, 8).map((b) => (
            <li key={b.id} style={{ display: "flex", alignItems: "flex-start", gap: space[3] }}>
              <EmployeeAvatar employeeId={b.who?.employeeId} name={b.who?.name ?? "?"} size={32} />
              <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                <span style={{ color: v.textPrimary }}>
                  <span style={{ fontWeight: fw.semibold }}>{b.who?.name ?? "A colleague"}</span> · {b.what}
                </span>
                <span style={{ fontSize: fs.sm, color: v.textSecondary }}>
                  {formatDate(b.at)}
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
