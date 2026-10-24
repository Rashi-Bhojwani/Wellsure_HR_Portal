import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { RequireAuth } from "./RequireAuth";
import { resolveAdminRoutes, resolveEmployeeRoutes } from "./resolveMenuRoutes";
import { lazyPage } from "./lazyPage";

// The two portal shells load with the first signed-in page, so the login screen never downloads them (bundle budget, DESIGN_SYSTEM.md §7).
const EmployeeLayout = lazyPage(() => import("../layouts/EmployeeLayout"), "EmployeeLayout");
const AdminLayout = lazyPage(() => import("../layouts/AdminLayout"), "AdminLayout");

const LoginPage = lazyPage(() => import("../pages/auth/login/LoginPage"), "LoginPage");
const SetPasswordPage = lazyPage(
  () => import("../pages/auth/set-password/SetPasswordPage"),
  "SetPasswordPage",
);
const ForgotPasswordPage = lazyPage(
  () => import("../pages/auth/forgot-password/ForgotPasswordPage"),
  "ForgotPasswordPage",
);
const ResetPasswordPage = lazyPage(
  () => import("../pages/auth/reset-password/ResetPasswordPage"),
  "ResetPasswordPage",
);
const TotpChallengePage = lazyPage(
  () => import("../pages/auth/totp/TotpChallengePage"),
  "TotpChallengePage",
);
const TotpSetupPage = lazyPage(() => import("../pages/auth/totp/TotpSetupPage"), "TotpSetupPage");
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
// Development builds only: the screen index for reviewing the UI pass (docs/UI_SCREEN_MAP.md). Behind import.meta.env.DEV so production bundles never contain it.
const ScreensIndexPage = import.meta.env.DEV
  ? lazy(() =>
      import("../pages/dev/ScreensIndexPage").then((m) => ({ default: m.ScreensIndexPage })),
    )
  : null;

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

// Signed-out pages and the first paint of the shell wait on a blank page in the page colour (no spinner); inside the shell, AppShell shows a page-shaped skeleton.
export function AppRouter() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/" element={<Navigate to="/login" replace />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/set-password/:token" element={<SetPasswordPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
        <Route path="/totp-challenge" element={<TotpChallengePage />} />
        <Route path="/totp-setup" element={<TotpSetupPage />} />
        {ScreensIndexPage && <Route path="/dev/screens" element={<ScreensIndexPage />} />}

        <Route element={<RequireAuth />}>
          <Route path="/app" element={<EmployeeLayout />}>
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

          <Route path="/admin" element={<AdminLayout />}>
            <Route path="security" element={<AccountSecurityPage />} />
            <Route path="employee/profile/:id" element={<EmployeeProfilePage />} />
            <Route path="employee/helpdesk/:id" element={<AdminHelpdeskTicketPage />} />
            <Route path="admin-tools/templates/:id" element={<LetterTemplateEditorPage />} />
            <Route path="payroll/run/:id" element={<PayrollRunPage />} />
            <Route path="payroll/run/:id/step/:slug" element={<RunStepPage />} />
            {adminRoutes()}
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </Suspense>
  );
}
