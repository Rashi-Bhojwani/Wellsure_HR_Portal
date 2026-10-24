import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CalendarOutlined,
  ClockCircleOutlined,
  ExceptionOutlined,
  FieldTimeOutlined,
  GiftOutlined,
  LogoutOutlined,
  MinusCircleOutlined,
  ScheduleOutlined,
  TeamOutlined,
  UserAddOutlined,
  WalletOutlined,
  FileTextOutlined,
} from "@ant-design/icons";
import type { ReportInfo } from "@shared/constants/reports";
import * as reportsApi from "../../../api/reports";
import { useAuth } from "../../../hooks/useAuth";
import { CardGrid, EmptyState, PageHeader, QueryState, SkeletonCard, Stack, StatusChip } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";

// Sections and icons for the index (reports-01). Unknown keys from the catalog fall into "Other" with a generic icon, so a new report shows up
// without a change here.
const SECTIONS: { title: string; keys: string[] }[] = [
  { title: "People", keys: ["headcount", "joiners", "leavers", "celebrations"] },
  { title: "Leave", keys: ["leave-balance", "leave-liability", "lop"] },
  { title: "Attendance", keys: ["attendance-muster", "late-coming", "excess-hours", "exception-summary"] },
];
const ICONS: Record<string, ReactNode> = {
  headcount: <TeamOutlined />,
  joiners: <UserAddOutlined />,
  leavers: <LogoutOutlined />,
  celebrations: <GiftOutlined />,
  "leave-balance": <CalendarOutlined />,
  "leave-liability": <WalletOutlined />,
  lop: <MinusCircleOutlined />,
  "attendance-muster": <ScheduleOutlined />,
  "late-coming": <ClockCircleOutlined />,
  "excess-hours": <FieldTimeOutlined />,
  "exception-summary": <ExceptionOutlined />,
};

function ReportCard({ report }: { report: ReportInfo }) {
  return (
    <Link
      to={`/admin/reports/${report.key}`}
      className="ws-report-card"
      style={{ display: "flex", flexDirection: "column", gap: space[3], height: "100%", padding: space[6], background: v.bgSurface, border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, color: "inherit", textDecoration: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: space[3] }}>
        <span aria-hidden style={{ width: 48, height: 48, borderRadius: radius.pill, border: `1px solid ${v.borderDefault}`, display: "inline-flex", alignItems: "center", justifyContent: "center", color: v.accent, fontSize: fs.h2 }}>
          {ICONS[report.key] ?? <FileTextOutlined />}
        </span>
        {report.extraPermission && <StatusChip tone="warning">Salary-derived</StatusChip>}
      </div>
      <span style={{ fontSize: fs.xl, fontWeight: fw.semibold, color: v.textPrimary, marginTop: space[2] }}>{report.title}</span>
      <span style={{ fontSize: fs.md, color: v.textSecondary, lineHeight: 1.55 }}>{report.description}</span>
    </Link>
  );
}

// Reports app landing page (Phase 5 commit F): the reports this viewer can
// open. Payroll reports arrive with Phase 6.
export function ReportsHomePage() {
  const { hasPermission } = useAuth();
  const allowed = hasPermission("reports.view");
  const { data: reports = [], isLoading, error, refetch } = useQuery({ queryKey: ["reports", "catalog"], queryFn: reportsApi.catalog, enabled: allowed, staleTime: 60_000 });
  if (!allowed) return <EmptyState kind="forbidden" title="You can't open reports" />;

  const known = new Set(SECTIONS.flatMap((s) => s.keys));
  const groups = [
    ...SECTIONS.map((s) => ({ title: s.title, items: s.keys.map((k) => reports.find((r) => r.key === k)).filter((r): r is ReportInfo => Boolean(r)) })),
    { title: "Other", items: reports.filter((r) => !known.has(r.key)) },
  ].filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader title="Reports" subtitle="Filter, review on screen, and export to Excel. Managers see their own team. Payroll reports arrive with payroll." />
      <QueryState
        isLoading={isLoading}
        error={error}
        onRetry={() => void refetch()}
        isEmpty={reports.length === 0}
        empty={<EmptyState title="No reports to show" description="Ask an administrator for access to the reports you need." />}
        skeleton={
          <CardGrid min={340}>
            {Array.from({ length: 6 }, (_, i) => (
              <SkeletonCard key={i} lines={2} height={180} />
            ))}
          </CardGrid>
        }
      >
        <Stack gap={space[8]}>
          {groups.map((g) => (
            <section key={g.title} aria-labelledby={`reports-${g.title}`}>
              <h2 id={`reports-${g.title}`} style={{ margin: `0 0 ${space[4]}px`, fontSize: fs.lg, fontWeight: fw.semibold, color: v.textSecondary }}>
                {g.title}
              </h2>
              <CardGrid min={340}>
                {g.items.map((r) => (
                  <ReportCard key={r.key} report={r} />
                ))}
              </CardGrid>
            </section>
          ))}
        </Stack>
      </QueryState>
    </>
  );
}
