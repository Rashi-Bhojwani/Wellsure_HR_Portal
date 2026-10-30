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
  PauseCircleOutlined,
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
import { lazyPage } from "./lazyPage";

const AdminHomePage = lazyPage(() => import("../pages/admin/home/HomePage"), "AdminHomePage");
const WorkforceOverviewPage = lazyPage(() => import("../pages/admin/workforce/OverviewPage"), "WorkforceOverviewPage");
const AdminLeaveCalendarPage = lazyPage(() => import("../pages/admin/workforce/AdminLeaveCalendarPage"), "AdminLeaveCalendarPage");
const EmployeeLeavePage = lazyPage(() => import("../pages/admin/workforce/EmployeeLeavePage"), "EmployeeLeavePage");
const LeaveGranterPage = lazyPage(() => import("../pages/admin/workforce/LeaveGranterPage"), "LeaveGranterPage");
const YearEndProcessPage = lazyPage(() => import("../pages/admin/workforce/YearEndProcessPage"), "YearEndProcessPage");
const LeaveRecalculatorPage = lazyPage(() => import("../pages/admin/workforce/LeaveRecalculatorPage"), "LeaveRecalculatorPage");
const OrganisationSetupPage = lazyPage(() => import("../pages/admin/organisation/OrganisationSetupPage"), "OrganisationSetupPage");
const AllEmployeesPage = lazyPage(() => import("../pages/admin/employee/AllEmployeesPage"), "AllEmployeesPage");
const AddEmployeePage = lazyPage(() => import("../pages/admin/employee/AddEmployeePage"), "AddEmployeePage");
const SeparationsPage = lazyPage(() => import("../pages/admin/employee/SeparationsPage"), "SeparationsPage");
const ChangeRequestsPage = lazyPage(() => import("../pages/admin/employee/ChangeRequestsPage"), "ChangeRequestsPage");
const ImportCenterPage = lazyPage(() => import("../pages/admin/import/ImportCenterPage"), "ImportCenterPage");
const AuditLogPage = lazyPage(() => import("../pages/admin/auditLog/AuditLogPage"), "AuditLogPage");
const PayrollAuditPage = lazyPage(() => import("../pages/admin/auditLog/AuditLogPage"), "PayrollAuditPage");
const SystemSettingsPage = lazyPage(() => import("../pages/admin/settings/SystemSettingsPage"), "SystemSettingsPage");
const CompanyDocumentsPage = lazyPage(() => import("../pages/admin/documents/CompanyDocumentsPage"), "CompanyDocumentsPage");
const LeaveTypesPoliciesPage = lazyPage(() => import("../pages/admin/adminTools/LeaveTypesPoliciesPage"), "LeaveTypesPoliciesPage");
const HolidayCalendarsAdminPage = lazyPage(() => import("../pages/admin/adminTools/HolidayCalendarsAdminPage"), "HolidayCalendarsAdminPage");
const AnnouncementsAdminPage = lazyPage(() => import("../pages/admin/engage/AnnouncementsAdminPage"), "AnnouncementsAdminPage");
const ModerationPage = lazyPage(() => import("../pages/admin/engage/ModerationPage"), "ModerationPage");
const GroupsAdminPage = lazyPage(() => import("../pages/admin/engage/GroupsAdminPage"), "GroupsAdminPage");
const AutoPostSettingsPage = lazyPage(() => import("../pages/admin/engage/AutoPostSettingsPage"), "AutoPostSettingsPage");
const HelpdeskQueuePage = lazyPage(() => import("../pages/admin/helpdesk/HelpdeskQueuePage"), "HelpdeskQueuePage");
const HelpdeskCategoriesPage = lazyPage(() => import("../pages/admin/helpdesk/HelpdeskCategoriesPage"), "HelpdeskCategoriesPage");
const AdminTasksPage = lazyPage(() => import("../pages/admin/tasks/AdminTasksPage"), "AdminTasksPage");
const LetterTemplatesPage = lazyPage(() => import("../pages/admin/letters/LetterTemplatesPage"), "LetterTemplatesPage");
const RolesPermissionsPage = lazyPage(() => import("../pages/admin/adminTools/RolesPermissionsPage"), "RolesPermissionsPage");
const HrCapabilitiesPage = lazyPage(() => import("../pages/admin/adminTools/HrCapabilitiesPage"), "HrCapabilitiesPage");
const WorkflowDelegatesAdminPage = lazyPage(() => import("../pages/admin/adminTools/WorkflowDelegatesAdminPage"), "WorkflowDelegatesAdminPage");
const ReportsHomePage = lazyPage(() => import("../pages/admin/reports/ReportsHomePage"), "ReportsHomePage");
const CelebrationsReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "CelebrationsReportPage");
const HeadcountReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "HeadcountReportPage");
const JoinersReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "JoinersReportPage");
const LeaveBalanceReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "LeaveBalanceReportPage");
const LeaveLiabilityReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "LeaveLiabilityReportPage");
const LeaversReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "LeaversReportPage");
const LopReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "LopReportPage");
const LateComingReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "LateComingReportPage");
const ExcessHoursReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "ExcessHoursReportPage");
const ExceptionSummaryReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "ExceptionSummaryReportPage");
const AttendanceSummaryReportPage = lazyPage(() => import("../pages/admin/reports/reportPages"), "AttendanceSummaryReportPage");
const ManagerManagementPage = lazyPage(() => import("../pages/admin/adminTools/ManagerManagementPage"), "ManagerManagementPage");
const DevicesPage = lazyPage(() => import("../pages/admin/devices/DevicesPage"), "DevicesPage");
const FinalisationPage = lazyPage(() => import("../pages/admin/attendance/FinalisationPage"), "FinalisationPage");
const ExceptionsPage = lazyPage(() => import("../pages/admin/attendance/ExceptionsPage"), "ExceptionsPage");
const ProcessAttendancePage = lazyPage(() => import("../pages/admin/attendance/ProcessAttendancePage"), "ProcessAttendancePage");
const MusterPage = lazyPage(() => import("../pages/admin/attendance/muster/MusterPage"), "MusterPage");
const WhoIsInPage = lazyPage(() => import("../pages/admin/attendance/WhoIsInPage"), "WhoIsInPage");
const AttendanceInfoAdminPage = lazyPage(() => import("../pages/admin/attendance/AttendanceInfoAdminPage"), "AttendanceInfoAdminPage");
const RegularizationsPage = lazyPage(() => import("../pages/admin/attendance/RegularizationsPage"), "RegularizationsPage");
const ManualOverridePage = lazyPage(() => import("../pages/admin/attendance/ManualOverridePage"), "ManualOverridePage");
const ShiftOverridePage = lazyPage(() => import("../pages/admin/attendance/ShiftOverridePage"), "ShiftOverridePage");
const ShiftRosterPage = lazyPage(() => import("../pages/admin/attendance/ShiftRosterPage"), "ShiftRosterPage");
const EmployeeSwipesPage = lazyPage(() => import("../pages/admin/attendance/EmployeeSwipesPage"), "EmployeeSwipesPage");
const RulesPage = lazyPage(() => import("../pages/admin/payroll/RulesPage"), "RulesPage");
const ComponentsPage = lazyPage(() => import("../pages/admin/payroll/ComponentsPage"), "ComponentsPage");
const StructuresPage = lazyPage(() => import("../pages/admin/payroll/StructuresPage"), "StructuresPage");
const EmployeeSalariesPage = lazyPage(() => import("../pages/admin/payroll/EmployeeSalariesPage"), "EmployeeSalariesPage");
const SalaryRevisionsPage = lazyPage(() => import("../pages/admin/payroll/SalaryRevisionsPage"), "SalaryRevisionsPage");
const HeldSalariesPage = lazyPage(() => import("../pages/admin/payroll/HeldSalariesPage"), "HeldSalariesPage");
const AdjustmentsPage = lazyPage(() => import("../pages/admin/payroll/AdjustmentsPage"), "AdjustmentsPage");
const PayrollRunsPage = lazyPage(() => import("../pages/admin/payroll/PayrollRunsPage"), "PayrollRunsPage");
const LayoutsPage = lazyPage(() => import("../pages/admin/payroll/LayoutsPage"), "LayoutsPage");
const SetupChecklistPage = lazyPage(() => import("../pages/admin/payroll/SetupChecklistPage"), "SetupChecklistPage");
// Anyone holding any payroll key sees the Payroll group; HR holds none (the hard lock), so HR never sees it. The server still decides every request.
const PAYROLL_NEEDS = { any: ["payroll.rules.view", "payroll.salary.view", "payroll.run", "payroll.approve"] };
const ReadyPage = lazyPage(() => import("../pages/admin/payroll/ReadyPage"), "ReadyPage");
const CompareRegistersPage = lazyPage(() => import("../pages/admin/payroll/CompareRegistersPage"), "CompareRegistersPage");
const AttendanceSettingsPage = lazyPage(() => import("../pages/admin/attendance/AttendanceSettingsPage"), "AttendanceSettingsPage");
const ShiftMasterPage = lazyPage(() => import("../pages/admin/attendance/AttendanceSettingsPage"), "ShiftMasterPage");
const WeekOffPatternsPage = lazyPage(() => import("../pages/admin/attendance/AttendanceSettingsPage"), "WeekOffPatternsPage");

// Single source of truth for the HR/Admin portal's App Switcher and each
// app's top-bar dropdown menus (docs/UI_REFERENCE.md §2.0). "Homepage",
// "Employee", "Workforce Management", "Assets Management", "Tasks",
// "Reports" and "Engage" are greytHR's own app tiles (greytHR's "Workflow" tile is deliberately absent — no general approval chains, spec §7.8); Payroll
// and Admin Tools are ours, added per docs/PROJECT_SPEC.md §7.

/**
 * What a person needs to see (and open) a menu item. `any`: one of these permission keys. `director`: only a Super Admin. Without it the item shows to everyone who reaches the admin portal
 * (the server still decides; this is so a switched-off duty disappears from the sidebar, the search box and the page itself, instead of opening onto an error).
 */
export interface AdminNeeds {
  any?: readonly string[];
  director?: boolean;
}

export interface AdminMenuLeaf {
  key: string;
  label: string;
  path: string; // relative to /admin
  icon?: ComponentType;
  element?: ComponentType;
  phase?: string;
  needs?: AdminNeeds;
}

export function adminNeedsMet(needs: AdminNeeds | undefined, hasPermission: (key: string) => boolean, isDirector: boolean): boolean {
  if (!needs) return true;
  if (isDirector) return true;
  if (needs.director) return false;
  return !needs.any || needs.any.some(hasPermission);
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

/** What the admin page at `path` (an in-app path such as /admin/workforce/attendance/who-is-in) needs, or undefined when it needs nothing special / is not a menu page. */
export function adminNeedsForPath(path: string): AdminNeeds | undefined {
  const clean = path.split(/[?#]/)[0]!.replace(/\/+$/, "");
  for (const app of adminApps) for (const group of app.menus ?? []) for (const item of group.items) if (`/admin/${item.path}` === clean) return item.needs;
  return undefined;
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
          { key: "bulk-import", label: "Bulk Import", path: "employee/import", icon: CloudUploadOutlined, element: ImportCenterPage, needs: { any: ["import.manage", "import.details.manage", "invitations.send"] } },
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
          { key: "employee-leave", label: "Employee Leave", path: "workforce/leave/employee-leave", icon: SolutionOutlined, element: EmployeeLeavePage, needs: { any: ["leave.view", "leave.approve"] } },
          { key: "leave-granter", label: "Leave Granter", path: "workforce/leave/granter", icon: GiftOutlined, element: LeaveGranterPage, needs: { any: ["leave.grant"] } },
          { key: "year-end-process", label: "Year End Process", path: "workforce/leave/year-end", icon: HistoryOutlined, element: YearEndProcessPage, needs: { any: ["leave.yearend.manage"] } },
          { key: "leave-recalculator", label: "Leave Recalculator", path: "workforce/leave/recalculator", icon: CalculatorOutlined, element: LeaveRecalculatorPage, needs: { any: ["leave.recalculate"] } },
        ],
      },
      {
        key: "attendance",
        label: "Attendance",
        items: [
          { key: "who-is-in", label: "Who Is In?", path: "workforce/attendance/who-is-in", icon: TeamOutlined, element: WhoIsInPage, needs: { any: ["attendance.view"] } },
          { key: "shift-roster", label: "Shift Roster", path: "workforce/attendance/shift-roster", icon: ScheduleOutlined, element: ShiftRosterPage, needs: { any: ["attendance.roster.manage"] } },
          { key: "employee-swipes", label: "Employee Swipes", path: "workforce/attendance/swipes", icon: DesktopOutlined, element: EmployeeSwipesPage, needs: { any: ["attendance.swipes.view"] } },
          { key: "attendance-muster", label: "Attendance Muster", path: "workforce/attendance/muster", icon: FileTextOutlined, element: MusterPage, needs: { any: ["attendance.view", "attendance.manual.enter"] } },
          { key: "attendance-info", label: "Attendance Info", path: "workforce/attendance/info", icon: CalendarOutlined, element: AttendanceInfoAdminPage, needs: { any: ["attendance.view"] } },
          { key: "regularizations", label: "Regularizations", path: "workforce/attendance/regularizations", icon: AuditOutlined, element: RegularizationsPage, needs: { any: ["attendance.regularization.view", "attendance.regularization.approve"] } },
          { key: "process-attendance", label: "Process Attendance", path: "workforce/attendance/process", icon: ToolOutlined, element: ProcessAttendancePage, needs: { any: ["attendance.process"] } },
          { key: "period-finalisation", label: "Attendance Period Finalisation", path: "workforce/attendance/finalisation", icon: SafetyOutlined, element: FinalisationPage, needs: { any: ["attendance.finalise", "attendance.process"] } },
          { key: "attendance-exception", label: "Attendance Exception", path: "workforce/attendance/exceptions", icon: AuditOutlined, element: ExceptionsPage, needs: { any: ["attendance.exceptions.view"] } },
          { key: "manual-override", label: "Manual Override", path: "workforce/attendance/manual-override", icon: ToolOutlined, element: ManualOverridePage, needs: { any: ["attendance.override.manage"] } },
          { key: "shift-override", label: "Shift Override", path: "workforce/attendance/shift-override", icon: SwapOutlined, element: ShiftOverridePage, needs: { any: ["attendance.override.manage"] } },
          { key: "attendance-settings", label: "Attendance Settings", path: "workforce/attendance/settings", icon: SettingOutlined, element: AttendanceSettingsPage, needs: { any: ["attendance.config.manage", "attendance.view"] } },
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
          { key: "report-headcount", label: "Headcount", path: "reports/headcount", element: HeadcountReportPage, needs: { any: ["reports.view"] } },
          { key: "report-joiners", label: "Joiners", path: "reports/joiners", element: JoinersReportPage, needs: { any: ["reports.view"] } },
          { key: "report-leavers", label: "Leavers & attrition", path: "reports/leavers", element: LeaversReportPage, needs: { any: ["reports.view"] } },
          { key: "report-celebrations", label: "Birthdays & anniversaries", path: "reports/celebrations", element: CelebrationsReportPage, needs: { any: ["reports.view"] } },
        ],
      },
      {
        key: "leave-reports",
        label: "Leave",
        items: [
          { key: "report-leave-balance", label: "Leave balance", path: "reports/leave-balance", element: LeaveBalanceReportPage, needs: { any: ["reports.leave.view"] } },
          { key: "report-leave-liability", label: "Leave liability", path: "reports/leave-liability", element: LeaveLiabilityReportPage, needs: { any: ["reports.liability.view"] } },
          { key: "report-lop", label: "Loss of pay (LOP)", path: "reports/lop", element: LopReportPage, needs: { any: ["reports.leave.view"] } },
        ],
      },
      {
        key: "attendance-reports",
        label: "Attendance",
        items: [
          { key: "report-attendance-summary", label: "Attendance summary", path: "reports/attendance-muster", element: AttendanceSummaryReportPage, needs: { any: ["reports.attendance.view"] } },
          { key: "report-late-coming", label: "Late coming", path: "reports/late-coming", element: LateComingReportPage, needs: { any: ["reports.attendance.view"] } },
          { key: "report-excess-hours", label: "Excess hours", path: "reports/excess-hours", element: ExcessHoursReportPage, needs: { any: ["reports.attendance.view"] } },
          { key: "report-exception-summary", label: "Attendance exceptions", path: "reports/exception-summary", element: ExceptionSummaryReportPage, needs: { any: ["reports.attendance.view"] } },
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
    menus: [
      {
        key: "payroll",
        label: "Payroll",
        items: [
          { key: "payroll-setup", label: "Setup Checklist", path: "payroll/setup", icon: CheckSquareOutlined, element: SetupChecklistPage, needs: PAYROLL_NEEDS },
          { key: "payroll-ready", label: "Ready for First Run", path: "payroll/ready", icon: SafetyOutlined, element: ReadyPage, needs: PAYROLL_NEEDS },
          { key: "payroll-rules", label: "Rules and Setup", path: "payroll/rules", icon: SafetyCertificateOutlined, element: RulesPage, needs: PAYROLL_NEEDS },
          { key: "salary-components", label: "Salary Components", path: "payroll/components", icon: SettingOutlined, element: ComponentsPage, needs: PAYROLL_NEEDS },
          { key: "salary-structures", label: "Salary Structures", path: "payroll/structures", icon: PartitionOutlined, element: StructuresPage, needs: PAYROLL_NEEDS },
          { key: "employee-salaries", label: "Employee Salaries", path: "payroll/salaries", icon: WalletOutlined, element: EmployeeSalariesPage, needs: PAYROLL_NEEDS },
          { key: "salary-revisions", label: "Salary Revisions", path: "payroll/revisions", icon: AuditOutlined, element: SalaryRevisionsPage, needs: PAYROLL_NEEDS },
          { key: "payroll-adjustments", label: "Adjustments", path: "payroll/adjustments", icon: DiffOutlined, element: AdjustmentsPage, needs: PAYROLL_NEEDS },
          { key: "payroll-holds", label: "Held Salaries", path: "payroll/holds", icon: PauseCircleOutlined, element: HeldSalariesPage, needs: PAYROLL_NEEDS },
          { key: "payroll-run", label: "Payroll Run", path: "payroll/run", icon: FundOutlined, element: PayrollRunsPage, needs: PAYROLL_NEEDS },
          { key: "payroll-compare", label: "Compare Registers", path: "payroll/compare", icon: DiffOutlined, element: CompareRegistersPage, needs: PAYROLL_NEEDS },
          { key: "payroll-audit", label: "Payroll Audit Trail", path: "payroll/audit", icon: AuditOutlined, element: PayrollAuditPage, needs: PAYROLL_NEEDS },
          { key: "payroll-layouts", label: "Bank and Statutory Layouts", path: "payroll/layouts", icon: FileProtectOutlined, element: LayoutsPage, needs: PAYROLL_NEEDS },
          { key: "loans-admin", label: "Loans & Advances", path: "payroll/loans", icon: BankOutlined, phase: "Phase 7", needs: PAYROLL_NEEDS },
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
          { key: "organisation-setup", label: "Organisation Setup", path: "admin-tools/organisation", icon: PartitionOutlined, element: OrganisationSetupPage, needs: { any: ["org.manage"] } },
          { key: "holiday-calendars", label: "Holiday Calendars", path: "admin-tools/holidays", icon: GiftOutlined, element: HolidayCalendarsAdminPage, needs: { any: ["leave.policy.manage"] } },
          { key: "shift-master", label: "Shift Master", path: "admin-tools/shifts", icon: ScheduleOutlined, element: ShiftMasterPage, needs: { any: ["attendance.config.manage"] } },
          { key: "week-off-patterns", label: "Week-off Patterns", path: "admin-tools/week-offs", icon: CalendarOutlined, element: WeekOffPatternsPage, needs: { any: ["attendance.config.manage"] } },
          { key: "leave-types-policies", label: "Leave Types & Policies", path: "admin-tools/leave-policies", icon: SolutionOutlined, element: LeaveTypesPoliciesPage, needs: { any: ["leave.policy.manage"] } },
          { key: "workflow-delegates-admin", label: "Workflow Delegates", path: "admin-tools/delegates", icon: UserSwitchOutlined, element: WorkflowDelegatesAdminPage, needs: { any: ["delegation.manage"] } },
          { key: "users-roles", label: "Roles & Permissions", path: "admin-tools/users-roles", icon: TeamOutlined, element: RolesPermissionsPage, needs: { any: ["role.view"] } },
          { key: "hr-capabilities", label: "What HR Can Do", path: "admin-tools/hr-capabilities", icon: SafetyOutlined, element: HrCapabilitiesPage, needs: { director: true } },
          { key: "managers", label: "Manager Management", path: "admin-tools/managers", icon: ApartmentOutlined, element: ManagerManagementPage, needs: { any: ["manager.appoint", "manager.team.assign", "manager.permissions.manage"] } },
          { key: "helpdesk-categories", label: "Helpdesk Categories", path: "admin-tools/helpdesk-categories", icon: CustomerServiceOutlined, element: HelpdeskCategoriesPage, needs: { any: ["helpdesk.manage"] } },
          { key: "templates", label: "Email & Letter Templates", path: "admin-tools/templates", icon: FileTextOutlined, element: LetterTemplatesPage, needs: { any: ["letters.template.manage"] } },
          { key: "devices", label: "Devices", path: "admin-tools/devices", icon: UsbOutlined, element: DevicesPage, needs: { any: ["attendance.devices.manage"] } },
          { key: "import-export", label: "Data Import/Export", path: "admin-tools/import-export", icon: CloudUploadOutlined, element: ImportCenterPage, needs: { any: ["import.manage", "import.details.manage", "invitations.send"] } },
          { key: "audit-log", label: "Audit Log", path: "admin-tools/audit-log", icon: AuditOutlined, element: AuditLogPage, needs: { any: ["audit.view"] } },
          { key: "system-settings", label: "System Settings", path: "admin-tools/settings", icon: SettingOutlined, element: SystemSettingsPage, needs: { any: ["settings.manage"] } },
        ],
      },
    ],
  },
];
