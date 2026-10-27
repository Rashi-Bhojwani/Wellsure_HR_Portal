import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { resolveAdminRoutes, resolveEmployeeRoutes } from "./resolveMenuRoutes";
import { lazyPage } from "./lazyPage";

// The signed-in half of the router (router.tsx mounts it, lazily, at /app/* and /admin/*). Kept out of the entry chunk so the login screen never downloads the
// shells, the menu configs or their icons (bundle budget, DESIGN_SYSTEM.md §7). Paths below are relative to /app or /admin.

// The two portal shells.
const EmployeeLayout = lazyPage(() => import("../layouts/EmployeeLayout"), "EmployeeLayout");
const AdminLayout = lazyPage(() => import("../layouts/AdminLayout"), "AdminLayout");

const AccountSecurityPage = lazyPage(
  () => import("../pages/account-security/AccountSecurityPage"),
  "AccountSecurityPage",
);
const EmployeeProfilePage = lazyPage(
  () => import("../pages/admin/employee/EmployeeProfilePage"),
  "EmployeeProfilePage",
);
const ViewMyInfoPage = lazyPage(
  () => import("../pages/employee/profile/ViewMyInfoPage"),
  "ViewMyInfoPage",
);
const HelpdeskTicketPage = lazyPage(
  () => import("../pages/employee/helpdesk/HelpdeskTicketPage"),
  "HelpdeskTicketPage",
);
const AdminHelpdeskTicketPage = lazyPage(
  () => import("../pages/admin/helpdesk/AdminHelpdeskTicketPage"),
  "AdminHelpdeskTicketPage",
);
const LetterTemplateEditorPage = lazyPage(
  () => import("../pages/admin/letters/LetterTemplateEditorPage"),
  "LetterTemplateEditorPage",
);
const PayrollRunPage = lazyPage(
  () => import("../pages/admin/payroll/PayrollRunPage"),
  "PayrollRunPage",
);
const RunStepPage = lazyPage(() => import("../pages/admin/payroll/RunStepPage"), "RunStepPage");
const MobileActionPage = lazyPage(
  () => import("../pages/employee/mobile/MobileActionPage"),
  "MobileActionPage",
);
const MobileExplorePage = lazyPage(
  () => import("../pages/employee/mobile/MobileExplorePage"),
  "MobileExplorePage",
);

// Route elements are generated from resolveMenuRoutes.tsx, not built here
// directly — that module is the single source of truth also used by
// routes.test.tsx, so a route that resolves to PlaceholderPage here is
// guaranteed to fail that test too, not just something discovered by
// clicking around.
function employeeRoutes() {
  return resolveEmployeeRoutes().map((route) => (
    <Route key={route.relativePath} path={route.relativePath} element={route.element} />
  ));
}

function adminRoutes() {
  return resolveAdminRoutes().map((route) =>
    route.isIndex ? (
      <Route key="index" index element={route.element} />
    ) : (
      <Route key={route.relativePath} path={route.relativePath} element={route.element} />
    ),
  );
}

export function PortalRoutes() {
  const { pathname } = useLocation();
  const admin = pathname === "/admin" || pathname.startsWith("/admin/");
  return (
    <Routes>
      <Route element={<RequireAuth />}>
        {admin ? (
          <Route element={<AdminLayout />}>
            <Route path="security" element={<AccountSecurityPage />} />
            <Route path="employee/profile/:id" element={<EmployeeProfilePage />} />
            <Route path="employee/helpdesk/:id" element={<AdminHelpdeskTicketPage />} />
            <Route path="admin-tools/templates/:id" element={<LetterTemplateEditorPage />} />
            <Route path="payroll/run/:id" element={<PayrollRunPage />} />
            <Route path="payroll/run/:id/step/:slug" element={<RunStepPage />} />
            {adminRoutes()}
          </Route>
        ) : (
          <Route element={<EmployeeLayout />}>
            <Route index element={<Navigate to="home" replace />} />
            <Route path="profile" element={<ViewMyInfoPage />} />
            <Route path="security" element={<AccountSecurityPage />} />
            <Route path="helpdesk/:id" element={<HelpdeskTicketPage />} />
            {/* The phone bottom bar's generated tabs (Phase 5 commit G); Home
              and Engage are ordinary menu routes. */}
            <Route path="action" element={<MobileActionPage />} />
            <Route path="explore" element={<MobileExplorePage />} />
            {employeeRoutes()}
          </Route>
        )}
      </Route>
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
