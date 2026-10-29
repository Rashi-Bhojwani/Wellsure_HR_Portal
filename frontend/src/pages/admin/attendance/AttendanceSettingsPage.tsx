import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { CalendarOutlined, ClockCircleOutlined, EditOutlined, FieldTimeOutlined, SafetyCertificateOutlined, TeamOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../api/attendance";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { useAuth } from "../../../hooks/useAuth";
import { ApprovalBanner, PageHeader, Stack } from "../../../ui";
import { SectionNav, SettingsLayout, type SectionNavItem } from "../settings/SettingsNav";
import { AssignmentsTab } from "./settings/AssignmentsTab";
import { CycleTab } from "./settings/CycleTab";
import { ManualBranchesTab } from "./settings/ManualBranchesTab";
import { PoliciesTab } from "./settings/PoliciesTab";
import { ShiftsTab } from "./settings/ShiftsTab";
import { WeekOffsTab } from "./settings/WeekOffsTab";
import { PLACEHOLDER_LABELS } from "./settings/format";

type TabKey = "shifts" | "week-offs" | "policies" | "assignments" | "cycle" | "manual-branches";

/** HR values still awaiting confirmation, across shifts and policies. */
function PlaceholderBanner() {
  const shifts = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const policies = useQuery({ queryKey: ["attendance", "config", "policies"], queryFn: attendanceApi.listPolicies });
  const pending = [
    ...(shifts.data ?? []).filter((s) => s.isActive).flatMap((s) => s.placeholderFields.map((f) => `${PLACEHOLDER_LABELS[f] ?? f} (shift ${s.code})`)),
    ...(policies.data ?? []).filter((p) => p.isActive).flatMap((p) => p.placeholderFields.map((f) => `${PLACEHOLDER_LABELS[f] ?? f} (policy ${p.code})`)),
  ];
  if (pending.length === 0) return null;
  return (
    <ApprovalBanner
      tone="warning"
      title="Some values are placeholders, awaiting HR"
      description={<>These are in use but not yet confirmed: {pending.join("; ")}. Enter HR's values, or confirm the current ones once HR agrees.</>}
    />
  );
}

// Attendance Settings (Phase 2 P2-A, docs/plans/PHASE_2.md §4.6): the
// company's shifts with their sessions, week-off patterns, policies, who
// works what from when, the attendance cycle, and who marks attendance by
// hand for which branch. Readable with attendance.view; changed with
// attendance.config.manage. Layout follows the board's settings frames
// (attendance-06, settings-06): a section nav on the left, the section's
// panels on the right; scrollable tabs on phones.
export function AttendanceSettingsPage({ initialTab = "shifts" }: { initialTab?: TabKey }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("attendance.config.manage");
  const [params, setParams] = useSearchParams();
  const items: SectionNavItem[] = [
    { key: "shifts", label: "Shifts", icon: <ClockCircleOutlined /> },
    { key: "week-offs", label: "Week-off patterns", icon: <CalendarOutlined /> },
    { key: "policies", label: "Policies", icon: <SafetyCertificateOutlined /> },
    { key: "assignments", label: "Assignments", icon: <TeamOutlined /> },
    { key: "cycle", label: "Attendance cycle", icon: <FieldTimeOutlined /> },
    ...(canManage ? [{ key: "manual-branches", label: "Manual-entry branches", icon: <EditOutlined /> }] : []),
  ];
  const requested = (params.get("tab") as TabKey | null) ?? initialTab;
  const tab: TabKey = items.some((i) => i.key === requested) ? requested : initialTab;
  const content: Record<TabKey, ReactNode> = {
    shifts: <ShiftsTab canManage={canManage} />,
    "week-offs": <WeekOffsTab canManage={canManage} />,
    policies: <PoliciesTab canManage={canManage} />,
    assignments: <AssignmentsTab canManage={canManage} />,
    cycle: <CycleTab canManage={canManage} />,
    "manual-branches": <ManualBranchesTab />,
  };
  return (
    <>
      <PageHeader title="Attendance Settings" subtitle="Shifts, week-offs, policies and who works what" />
      <Stack>
        <HelpStrip storageKey="attendance-settings-help">
          Company-wide attendance rules. HR confirmed (8 Oct 2026): Monday to Saturday working with Sunday off; the General shift 10:00–19:00 in two sessions
          with lunch 14:00–14:45; no late penalty; a calendar-month cycle. Every change is audited. Shift and policy changes apply to days computed from now on.
        </HelpStrip>
        <PlaceholderBanner />
        <SettingsLayout nav={<SectionNav label="Attendance settings sections" items={items} active={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} />}>
          <div key={tab} style={{ display: "contents" }}>
            {content[tab]}
          </div>
        </SettingsLayout>
      </Stack>
    </>
  );
}

export const ShiftMasterPage = () => <AttendanceSettingsPage initialTab="shifts" />;
export const WeekOffPatternsPage = () => <AttendanceSettingsPage initialTab="week-offs" />;
