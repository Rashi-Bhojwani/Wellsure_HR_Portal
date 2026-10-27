import { lazy, Suspense, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppThemeProvider } from "./theme/ThemeProvider";
import { SocketProvider } from "./sockets/SocketProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AppRouter } from "./routes/router";

// Development builds only, and lazily, so neither production nor the login screen's budget ever carries it.
const DevQuickLogin = import.meta.env.DEV ? lazy(() => import("./components/common/DevQuickLogin").then((m) => ({ default: m.DevQuickLogin }))) : null;

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// A socket should only ever be open for a signed-in user — this reads
// useAuth() from inside AuthProvider (App() itself can't, since it's the
// component that renders AuthProvider) and flips SocketProvider's
// `enabled` accordingly.
function AuthenticatedSocketProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated } = useAuth();
  return <SocketProvider enabled={isAuthenticated}>{children}</SocketProvider>;
}

export function App() {
  return (
    <ErrorBoundary>
      <AppThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <AuthenticatedSocketProvider>
              <BrowserRouter>
                <AppRouter />
                {DevQuickLogin && (
                  <Suspense fallback={null}>
                    <DevQuickLogin />
                  </Suspense>
                )}
              </BrowserRouter>
            </AuthenticatedSocketProvider>
          </AuthProvider>
        </QueryClientProvider>
      </AppThemeProvider>
    </ErrorBoundary>
  );
}
