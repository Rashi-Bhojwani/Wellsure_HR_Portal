import type { ComponentType } from "react";
import {
  AuditOutlined,
  BankOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  ClockCircleOutlined,
  CommentOutlined,
  CustomerServiceOutlined,
  DollarOutlined,
  FieldTimeOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FolderOutlined,
  FormOutlined,
  GiftOutlined,
  HeartOutlined,
  HomeOutlined,
  InboxOutlined,
  PieChartOutlined,
  PlusCircleOutlined,
  RiseOutlined,
  RocketOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  TeamOutlined,
  TrophyOutlined,
  UnorderedListOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { lazyPage } from "./lazyPage";
// PEEPS-BEGIN assets
import { LaptopOutlined } from "@ant-design/icons";
const MyAssetsPage = lazyPage(() => import("../features/assets/pages/MyAssetsPage"), "MyAssetsPage");
// PEEPS-END
// PEEPS-BEGIN office-unmute
import { AudioOutlined, CrownOutlined } from "@ant-design/icons";
const UnmutePage = lazyPage(() => import("../features/unmute/pages/UnmutePage"), "UnmutePage");
const HostCalendarPage = lazyPage(() => import("../features/unmute/pages/HostCalendarPage"), "HostCalendarPage");
const UnmuteAdminPage = lazyPage(() => import("../features/unmute/pages/UnmuteAdminPage"), "UnmuteAdminPage");
const OfficeMembersPage = lazyPage(() => import("../features/peeps/pages/OfficeMembersPage"), "OfficeMembersPage");
const PeepsSettingsPage = lazyPage(() => import("../features/peeps/pages/PeepsSettingsPage"), "PeepsSettingsPage");
const OfficeAssetRegisterPage = lazyPage(() => import("../features/assets/pages/OfficeAssetPages"), "OfficeAssetRegisterPage");
const OfficeAssetSettingsPage = lazyPage(() => import("../features/assets/pages/OfficeAssetPages"), "OfficeAssetSettingsPage");
// PEEPS-END
// PEEPS-BEGIN badges-nudges
import { StarOutlined } from "@ant-design/icons";
const RecognitionPage = lazyPage(() => import("../features/recognition/pages/RecognitionPage"), "RecognitionPage");
const RecognitionAdminPage = lazyPage(() => import("../features/recognition/pages/RecognitionAdminPage"), "RecognitionAdminPage");
// PEEPS-END

const HomePage = lazyPage(() => import("../pages/employee/home/HomePage"), "HomePage");
const EngagePage = lazyPage(() => import("../pages/employee/engage/EngagePage"), "EngagePage");
const KudosPage = lazyPage(() => import("../pages/employee/engage/KudosPage"), "KudosPage");
const ReviewPage = lazyPage(() => import("../pages/employee/todo/ReviewPage"), "ReviewPage");
const LeaveApplyPage = lazyPage(() => import("../pages/employee/leave/LeaveApplyPage"), "LeaveApplyPage");
const LeaveBalancesPage = lazyPage(() => import("../pages/employee/leave/LeaveBalancesPage"), "LeaveBalancesPage");
const LeaveCalendarPage = lazyPage(() => import("../pages/employee/leave/LeaveCalendarPage"), "LeaveCalendarPage");
const HolidayCalendarPage = lazyPage(() => import("../pages/employee/leave/HolidayCalendarPage"), "HolidayCalendarPage");
const DocumentCenterPage = lazyPage(() => import("../pages/employee/document-center/DocumentCenterPage"), "DocumentCenterPage");
const PeoplePage = lazyPage(() => import("../pages/employee/people/PeoplePage"), "PeoplePage");
const HelpdeskPage = lazyPage(() => import("../pages/employee/helpdesk/HelpdeskPage"), "HelpdeskPage");
const RequestHubPage = lazyPage(() => import("../pages/employee/request-hub/RequestHubPage"), "RequestHubPage");
const TasksPage = lazyPage(() => import("../pages/employee/todo/TasksPage"), "TasksPage");
const WorkflowDelegatesPage = lazyPage(() => import("../pages/employee/workflow-delegates/WorkflowDelegatesPage"), "WorkflowDelegatesPage");
const MarkAttendancePage = lazyPage(() => import("../pages/employee/attendance/MarkAttendancePage"), "MarkAttendancePage");
const AttendanceInfoPage = lazyPage(() => import("../pages/employee/attendance/AttendanceInfoPage"), "AttendanceInfoPage");
const PayslipsPage = lazyPage(() => import("../pages/employee/salary/PayslipsPage"), "PayslipsPage");

// Single source of truth for the Employee portal left sidebar
// (docs/UI_REFERENCE.md §1.0). The sidebar, the route tree and the
// breadcrumb/page title are all generated from this file — add, hide or
// (from Phase 1) permission-gate an item here and every one of those
// updates together. A leaf without `element` renders PlaceholderPage.

export interface EmployeeMenuLeaf {
  key: string;
  label: string;
  path: string; // relative to /app
  icon?: ComponentType;
  element?: ComponentType;
  phase?: string;
  description?: string; // also the mobile Explore card's subtitle
  // Mobile (Phase 5 commit G, docs/UI_REFERENCE.md Part 4): listed on the
  // Action tab, in menu order.
  quickAction?: boolean;
  // Shown only to holders of this permission (e.g. Mark Attendance, P2-D:
  // the manager who marks a branch by hand). The API enforces it regardless.
  permission?: string;
  // PEEPS-BEGIN office-audience
  // A Wellsure Office leaf for members only, never the directors (who hold every key and use the admin portal's screen instead). Q-14: the asset register.
  officeMembersOnly?: boolean;
  // PEEPS-END
}

export interface EmployeeMenuGroup {
  key: string;
  label: string;
  icon?: ComponentType;
  description?: string; // the mobile Explore card's subtitle
  children: EmployeeMenuLeaf[];
}

export type EmployeeMenuEntry = EmployeeMenuLeaf | EmployeeMenuGroup;

export function isEmployeeMenuGroup(entry: EmployeeMenuEntry): entry is EmployeeMenuGroup {
  return "children" in entry;
}

export const employeeMenu: EmployeeMenuEntry[] = [
  {
    key: "home",
    label: "Home",
    path: "home",
    icon: HomeOutlined,
    element: HomePage,
  },
  {
    key: "engage",
    label: "Engage",
    path: "engage",
    icon: RocketOutlined,
    element: EngagePage,
  },
  {
    key: "my-worklife",
    label: "My Worklife",
    icon: HeartOutlined,
    description: "Kudos and recognition from your colleagues.",
    children: [
      { key: "kudos", label: "Kudos", path: "my-worklife/kudos", icon: TrophyOutlined, element: KudosPage, quickAction: true },
      {
        key: "feedback",
        label: "Feedback",
        path: "my-worklife/feedback",
        icon: CommentOutlined,
        phase: "Phase 8", // with performance reviews (user decision, Phase 5 commit D)
      },
    ],
  },
  {
    key: "todo",
    label: "To do",
    icon: CheckSquareOutlined,
    description: "Things waiting on you, and approvals to review.",
    children: [
      { key: "tasks", label: "Tasks", path: "todo/tasks", icon: UnorderedListOutlined, element: TasksPage, quickAction: true },
      { key: "review", label: "Review", path: "todo/review", icon: AuditOutlined, element: ReviewPage, quickAction: true },
    ],
  },
  {
    key: "salary",
    label: "Salary",
    icon: DollarOutlined,
    description: "Payslips, tax and salary details.",
    children: [
      { key: "payslips", label: "Payslips", path: "salary/payslips", icon: FileTextOutlined, element: PayslipsPage },
      {
        key: "ytd-reports",
        label: "YTD Reports",
        path: "salary/ytd-reports",
        icon: RiseOutlined,
        phase: "Phase 7",
      },
      {
        key: "it-statement",
        label: "IT Statement",
        path: "salary/it-statement",
        icon: FileDoneOutlined,
        phase: "Phase 7",
      },
      {
        key: "it-declaration",
        label: "IT Declaration",
        path: "salary/it-declaration",
        icon: FormOutlined,
        phase: "Phase 7",
      },
      {
        key: "loans-advances",
        label: "Loans and Advances",
        path: "salary/loans-advances",
        icon: BankOutlined,
        phase: "Phase 7",
      },
      {
        key: "reimbursement",
        label: "Reimbursement",
        path: "salary/reimbursement",
        icon: WalletOutlined,
        phase: "Phase 7",
      },
      {
        key: "proof-of-investment",
        label: "Proof Of Investment",
        path: "salary/proof-of-investment",
        icon: SafetyCertificateOutlined,
        phase: "Phase 7",
      },
      {
        key: "salary-revision",
        label: "Salary Revision",
        path: "salary/salary-revision",
        icon: RiseOutlined,
        phase: "Phase 7",
      },
    ],
  },
  {
    key: "leave",
    label: "Leave",
    icon: CalendarOutlined,
    description: "Check balances and apply for leave.",
    children: [
      {
        key: "leave-apply",
        label: "Leave Apply",
        path: "leave/apply",
        icon: PlusCircleOutlined,
        element: LeaveApplyPage,
        quickAction: true,
      },
      {
        key: "leave-balances",
        label: "Leave Balances",
        path: "leave/balances",
        icon: PieChartOutlined,
        element: LeaveBalancesPage,
        quickAction: true,
      },
      {
        key: "leave-calendar",
        label: "Leave Calendar",
        path: "leave/calendar",
        icon: CalendarOutlined,
        element: LeaveCalendarPage,
      },
      {
        key: "holiday-calendar",
        label: "Holiday Calendar",
        path: "leave/holiday-calendar",
        icon: GiftOutlined,
        element: HolidayCalendarPage,
        quickAction: true,
      },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    icon: ClockCircleOutlined,
    description: "Your punches and attendance calendar.",
    children: [
      {
        key: "attendance-info",
        label: "Attendance Info",
        path: "attendance/info",
        icon: FieldTimeOutlined,
        element: AttendanceInfoPage,
        description: "Your month, live: punches, hours, and forgot-to-punch requests.",
      },
      {
        key: "mark-attendance",
        label: "Mark Attendance",
        path: "attendance/mark",
        icon: FormOutlined,
        element: MarkAttendancePage,
        permission: "attendance.manual.enter",
        description: "Mark the attendance of the branches you're assigned to.",
      },
    ],
  },
  {
    key: "document-center",
    label: "Document Center",
    path: "document-center",
    icon: FolderOutlined,
    element: DocumentCenterPage,
    description: "Company policies, your letters and documents.",
  },
  {
    key: "people",
    label: "People",
    path: "people",
    icon: TeamOutlined,
    element: PeoplePage,
    description: "Find colleagues and see the org chart.",
  },
  {
    key: "helpdesk",
    label: "Helpdesk",
    path: "helpdesk",
    icon: CustomerServiceOutlined,
    element: HelpdeskPage,
    description: "Ask HR for help.",
    quickAction: true,
  },
  {
    key: "request-hub",
    label: "Request Hub",
    path: "request-hub",
    icon: InboxOutlined,
    element: RequestHubPage,
    description: "Everything you've requested, in one place.",
    quickAction: true,
  },
  {
    key: "workflow-delegates",
    label: "Workflow Delegates",
    path: "workflow-delegates",
    icon: SwapOutlined,
    element: WorkflowDelegatesPage,
    description: "Hand your approvals to someone while you're away.",
  },
  // PEEPS-BEGIN assets
  {
    key: "my-assets",
    label: "My Assets",
    path: "my-assets",
    icon: LaptopOutlined,
    element: MyAssetsPage,
    description: "Equipment issued to you, and acknowledging receipt.",
  },
  // PEEPS-END
  // PEEPS-BEGIN office-unmute
  {
    key: "unmute",
    label: "Unmute",
    path: "unmute",
    icon: AudioOutlined,
    element: UnmutePage,
    description: "Book a conversation with the Wellsure Office about an issue or an idea.",
  },
  // The Wellsure Office workspace (D-30): shown only to the directors and the members they appoint (each leaf needs a key only membership grants; the
  // pages and the API check the membership again).
  {
    key: "wellsure-office",
    label: "Wellsure Office",
    icon: CrownOutlined,
    description: "The workspace for the directors and the Wellsure Office.",
    children: [
      { key: "office-members", label: "Members", path: "office/members", element: OfficeMembersPage, permission: "office.members.manage" },
      { key: "office-settings", label: "Peeps settings", path: "office/settings", element: PeepsSettingsPage, permission: "office.workspace" },
      { key: "office-unmute", label: "Unmute hosting", path: "office/unmute", element: HostCalendarPage, permission: "office.workspace" },
      { key: "office-unmute-admin", label: "Unmute bookings", path: "office/unmute-admin", element: UnmuteAdminPage, permission: "unmute.manage" },
      // Q-14 (2026-11): the register is HR's and the directors' (admin portal). Members see these only while the directors' asset audience lets the
      // Wellsure Office manage it: their asset keys are written only then (backend peeps/office.ts grantKeysFor).
      { key: "office-assets", label: "Asset Register", path: "office/assets", element: OfficeAssetRegisterPage, permission: "assets.view", officeMembersOnly: true },
      { key: "office-asset-settings", label: "Asset Settings", path: "office/asset-settings", element: OfficeAssetSettingsPage, permission: "assets.settings.manage", officeMembersOnly: true },
    ],
  },
  // PEEPS-END
  // PEEPS-BEGIN badges-nudges
  {
    key: "recognition",
    label: "Recognition",
    path: "recognition",
    icon: StarOutlined,
    element: RecognitionPage,
    description: "Badges and private notes you have received.",
  },
  // PEEPS-END
];

// PEEPS-BEGIN badges-nudges
// The directors' Recognition page joins the Wellsure Office group (directors only: "badges.give" alone is not enough, the page needs the directors' list).
{
  const office = employeeMenu.find((e) => e.key === "wellsure-office");
  if (office && "children" in office) office.children.push({ key: "office-recognition", label: "Recognition (all)", path: "office/recognition", element: RecognitionAdminPage, permission: "office.members.manage" });
}
// PEEPS-END

// ── Mobile (Phase 5 commit G, docs/UI_REFERENCE.md Part 4) ──────────────
// The four-tab bottom bar shown at phone widths instead of the sidebar.
// Home and Engage are menu entries; Action and Explore are pages generated
// from the menu above (quickAction leaves; every other entry) — so a menu
// change shows up on mobile without touching any mobile code.
export interface MobileTab {
  key: "home" | "action" | "explore" | "engage";
  label: string;
  path: string; // relative to /app
  menuKey?: string; // a menu entry whose icon this tab reuses
}

export const mobileTabs: MobileTab[] = [
  { key: "home", label: "Home", path: "home", menuKey: "home" },
  { key: "action", label: "Action", path: "action" },
  { key: "explore", label: "Explore", path: "explore" },
  { key: "engage", label: "Engage", path: "engage", menuKey: "engage" },
];

// Not built yet: phase-marked, or no page. (Payslips and Attendance Info
// were Phase 0 mock-ups with demo data; retired 2026-10-03 until the real
// data exists — Phase 6 and Phase 3.)
/** Whether this person sees the leaf (a permission-gated one only for its holders). */
export function canSeeLeaf(leaf: EmployeeMenuLeaf, hasPermission: (key: string) => boolean): boolean {
  // PEEPS-BEGIN office-audience
  if (leaf.officeMembersOnly && hasPermission("office.members.manage")) return false; // a director (that key is never a member's)
  // PEEPS-END
  return !leaf.permission || hasPermission(leaf.permission);
}

export function isComingSoon(leaf: EmployeeMenuLeaf): boolean {
  return Boolean(leaf.phase || !leaf.element);
}

export function quickActions(): EmployeeMenuLeaf[] {
  return employeeMenu.flatMap((e) => (isEmployeeMenuGroup(e) ? e.children : [e])).filter((l) => l.quickAction && !isComingSoon(l));
}

export function exploreEntries(): EmployeeMenuEntry[] {
  const tabMenuKeys = new Set(mobileTabs.map((t) => t.menuKey).filter(Boolean));
  return employeeMenu.filter((e) => !tabMenuKeys.has(e.key));
}
