import { useMemo, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { resolveAdminRoutes, resolveEmployeeRoutes, type ResolvedRoute } from "../../routes/resolveMenuRoutes";
import { EmptyState, FilterBar, PageHeader, Panel, Stack, StatusChip } from "../../ui";
import { fs, layout, space, v } from "../../theme/tokens";

const FLAG = "wellsure-dev-screens";

// Routes that are not menu entries (router.tsx). Detail routes need an id from the demo company, so they are listed but not linked.
const EXTRA: { group: string; path: string; label: string; needsId?: boolean }[] = [
  { group: "Signed out", path: "/login", label: "Sign in" },
  { group: "Signed out", path: "/forgot-password", label: "Forgot password" },
  { group: "Signed out", path: "/reset-password/:token", label: "Reset password (from the email link)", needsId: true },
  { group: "Signed out", path: "/set-password/:token", label: "First login: set password (from the invite)", needsId: true },
  { group: "Signed out", path: "/totp-challenge", label: "Two-step code (after a password, with a challenge)", needsId: true },
  { group: "Signed out", path: "/totp-setup", label: "Two-step setup (after a password, with a challenge)", needsId: true },
  { group: "Employee portal", path: "/app/profile", label: "View My Info" },
  { group: "Employee portal", path: "/app/security", label: "Account & security" },
  { group: "Employee portal", path: "/app/action", label: "Phone: Action tab" },
  { group: "Employee portal", path: "/app/explore", label: "Phone: Explore tab" },
  { group: "Employee portal", path: "/app/helpdesk/:id", label: "Helpdesk ticket", needsId: true },
  { group: "HR / Admin portal", path: "/admin/security", label: "Account & security" },
  { group: "HR / Admin portal", path: "/admin/employee/profile/:id", label: "Employee profile", needsId: true },
  { group: "HR / Admin portal", path: "/admin/employee/helpdesk/:id", label: "Helpdesk ticket (admin)", needsId: true },
  { group: "HR / Admin portal", path: "/admin/admin-tools/templates/:id", label: "Letter template editor", needsId: true },
  { group: "HR / Admin portal", path: "/admin/payroll/run/:id", label: "Payroll run", needsId: true },
  { group: "HR / Admin portal", path: "/admin/payroll/run/:id/step/:slug", label: "Payroll run step", needsId: true },
];

function readFlag(): boolean {
  try {
    return localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

// Development builds only (router.tsx registers it under import.meta.env.DEV, so production bundles do not contain it), and hidden even there until the developer flag is
// set: open /dev/screens?enable=1 once. Lists every screen URL for review against the DEMO COMPANY only (docs/UI_SCREEN_MAP.md); never point it at real data.
export function ScreensIndexPage() {
  const [params] = useSearchParams();
  const [filter, setFilter] = useState("");
  if (params.get("enable") === "1") {
    try {
      localStorage.setItem(FLAG, "1");
    } catch {
      /* private mode: the flag only lasts this visit */
    }
  }
  const enabled = params.get("enable") === "1" || readFlag();

  const groups = useMemo(() => {
    const fromMenu = (routes: ResolvedRoute[], group: string) =>
      routes.map((r) => ({ group, path: r.fullPath, label: r.label, kind: r.kind, phase: r.phase, needsId: false }));
    const all = [
      ...EXTRA.map((e) => ({ ...e, kind: "real" as const, phase: undefined })),
      ...fromMenu(resolveEmployeeRoutes(), "Employee portal"),
      ...fromMenu(resolveAdminRoutes(), "HR / Admin portal"),
    ].filter((r) => !filter || `${r.label} ${r.path}`.toLowerCase().includes(filter.toLowerCase()));
    const by = new Map<string, typeof all>();
    for (const r of all) by.set(r.group, [...(by.get(r.group) ?? []), r]);
    return [...by.entries()];
  }, [filter]);

  if (!enabled) return <Navigate to="/login" replace />;

  const total = groups.reduce((n, [, routes]) => n + routes.length, 0);

  return (
    <main style={{ maxWidth: Math.min(layout.contentMax, 1100), margin: "0 auto", padding: space[6], background: v.bgPage, minHeight: "100vh" }}>
      <PageHeader
        title="Screens (developer index)"
        subtitle={
          <>
            Every screen URL, for reviewing the UI pass against the <strong>demo company</strong> only. Development builds only. Map and board frames:{" "}
            <code>docs/UI_SCREEN_MAP.md</code>.
          </>
        }
      />
      <FilterBar searchPlaceholder="Filter by name or URL" searchValue={filter} onSearch={setFilter} />
      {total === 0 ? (
        <Panel>
          <EmptyState kind="no-results" title="No screens match" description="Try part of the page name or its URL." />
        </Panel>
      ) : (
        <Stack>
          {groups.map(([group, routes]) => (
            <Panel key={group} title={`${group} (${routes.length})`}>
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
                {routes.map((r) => (
                  <li
                    key={`${r.group}${r.path}`}
                    style={{ display: "flex", gap: space[3], alignItems: "center", flexWrap: "wrap", minHeight: 36, padding: `${space[1]}px 0`, borderBottom: `1px solid ${v.borderDefault}` }}
                  >
                    {r.needsId ? <span style={{ color: v.textSecondary }}>{r.label}</span> : <Link to={r.path}>{r.label}</Link>}
                    <code style={{ fontSize: fs.sm, color: v.textSecondary, overflowWrap: "anywhere" }}>{r.path}</code>
                    {r.kind === "placeholder" && <StatusChip tone="neutral">{r.phase ?? "later"}</StatusChip>}
                    {r.kind === "redirect" && <StatusChip tone="info">redirect</StatusChip>}
                    {r.needsId && <StatusChip tone="warning">needs a demo id</StatusChip>}
                  </li>
                ))}
              </ul>
            </Panel>
          ))}
        </Stack>
      )}
    </main>
  );
}
