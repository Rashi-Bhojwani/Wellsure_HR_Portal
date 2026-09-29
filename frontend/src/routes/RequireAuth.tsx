import { Navigate, Outlet } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "../hooks/useAuth";
import { useLeaveNotifications } from "../sockets/useLeaveNotifications";
import { useNotifications } from "../sockets/useNotifications";

// Gate for every /app and /admin route — redirects to /login once the
// initial silent-refresh bootstrap (see AuthProvider) has resolved and
// found no valid session. Also where socket-driven notifications hook
// in: they should only ever run for a signed-in user, same as the routes
// this component gates.
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  useLeaveNotifications();
  useNotifications();

  if (isLoading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh" }}>
        <Spin size="large" />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
