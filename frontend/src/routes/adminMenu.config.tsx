import type { ComponentType } from "react";
import {
  AuditOutlined,
  BankOutlined,
  CalculatorOutlined,
  CalendarOutlined,
  CheckSquareOutlined,
  CloudUploadOutlined,
  CustomerServiceOutlined,
  DesktopOutlined,
  DollarOutlined,
  ExportOutlined,
  FileProtectOutlined,
  SafetyCertificateOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FundOutlined,
  GiftOutlined,
  GroupOutlined,
  DiffOutlined,
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
  ApartmentOutlined,
} from "@ant-design/icons";
import { AdminHomePage } from "../pages/admin/home/HomePage";
import { WorkforceOverviewPage } from "../pages/admin/workforce/OverviewPage";
import { AdminLeaveCalendarPage } from "../pages/admin/workforce/AdminLeaveCalendarPage";
import { EmployeeLeavePage } from "../pages/admin/workforce/EmployeeLeavePage";
import { LeaveGranterPage } from "../pages/admin/workforce/LeaveGranterPage";
import { YearEndProcessPage } from "../pages/admin/workforce/YearEndProcessPage";
import { LeaveRecalculatorPage } from "../pages/admin/workforce/LeaveRecalculatorPage";
import { OrganisationSetupPage } from "../pages/admin/organisation/OrganisationSetupPage";
import { AllEmployeesPage } from "../pages/admin/employee/AllEmployeesPage";
import { AddEmployeePage } from "../pages/admin/employee/AddEmployeePage";
import { SeparationsPage } from "../pages/admin/employee/SeparationsPage";
import { ChangeRequestsPage } from "../pages/admin/employee/ChangeRequestsPage";
import { ImportCenterPage } from "../pages/admin/import/ImportCenterPage";
import { AuditLogPage } from "../pages/admin/auditLog/AuditLogPage";
import { SystemSettingsPage } from "../pages/admin/settings/SystemSettingsPage";
import { CompanyDocumentsPage } from "../pages/admin/documents/CompanyDocumentsPage";
import { LeaveTypesPoliciesPage } from "../pages/admin/adminTools/LeaveTypesPoliciesPage";
import { HolidayCalendarsAdminPage } from "../pages/admin/adminTools/HolidayCalendarsAdminPage";
import { AnnouncementsAdminPage } from "../pages/admin/engage/AnnouncementsAdminPage";
import { ModerationPage } from "../pages/admin/engage/ModerationPage";
import { GroupsAdminPage } from "../pages/admin/engage/GroupsAdminPage";
import { AutoPostSettingsPage } from "../pages/admin/engage/AutoPostSettingsPage";
import { HelpdeskQueuePage } from "../pages/admin/helpdesk/HelpdeskQueuePage";
import { HelpdeskCategoriesPage } from "../pages/admin/helpdesk/HelpdeskCategoriesPage";
import { AdminTasksPage } from "../pages/admin/tasks/AdminTasksPage";
import { LetterTemplatesPage } from "../pages/admin/letters/LetterTemplatesPage";
import { RolesPermissionsPage } from "../pages/admin/adminTools/RolesPermissionsPage";
import { WorkflowDelegatesAdminPage } from "../pages/admin/adminTools/WorkflowDelegatesAdminPage";
import { ReportsHomePage } from "../pages/admin/reports/ReportsHomePage";
import { CelebrationsReportPage, HeadcountReportPage, JoinersReportPage, LeaveBalanceReportPage, LeaveLiabilityReportPage, LeaversReportPage, LopReportPage, LateComingReportPage, ExcessHoursReportPage, ExceptionSummaryReportPage, AttendanceSummaryReportPage } from "../pages/admin/reports/reportPages";
import { ManagerManagementPage } from "../pages/admin/adminTools/ManagerManagementPage";
import { DevicesPage } from "../pages/admin/devices/DevicesPage";
import { FinalisationPage } from "../pages/admin/attendance/FinalisationPage";
import { ExceptionsPage } from "../pages/admin/attendance/ExceptionsPage";
import { ProcessAttendancePage } from "../pages/admin/attendance/ProcessAttendancePage";
import { MusterPage } from "../pages/admin/attendance/muster/MusterPage";
import { WhoIsInPage } from "../pages/admin/attendance/WhoIsInPage";
import { AttendanceInfoAdminPage } from "../pages/admin/attendance/AttendanceInfoAdminPage";
import { RegularizationsPage } from "../pages/admin/attendance/RegularizationsPage";
import { ManualOverridePage } from "../pages/admin/attendance/ManualOverridePage";
import { ShiftOverridePage } from "../pages/admin/attendance/ShiftOverridePage";
import { ShiftRosterPage } from "../pages/admin/attendance/ShiftRosterPage";
import { EmployeeSwipesPage } from "../pages/admin/attendance/EmployeeSwipesPage";
import { RulesPage } from "../pages/admin/payroll/RulesPage";
import { ComponentsPage } from "../pages/admin/payroll/ComponentsPage";
import { StructuresPage } from "../pages/admin/payroll/StructuresPage";
import { EmployeeSalariesPage } from "../pages/admin/payroll/EmployeeSalariesPage";
import { SalaryRevisionsPage } from "../pages/admin/payroll/SalaryRevisionsPage";
import { AdjustmentsPage } from "../pages/admin/payroll/AdjustmentsPage";
import { AttendanceSettingsPage, ShiftMasterPage, WeekOffPatternsPage } from "../pages/admin/attendance/AttendanceSettingsPage";

// Single source of truth for the HR/Admin portal's App Switcher and each
// app's top-bar dropdown menus (docs/UI_REFERENCE.md §2.0). "Homepage",
// "Employee", "Workforce Management", "Assets Management", "Tasks",
// "Reports" and "Engage" are greytHR's own app tiles (greytHR's "Workflow" tile is deliberately absent — no general approval chains, spec §7.8); Payroll
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
    // No `phase` here even though the app itself has no dedicated
    // `element`: every item below except Users & Roles is a real, built
    // page, and router.tsx redirects this app's own base path to the
    // first one (All Employees) rather than showing a stub — see
    // resolveMenuRoutes.tsx's firstRealSubPath. A `phase` marker on an app
    // whose content is actually reachable would make routes.test.ts's
    // "every unphased route must resolve to something real" check
    // useless for exactly this app.
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
          { key: "company-documents", label: "Company Documents", path: "employee/company-documents", icon: FolderOpenOutlined, element: CompanyDocumentsPage },
          { key: "helpdesk", label: "Helpdesk", path: "employee/helpdesk", icon: CustomerServiceOutlined, element: HelpdeskQueuePage },
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
          { key: "leave-calendar", label: "Leave Calendar", path: "workforce/leave/calendar", icon: CalendarOutlined, element: AdminLeaveCalendarPage },
          { key: "employee-leave", label: "Employee Leave", path: "workforce/leave/employee-leave", icon: SolutionOutlined, element: EmployeeLeavePage },
          { key: "leave-granter", label: "Leave Granter", path: "workforce/leave/granter", icon: GiftOutlined, element: LeaveGranterPage },
          { key: "year-end-process", label: "Year End Process", path: "workforce/leave/year-end", icon: HistoryOutlined, element: YearEndProcessPage },
          { key: "leave-recalculator", label: "Leave Recalculator", path: "workforce/leave/recalculator", icon: CalculatorOutlined, element: LeaveRecalculatorPage },
        ],
      },
      {
        key: "attendance",
        label: "Attendance",
        items: [
          { key: "who-is-in", label: "Who Is In?", path: "workforce/attendance/who-is-in", icon: TeamOutlined, element: WhoIsInPage },
          { key: "shift-roster", label: "Shift Roster", path: "workforce/attendance/shift-roster", icon: ScheduleOutlined, element: ShiftRosterPage },
          { key: "employee-swipes", label: "Employee Swipes", path: "workforce/attendance/swipes", icon: DesktopOutlined, element: EmployeeSwipesPage },
          { key: "attendance-muster", label: "Attendance Muster", path: "workforce/attendance/muster", icon: FileTextOutlined, element: MusterPage },
          { key: "attendance-info", label: "Attendance Info", path: "workforce/attendance/info", icon: CalendarOutlined, element: AttendanceInfoAdminPage },
          { key: "regularizations", label: "Regularizations", path: "workforce/attendance/regularizations", icon: AuditOutlined, element: RegularizationsPage },
          { key: "process-attendance", label: "Process Attendance", path: "workforce/attendance/process", icon: ToolOutlined, element: ProcessAttendancePage },
          { key: "period-finalisation", label: "Attendance Period Finalisation", path: "workforce/attendance/finalisation", icon: SafetyOutlined, element: FinalisationPage },
          { key: "attendance-exception", label: "Attendance Exception", path: "workforce/attendance/exceptions", icon: AuditOutlined, element: ExceptionsPage },
          { key: "manual-override", label: "Manual Override", path: "workforce/attendance/manual-override", icon: ToolOutlined, element: ManualOverridePage },
          { key: "shift-override", label: "Shift Override", path: "workforce/attendance/shift-override", icon: SwapOutlined, element: ShiftOverridePage },
          { key: "attendance-settings", label: "Attendance Settings", path: "workforce/attendance/settings", icon: SettingOutlined, element: AttendanceSettingsPage },
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
    element: AdminTasksPage,
  },
  {
    key: "reports",
    label: "Reports",
    icon: PieChartOutlined,
    path: "reports",
    element: ReportsHomePage,
    menus: [
      {
        key: "people-reports",
        label: "People",
        items: [
          { key: "report-headcount", label: "Headcount", path: "reports/headcount", element: HeadcountReportPage },
          { key: "report-joiners", label: "Joiners", path: "reports/joiners", element: JoinersReportPage },
          { key: "report-leavers", label: "Leavers & attrition", path: "reports/leavers", element: LeaversReportPage },
          { key: "report-celebrations", label: "Birthdays & anniversaries", path: "reports/celebrations", element: CelebrationsReportPage },
        ],
      },
      {
        key: "leave-reports",
        label: "Leave",
        items: [
          { key: "report-leave-balance", label: "Leave balance", path: "reports/leave-balance", element: LeaveBalanceReportPage },
          { key: "report-leave-liability", label: "Leave liability", path: "reports/leave-liability", element: LeaveLiabilityReportPage },
          { key: "report-lop", label: "Loss of pay (LOP)", path: "reports/lop", element: LopReportPage },
        ],
      },
      {
        key: "attendance-reports",
        label: "Attendance",
        items: [
          { key: "report-attendance-summary", label: "Attendance summary", path: "reports/attendance-muster", element: AttendanceSummaryReportPage },
          { key: "report-late-coming", label: "Late coming", path: "reports/late-coming", element: LateComingReportPage },
          { key: "report-excess-hours", label: "Excess hours", path: "reports/excess-hours", element: ExcessHoursReportPage },
          { key: "report-exception-summary", label: "Attendance exceptions", path: "reports/exception-summary", element: ExceptionSummaryReportPage },
        ],
      },
    ],
  },
  {
    key: "engage-admin",
    label: "Engage",
    icon: RocketOutlined,
    path: "engage",
    menus: [
      {
        key: "engage",
        label: "Engage",
        items: [
          { key: "announcements", label: "Announcements", path: "engage/announcements", icon: NotificationOutlined, element: AnnouncementsAdminPage },
          { key: "moderation", label: "Moderation", path: "engage/moderation", icon: SafetyOutlined, element: ModerationPage },
          { key: "groups", label: "Groups", path: "engage/groups", icon: GroupOutlined, element: GroupsAdminPage },
          { key: "auto-post-settings", label: "Auto-Post Settings", path: "engage/auto-posts", icon: TrophyOutlined, element: AutoPostSettingsPage },
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
          { key: "payroll-rules", label: "Rules and Setup", path: "payroll/rules", icon: SafetyCertificateOutlined, element: RulesPage },
          { key: "salary-components", label: "Salary Components", path: "payroll/components", icon: SettingOutlined, element: ComponentsPage },
          { key: "salary-structures", label: "Salary Structures", path: "payroll/structures", icon: PartitionOutlined, element: StructuresPage },
          { key: "employee-salaries", label: "Employee Salaries", path: "payroll/salaries", icon: WalletOutlined, element: EmployeeSalariesPage },
          { key: "salary-revisions", label: "Salary Revisions", path: "payroll/revisions", icon: AuditOutlined, element: SalaryRevisionsPage },
          { key: "payroll-adjustments", label: "Adjustments", path: "payroll/adjustments", icon: DiffOutlined, element: AdjustmentsPage },
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
    // See the identical comment on the "employee" app above — several
    // items here are real (Organisation Setup, Data Import/Export, Audit
    // Log, System Settings); the rest still carry their own `phase`.
    menus: [
      {
        key: "admin-tools",
        label: "Admin Tools",
        items: [
          { key: "organisation-setup", label: "Organisation Setup", path: "admin-tools/organisation", icon: PartitionOutlined, element: OrganisationSetupPage },
          { key: "holiday-calendars", label: "Holiday Calendars", path: "admin-tools/holidays", icon: GiftOutlined, element: HolidayCalendarsAdminPage },
          { key: "shift-master", label: "Shift Master", path: "admin-tools/shifts", icon: ScheduleOutlined, element: ShiftMasterPage },
          { key: "week-off-patterns", label: "Week-off Patterns", path: "admin-tools/week-offs", icon: CalendarOutlined, element: WeekOffPatternsPage },
          { key: "leave-types-policies", label: "Leave Types & Policies", path: "admin-tools/leave-policies", icon: SolutionOutlined, element: LeaveTypesPoliciesPage },
          { key: "workflow-delegates-admin", label: "Workflow Delegates", path: "admin-tools/delegates", icon: UserSwitchOutlined, element: WorkflowDelegatesAdminPage },
          { key: "users-roles", label: "Roles & Permissions", path: "admin-tools/users-roles", icon: TeamOutlined, element: RolesPermissionsPage },
          { key: "managers", label: "Manager Management", path: "admin-tools/managers", icon: ApartmentOutlined, element: ManagerManagementPage },
          { key: "helpdesk-categories", label: "Helpdesk Categories", path: "admin-tools/helpdesk-categories", icon: CustomerServiceOutlined, element: HelpdeskCategoriesPage },
          { key: "templates", label: "Email & Letter Templates", path: "admin-tools/templates", icon: FileTextOutlined, element: LetterTemplatesPage },
          { key: "devices", label: "Devices", path: "admin-tools/devices", icon: UsbOutlined, element: DevicesPage },
          { key: "import-export", label: "Data Import/Export", path: "admin-tools/import-export", icon: CloudUploadOutlined, element: ImportCenterPage },
          { key: "audit-log", label: "Audit Log", path: "admin-tools/audit-log", icon: AuditOutlined, element: AuditLogPage },
          { key: "system-settings", label: "System Settings", path: "admin-tools/settings", icon: SettingOutlined, element: SystemSettingsPage },
        ],
      },
    ],
  },
];
