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
import { PlaceholderPage } from "../components/common/PlaceholderPage";
import { RequireAuth } from "./RequireAuth";
import { employeeMenu, isEmployeeMenuGroup } from "./employeeMenu.config";
import { adminApps } from "./adminMenu.config";

function employeeRoutes() {
  const leaves = employeeMenu.flatMap((entry) => (isEmployeeMenuGroup(entry) ? entry.children : [entry]));

  return leaves.map((leaf) => {
    const Element = leaf.element ?? (() => <PlaceholderPage title={leaf.label} phase={leaf.phase} />);
    return <Route key={leaf.path} path={leaf.path} element={<Element />} />;
  });
}

function adminRoutes() {
  return adminApps.flatMap((app) => {
    const AppElement = app.element ?? (() => <PlaceholderPage title={app.label} phase={app.phase} />);
    const routes =
      app.path === ""
        ? [<Route key="index" index element={<AppElement />} />]
        : [<Route key={app.path} path={app.path} element={<AppElement />} />];

    for (const group of app.menus ?? []) {
      for (const item of group.items) {
        const ItemElement = item.element ?? (() => <PlaceholderPage title={item.label} phase={item.phase} />);
        routes.push(<Route key={item.path} path={item.path} element={<ItemElement />} />);
      }
    }
    return routes;
  });
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

      <Route element={<RequireAuth />}>
        <Route path="/app" element={<EmployeeLayout />}>
          <Route index element={<Navigate to="home" replace />} />
          <Route path="profile" element={<ViewMyInfoPage />} />
          <Route path="security" element={<AccountSecurityPage />} />
          {employeeRoutes()}
        </Route>

        <Route path="/admin" element={<AdminLayout />}>
          <Route path="security" element={<AccountSecurityPage />} />
          <Route path="employee/profile/:id" element={<EmployeeProfilePage />} />
          {adminRoutes()}
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
