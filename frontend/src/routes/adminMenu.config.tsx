import type { ComponentType } from "react";
import {
  AuditOutlined,
  BankOutlined,
  BranchesOutlined,
  CalculatorOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CloudUploadOutlined,
  DesktopOutlined,
  DollarOutlined,
  ExportOutlined,
  FileProtectOutlined,
  FileTextOutlined,
  FundOutlined,
  GiftOutlined,
  GroupOutlined,
  HistoryOutlined,
  HomeOutlined,
  IdcardOutlined,
  NotificationOutlined,
  PartitionOutlined,
  PieChartOutlined,
  RocketOutlined,
  SafetyOutlined,
  ScheduleOutlined,
  SettingOutlined,
  SolutionOutlined,
  SwapOutlined,
  TeamOutlined,
  ToolOutlined,
  TrophyOutlined,
  UsbOutlined,
  UserAddOutlined,
  UserSwitchOutlined,
  WalletOutlined,
} from "@ant-design/icons";
import { AdminHomePage } from "../pages/admin/home/HomePage";
import { WorkforceOverviewPage } from "../pages/admin/workforce/OverviewPage";
import { OrganisationSetupPage } from "../pages/admin/organisation/OrganisationSetupPage";
import { AllEmployeesPage } from "../pages/admin/employee/AllEmployeesPage";
import { AddEmployeePage } from "../pages/admin/employee/AddEmployeePage";
import { SeparationsPage } from "../pages/admin/employee/SeparationsPage";
import { ChangeRequestsPage } from "../pages/admin/employee/ChangeRequestsPage";
import { ImportCenterPage } from "../pages/admin/import/ImportCenterPage";
import { AuditLogPage } from "../pages/admin/auditLog/AuditLogPage";
import { SystemSettingsPage } from "../pages/admin/settings/SystemSettingsPage";

// Single source of truth for the HR/Admin portal's App Switcher and each
// app's top-bar dropdown menus (docs/UI_REFERENCE.md §2.0). "Homepage",
// "Employee", "Workforce Management", "Assets Management", "Tasks",
// "Workflow", "Reports" and "Engage" are greytHR's own app tiles; Payroll
// and Admin Tools are ours, added per docs/PROJECT_SPEC.md §7.

export interface AdminMenuLeaf {
  key: string;
  label: string;
  path: string; // relative to /admin
  icon?: ComponentType;
  element?: ComponentType;
  phase?: string;
}

export interface AdminMenuGroup {
  key: string;
  label: string;
  items: AdminMenuLeaf[];
}

export interface AdminApp {
  key: string;
  label: string;
  subLabel?: string;
  icon: ComponentType;
  path: string;
  element?: ComponentType;
  phase?: string;
  menus?: AdminMenuGroup[];
}

export const adminApps: AdminApp[] = [
  {
    key: "homepage",
    label: "Homepage",
    icon: HomeOutlined,
    path: "",
    element: AdminHomePage,
  },
  {
    key: "employee",
    label: "Employee",
    icon: IdcardOutlined,
    path: "employee",
    phase: "Phase 1",
    menus: [
      {
        key: "employee",
        label: "Employee",
        items: [
          { key: "all-employees", label: "All Employees", path: "employee/all", icon: TeamOutlined, element: AllEmployeesPage },
          { key: "add-employee", label: "Add Employee", path: "employee/add", icon: UserAddOutlined, element: AddEmployeePage },
          { key: "bulk-import", label: "Bulk Import", path: "employee/import", icon: CloudUploadOutlined, element: ImportCenterPage },
          { key: "change-requests", label: "Change Requests", path: "employee/change-requests", icon: SolutionOutlined, element: ChangeRequestsPage },
          { key: "separations", label: "Separations", path: "employee/separations", icon: ExportOutlined, element: SeparationsPage },
        ],
      },
    ],
  },
  {
    key: "workforce",
    label: "Workforce Management",
    subLabel: "Formerly Leave & Attendance",
    icon: ScheduleOutlined,
    path: "workforce",
    element: WorkforceOverviewPage,
    menus: [
      {
        key: "leave",
        label: "Leave",
        items: [
          { key: "leave-calendar", label: "Leave Calendar", path: "workforce/leave/calendar", icon: CalendarOutlined, phase: "Phase 4" },
          { key: "employee-leave", label: "Employee Leave", path: "workforce/leave/employee-leave", icon: SolutionOutlined, phase: "Phase 4" },
          { key: "leave-granter", label: "Leave Granter", path: "workforce/leave/granter", icon: GiftOutlined, phase: "Phase 4" },
          { key: "year-end-process", label: "Year End Process", path: "workforce/leave/year-end", icon: HistoryOutlined, phase: "Phase 4" },
          { key: "leave-recalculator", label: "Leave Recalculator", path: "workforce/leave/recalculator", icon: CalculatorOutlined, phase: "Phase 4" },
        ],
      },
      {
        key: "attendance",
        label: "Attendance",
        items: [
          { key: "who-is-in", label: "Who Is In?", path: "workforce/attendance/who-is-in", icon: TeamOutlined, phase: "Phase 2" },
          { key: "shift-roster", label: "Shift Roster", path: "workforce/attendance/shift-roster", icon: ScheduleOutlined, phase: "Phase 2" },
          { key: "employee-swipes", label: "Employee Swipes", path: "workforce/attendance/swipes", icon: DesktopOutlined, phase: "Phase 3" },
          { key: "attendance-muster", label: "Attendance Muster", path: "workforce/attendance/muster", icon: FileTextOutlined, phase: "Phase 3" },
          { key: "attendance-info", label: "Attendance Info", path: "workforce/attendance/info", icon: CalendarOutlined, phase: "Phase 3" },
          { key: "process-attendance", label: "Process Attendance", path: "workforce/attendance/process", icon: ToolOutlined, phase: "Phase 3" },
          { key: "period-finalisation", label: "Attendance Period Finalisation", path: "workforce/attendance/finalisation", icon: SafetyOutlined, phase: "Phase 3" },
          { key: "attendance-exception", label: "Attendance Exception", path: "workforce/attendance/exceptions", icon: AuditOutlined, phase: "Phase 3" },
          { key: "manual-override", label: "Manual Override", path: "workforce/attendance/manual-override", icon: ToolOutlined, phase: "Phase 3" },
          { key: "shift-override", label: "Shift Override", path: "workforce/attendance/shift-override", icon: SwapOutlined, phase: "Phase 3" },
        ],
      },
    ],
  },
  {
    key: "assets",
    label: "Assets Management",
    icon: DesktopOutlined,
    path: "assets",
    phase: "Phase 8",
  },
  {
    key: "tasks",
    label: "Tasks",
    icon: CheckSquareOutlined,
    path: "tasks",
    phase: "Phase 5",
  },
  {
    key: "workflow",
    label: "Workflow",
    icon: BranchesOutlined,
    path: "workflow",
    phase: "Phase 5",
  },
  {
    key: "reports",
    label: "Reports",
    icon: PieChartOutlined,
    path: "reports",
    phase: "Phase 5",
  },
  {
    key: "engage-admin",
    label: "Engage",
    icon: RocketOutlined,
    path: "engage",
    phase: "Phase 5",
    menus: [
      {
        key: "engage",
        label: "Engage",
        items: [
          { key: "announcements", label: "Announcements", path: "engage/announcements", icon: NotificationOutlined, phase: "Phase 5" },
          { key: "moderation", label: "Moderation", path: "engage/moderation", icon: SafetyOutlined, phase: "Phase 5" },
          { key: "groups", label: "Groups", path: "engage/groups", icon: GroupOutlined, phase: "Phase 5" },
          { key: "auto-post-settings", label: "Auto-Post Settings", path: "engage/auto-posts", icon: TrophyOutlined, phase: "Phase 5" },
        ],
      },
    ],
  },
  {
    key: "payroll",
    label: "Payroll",
    icon: DollarOutlined,
    path: "payroll",
    phase: "Phase 6",
    menus: [
      {
        key: "payroll",
        label: "Payroll",
        items: [
          { key: "salary-components", label: "Salary Components", path: "payroll/components", icon: SettingOutlined, phase: "Phase 6" },
          { key: "salary-structures", label: "Salary Structures", path: "payroll/structures", icon: PartitionOutlined, phase: "Phase 6" },
          { key: "employee-salaries", label: "Employee Salaries", path: "payroll/salaries", icon: WalletOutlined, phase: "Phase 6" },
          { key: "payroll-run", label: "Payroll Run", path: "payroll/run", icon: FundOutlined, phase: "Phase 6" },
          { key: "payslips-admin", label: "Payslips", path: "payroll/payslips", icon: FileTextOutlined, phase: "Phase 6" },
          { key: "statutory-outputs", label: "Statutory Outputs", path: "payroll/statutory", icon: FileProtectOutlined, phase: "Phase 6" },
          { key: "loans-admin", label: "Loans & Advances", path: "payroll/loans", icon: BankOutlined, phase: "Phase 6" },
          { key: "bank-disbursement", label: "Bank Disbursement", path: "payroll/disbursement", icon: BankOutlined, phase: "Phase 6" },
        ],
      },
    ],
  },
  {
    key: "admin-tools",
    label: "Admin Tools",
    icon: ToolOutlined,
    path: "admin-tools",
    phase: "Phase 1",
    menus: [
      {
        key: "admin-tools",
        label: "Admin Tools",
        items: [
          { key: "organisation-setup", label: "Organisation Setup", path: "admin-tools/organisation", icon: PartitionOutlined, element: OrganisationSetupPage },
          { key: "holiday-calendars", label: "Holiday Calendars", path: "admin-tools/holidays", icon: GiftOutlined, phase: "Phase 4" },
          { key: "shift-master", label: "Shift Master", path: "admin-tools/shifts", icon: ScheduleOutlined, phase: "Phase 2" },
          { key: "week-off-patterns", label: "Week-off Patterns", path: "admin-tools/week-offs", icon: CalendarOutlined, phase: "Phase 2" },
          { key: "leave-types-policies", label: "Leave Types & Policies", path: "admin-tools/leave-policies", icon: SolutionOutlined, phase: "Phase 4" },
          { key: "approval-workflows", label: "Approval Workflows", path: "admin-tools/workflows", icon: BranchesOutlined, phase: "Phase 5" },
          { key: "workflow-delegates-admin", label: "Workflow Delegates", path: "admin-tools/delegates", icon: UserSwitchOutlined, phase: "Phase 5" },
          { key: "users-roles", label: "Users & Roles", path: "admin-tools/users-roles", icon: TeamOutlined, phase: "Phase 1" },
          { key: "templates", label: "Email & Letter Templates", path: "admin-tools/templates", icon: FileTextOutlined, phase: "Phase 5" },
          { key: "devices", label: "Devices", path: "admin-tools/devices", icon: UsbOutlined, phase: "Phase 2" },
          { key: "import-export", label: "Data Import/Export", path: "admin-tools/import-export", icon: CloudUploadOutlined, element: ImportCenterPage },
          { key: "audit-log", label: "Audit Log", path: "admin-tools/audit-log", icon: AuditOutlined, element: AuditLogPage },
          { key: "system-settings", label: "System Settings", path: "admin-tools/settings", icon: SettingOutlined, element: SystemSettingsPage },
        ],
      },
    ],
  },
];
