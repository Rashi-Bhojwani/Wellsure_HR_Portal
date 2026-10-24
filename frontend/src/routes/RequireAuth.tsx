import { Navigate, Outlet } from "react-router-dom";
import { BrandMark } from "../layouts/shell/BrandMark";
import { useAuth } from "../hooks/useAuth";
import { useLeaveNotifications } from "../sockets/useLeaveNotifications";
import { useNotifications } from "../sockets/useNotifications";
import { useEngageRealtime } from "../sockets/useEngageRealtime";
import { useHelpdeskRealtime } from "../sockets/useHelpdeskRealtime";
import { usePermissionsRealtime } from "../sockets/usePermissionsRealtime";
import { useAttendanceRealtime } from "../sockets/useAttendanceRealtime";

// Gate for every /app and /admin route — redirects to /login once the
// initial silent-refresh bootstrap (see AuthProvider) has resolved and
// found no valid session. Also where socket-driven notifications hook
// in: they should only ever run for a signed-in user, same as the routes
// this component gates.
export function RequireAuth() {
  const { isAuthenticated, isLoading } = useAuth();
  useLeaveNotifications();
  useNotifications();
  useEngageRealtime();
  useHelpdeskRealtime();
  usePermissionsRealtime();
  useAttendanceRealtime();

  if (isLoading) {
    return (
      // The session check takes a moment on a reload: a quiet brand splash in the page colour, not a spinner.
      <div aria-busy="true" aria-label="Loading" style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", animation: "ws-fade-in 0.4s 0.2s both" }}>
        <BrandMark />
      </div>
    );
  }
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
}
