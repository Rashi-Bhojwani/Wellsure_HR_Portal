import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { Alert, Space, Tabs, Typography } from "antd";
import * as attendanceApi from "../../../api/attendance";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { useAuth } from "../../../hooks/useAuth";
import { AssignmentsTab } from "./settings/AssignmentsTab";
import { CycleTab } from "./settings/CycleTab";
import { ManualBranchesTab } from "./settings/ManualBranchesTab";
import { PoliciesTab } from "./settings/PoliciesTab";
import { ShiftsTab } from "./settings/ShiftsTab";
import { WeekOffsTab } from "./settings/WeekOffsTab";
import { PLACEHOLDER_LABELS } from "./settings/format";

const { Title } = Typography;

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
    <Alert
      type="warning"
      showIcon
      title="Some values are placeholders, awaiting HR"
      description={<>These are in use but not yet confirmed: {pending.join("; ")}. Enter HR's values, or confirm the current ones once HR agrees.</>}
    />
  );
}

// Attendance Settings (Phase 2 P2-A, docs/plans/PHASE_2.md §4.6): the
// company's shifts with their sessions, week-off patterns, policies, who
// works what from when, the attendance cycle, and who marks attendance by
// hand for which branch. Readable with attendance.view; changed with
// attendance.config.manage.
export function AttendanceSettingsPage({ initialTab = "shifts" }: { initialTab?: TabKey }) {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("attendance.config.manage");
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey | null) ?? initialTab;
  const items = [
    { key: "shifts", label: "Shifts", children: <ShiftsTab canManage={canManage} /> },
    { key: "week-offs", label: "Week-off patterns", children: <WeekOffsTab canManage={canManage} /> },
    { key: "policies", label: "Policies", children: <PoliciesTab canManage={canManage} /> },
    { key: "assignments", label: "Assignments", children: <AssignmentsTab canManage={canManage} /> },
    { key: "cycle", label: "Attendance cycle", children: <CycleTab canManage={canManage} /> },
    ...(canManage ? [{ key: "manual-branches", label: "Manual-entry branches", children: <ManualBranchesTab /> }] : []),
  ];
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Attendance Settings
      </Title>
      <HelpStrip storageKey="attendance-settings-help">
        Company-wide attendance rules. HR confirmed (8 Oct 2026): Monday to Saturday working with Sunday off; the General shift 10:00–19:00 in two sessions
        with lunch 14:00–14:45; no late penalty; a calendar-month cycle. Every change is audited. Shift and policy changes apply to days computed from now on.
      </HelpStrip>
      <PlaceholderBanner />
      <Tabs activeKey={tab} onChange={(k) => setParams({ tab: k }, { replace: true })} items={items} destroyOnHidden />
    </Space>
  );
}

export const ShiftMasterPage = () => <AttendanceSettingsPage initialTab="shifts" />;
export const WeekOffPatternsPage = () => <AttendanceSettingsPage initialTab="week-offs" />;
