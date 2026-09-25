import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppThemeProvider } from "./theme/ThemeProvider";
import { SocketProvider } from "./sockets/SocketProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { DevQuickLogin } from "./components/common/DevQuickLogin";
import { AuthProvider } from "./hooks/useAuth";
import { AppRouter } from "./routes/router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <ErrorBoundary>
      <AppThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <SocketProvider enabled={false}>
              <BrowserRouter>
                <AppRouter />
                {import.meta.env.DEV && <DevQuickLogin />}
              </BrowserRouter>
            </SocketProvider>
          </AuthProvider>
        </QueryClientProvider>
      </AppThemeProvider>
    </ErrorBoundary>
  );
}
