import { Navigate, Route, Routes } from "react-router-dom";
import { EmployeeLayout } from "../layouts/EmployeeLayout";
import { AdminLayout } from "../layouts/AdminLayout";
import { LoginPage } from "../pages/auth/login/LoginPage";
import { PlaceholderPage } from "../components/common/PlaceholderPage";
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

      <Route path="/app" element={<EmployeeLayout />}>
        <Route index element={<Navigate to="home" replace />} />
        <Route path="profile" element={<PlaceholderPage title="Profile (View My Info)" phase="Phase 1" />} />
        {employeeRoutes()}
      </Route>

      <Route path="/admin" element={<AdminLayout />}>
        {adminRoutes()}
      </Route>

      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
