import { Fragment, type ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";

// Remount local forms as well as observers when an account changes.
export function ExitActorBoundary({ children }: { children: ReactNode }) {
  const employeeId = useAuth().user?.employeeId;
  return <Fragment key={employeeId ?? "signed-out"}>{children}</Fragment>;
}
