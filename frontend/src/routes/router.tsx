import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { EmployeeLayout } from "../layouts/EmployeeLayout";
import { AdminLayout } from "../layouts/AdminLayout";
import { LoginPage } from "../pages/auth/login/LoginPage";
import { SetPasswordPage } from "../pages/auth/set-password/SetPasswordPage";
import { ForgotPasswordPage } from "../pages/auth/forgot-password/ForgotPasswordPage";
import { ResetPasswordPage } from "../pages/auth/reset-password/ResetPasswordPage";
import { TotpChallengePage } from "../pages/auth/totp/TotpChallengePage";
import { TotpSetupPage } from "../pages/auth/totp/TotpSetupPage";
import { AccountSecurityPage } from "../pages/account-security/AccountSecurityPage";
import { EmployeeProfilePage } from "../pages/admin/employee/EmployeeProfilePage";
import { ViewMyInfoPage } from "../pages/employee/profile/ViewMyInfoPage";
import { HelpdeskTicketPage } from "../pages/employee/helpdesk/HelpdeskTicketPage";
import { AdminHelpdeskTicketPage } from "../pages/admin/helpdesk/AdminHelpdeskTicketPage";
import { LetterTemplateEditorPage } from "../pages/admin/letters/LetterTemplateEditorPage";
import { PayrollRunPage } from "../pages/admin/payroll/PayrollRunPage";
import { RunStepPage } from "../pages/admin/payroll/RunStepPage";
import { MobileActionPage } from "../pages/employee/mobile/MobileActionPage";
import { MobileExplorePage } from "../pages/employee/mobile/MobileExplorePage";
import { RequireAuth } from "./RequireAuth";
import { resolveAdminRoutes, resolveEmployeeRoutes } from "./resolveMenuRoutes";

// Route elements are generated from resolveMenuRoutes.tsx, not built here
// directly — that module is the single source of truth also used by
// routes.test.tsx, so a route that resolves to PlaceholderPage here is
// guaranteed to fail that test too, not just something discovered by
// clicking around.
// Development builds only: the screen index for reviewing the UI pass (docs/UI_SCREEN_MAP.md). Behind import.meta.env.DEV so production bundles never contain it.
const ScreensIndexPage = import.meta.env.DEV ? lazy(() => import("../pages/dev/ScreensIndexPage").then((m) => ({ default: m.ScreensIndexPage }))) : null;

function employeeRoutes() {
  return resolveEmployeeRoutes().map((route) => <Route key={route.relativePath} path={route.relativePath} element={route.element} />);
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

export function AppRouter() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/set-password/:token" element={<SetPasswordPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/totp-challenge" element={<TotpChallengePage />} />
      <Route path="/totp-setup" element={<TotpSetupPage />} />
      {ScreensIndexPage && (
        <Route
          path="/dev/screens"
          element={
            <Suspense fallback={null}>
              <ScreensIndexPage />
            </Suspense>
          }
        />
      )}

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
  );
}
