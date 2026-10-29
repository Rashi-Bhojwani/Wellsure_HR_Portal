import type { ReactNode } from "react";
import { adminNeedsMet, type AdminNeeds } from "../../routes/adminMenu.config";
import { useAuth } from "../../hooks/useAuth";
import { EmptyState } from "../../ui";

// The forbidden state of an admin page (DESIGN_SYSTEM.md §13): shown instead of the page when the person's permissions, as the directors have them switched, do not cover it. The server
// refuses the data either way; this is so nobody lands on a board of zeros or an error that looks like a fault.
export function RequireAccess({ needs, children }: { needs: AdminNeeds; children: ReactNode }) {
  const { user, hasPermission } = useAuth();
  const isDirector = Boolean(user?.roleCodes.includes("SUPER_ADMIN"));
  if (!adminNeedsMet(needs, hasPermission, isDirector)) {
    return <EmptyState title="This is not switched on for you" description="What you can open here is set by the directors. If you need it, ask one of them." />;
  }
  return <>{children}</>;
}
