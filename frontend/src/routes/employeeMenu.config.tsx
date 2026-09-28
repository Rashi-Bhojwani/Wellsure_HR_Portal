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
import { HomePage } from "../pages/employee/home/HomePage";
import { EngagePage } from "../pages/employee/engage/EngagePage";
import { PayslipsPage } from "../pages/employee/salary/PayslipsPage";
import { LeaveApplyPage } from "../pages/employee/leave/LeaveApplyPage";
import { LeaveBalancesPage } from "../pages/employee/leave/LeaveBalancesPage";
import { LeaveCalendarPage } from "../pages/employee/leave/LeaveCalendarPage";
import { HolidayCalendarPage } from "../pages/employee/leave/HolidayCalendarPage";
import { AttendanceInfoPage } from "../pages/employee/attendance/AttendanceInfoPage";

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
  description?: string;
}

export interface EmployeeMenuGroup {
  key: string;
  label: string;
  icon?: ComponentType;
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
    children: [
      { key: "kudos", label: "Kudos", path: "my-worklife/kudos", icon: TrophyOutlined, phase: "Phase 5" },
      {
        key: "feedback",
        label: "Feedback",
        path: "my-worklife/feedback",
        icon: CommentOutlined,
        phase: "Phase 5",
      },
    ],
  },
  {
    key: "todo",
    label: "To do",
    icon: CheckSquareOutlined,
    children: [
      { key: "tasks", label: "Tasks", path: "todo/tasks", icon: UnorderedListOutlined, phase: "Phase 5" },
      { key: "review", label: "Review", path: "todo/review", icon: AuditOutlined, phase: "Phase 5" },
    ],
  },
  {
    key: "salary",
    label: "Salary",
    icon: DollarOutlined,
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
    children: [
      {
        key: "leave-apply",
        label: "Leave Apply",
        path: "leave/apply",
        icon: PlusCircleOutlined,
        element: LeaveApplyPage,
      },
      {
        key: "leave-balances",
        label: "Leave Balances",
        path: "leave/balances",
        icon: PieChartOutlined,
        element: LeaveBalancesPage,
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
      },
    ],
  },
  {
    key: "attendance",
    label: "Attendance",
    icon: ClockCircleOutlined,
    children: [
      {
        key: "attendance-info",
        label: "Attendance Info",
        path: "attendance/info",
        icon: FieldTimeOutlined,
        element: AttendanceInfoPage,
      },
    ],
  },
  {
    key: "document-center",
    label: "Document Center",
    path: "document-center",
    icon: FolderOutlined,
    phase: "Phase 5",
  },
  {
    key: "people",
    label: "People",
    path: "people",
    icon: TeamOutlined,
    phase: "Phase 5",
  },
  {
    key: "helpdesk",
    label: "Helpdesk",
    path: "helpdesk",
    icon: CustomerServiceOutlined,
    phase: "Phase 5",
  },
  {
    key: "request-hub",
    label: "Request Hub",
    path: "request-hub",
    icon: InboxOutlined,
    phase: "Phase 5",
  },
  {
    key: "workflow-delegates",
    label: "Workflow Delegates",
    path: "workflow-delegates",
    icon: SwapOutlined,
    phase: "Phase 5",
  },
];
