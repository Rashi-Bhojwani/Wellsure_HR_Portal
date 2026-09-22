/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider, theme as antdTheme } from "antd";
import { darkTheme, lightTheme } from "./tokens";

type ThemeMode = "light" | "dark";

interface ThemeContextValue {
  mode: ThemeMode;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeContextValue | undefined>(undefined);

const STORAGE_KEY = "wellsure-theme-mode";

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readStoredMode);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      // ignore — per-viewer convenience only
    }
  }, [mode]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode,
      toggleMode: () => setMode((m) => (m === "light" ? "dark" : "light")),
    }),
    [mode],
  );

  const themeConfig = useMemo(() => {
    const base = mode === "dark" ? darkTheme : lightTheme;
    return {
      ...base,
      algorithm: mode === "dark" ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
    };
  }, [mode]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider theme={themeConfig}>{children}</ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used within AppThemeProvider");
  return ctx;
}
