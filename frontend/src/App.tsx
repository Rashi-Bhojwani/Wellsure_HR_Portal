import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import { AppThemeProvider } from "./theme/ThemeProvider";
import { SocketProvider } from "./sockets/SocketProvider";
import { ErrorBoundary } from "./components/common/ErrorBoundary";
import { DevRoleSwitcher } from "./components/common/DevRoleSwitcher";
import { AppRouter } from "./routes/router";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

export function App() {
  return (
    <ErrorBoundary>
      <AppThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SocketProvider enabled={false}>
            <BrowserRouter>
              <AppRouter />
              {import.meta.env.DEV && <DevRoleSwitcher />}
            </BrowserRouter>
          </SocketProvider>
        </QueryClientProvider>
      </AppThemeProvider>
    </ErrorBoundary>
  );
}
