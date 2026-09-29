import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppThemeProvider } from "./theme/ThemeProvider";
import { SocketProvider } from "./sockets/SocketProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { DevQuickLogin } from "./components/common/DevQuickLogin";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { AppRouter } from "./routes/router";

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
                {import.meta.env.DEV && <DevQuickLogin />}
              </BrowserRouter>
            </AuthenticatedSocketProvider>
          </AuthProvider>
        </QueryClientProvider>
      </AppThemeProvider>
    </ErrorBoundary>
  );
}
