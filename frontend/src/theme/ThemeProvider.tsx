/* eslint-disable react-refresh/only-export-components -- context + hook are colocated by design */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ConfigProvider } from "antd";
import { antdThemeFor } from "./antdTheme";
import { cssVarsFor, type ThemeMode } from "./tokens";

export type ThemePreference = ThemeMode | "system";

interface ThemeContextValue {
  /** The theme actually shown. */
  mode: ThemeMode;
  /** What the person chose: light, dark, or follow the device. */
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
  toggleMode: () => void;
}

const ThemeModeContext = createContext<ThemeContextValue | undefined>(undefined);

// Per-viewer convenience only (DESIGN_SYSTEM.md: never state that must persist). index.html reads the same key before the first paint, so there is no flash.
export const THEME_STORAGE_KEY = "wellsure-theme-mode";

export function readStoredPreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" || stored === "light" || stored === "system" ? stored : "system";
  } catch {
    return "system";
  }
}

function systemMode(): ThemeMode {
  try {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function resolveMode(preference: ThemePreference): ThemeMode {
  return preference === "system" ? systemMode() : preference;
}

/** Writes the `--ws-*` variables and `data-theme` onto <html>. Called before React renders (main.tsx) and on every change. */
export function applyThemeVars(mode: ThemeMode): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVarsFor(mode))) root.style.setProperty(name, value);
  root.dataset.theme = mode;
  root.style.colorScheme = mode;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", cssVarsFor(mode)["--ws-bg-surface"] ?? "");
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readStoredPreference);
  const [system, setSystem] = useState<ThemeMode>(systemMode);
  const mode: ThemeMode = preference === "system" ? system : preference;

  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => setSystem(mq.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    applyThemeVars(mode);
  }, [mode]);

  const value = useMemo<ThemeContextValue>(() => {
    const setPreference = (p: ThemePreference) => {
      setPreferenceState(p);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, p);
      } catch {
        // per-viewer convenience only
      }
    };
    return { mode, preference, setPreference, toggleMode: () => setPreference(mode === "light" ? "dark" : "light") };
  }, [mode, preference]);

  const themeConfig = useMemo(() => antdThemeFor(mode), [mode]);

  // toast (message) and socket notifications use antd's static methods, which render outside this tree: give their holder the same theme, so they follow
  // light/dark too. (No antd <App> wrapper: nothing uses App.useApp(), and it would put Modal into the login screen's bundle.)
  useEffect(() => {
    ConfigProvider.config({
      holderRender: (children) => (
        <ConfigProvider theme={themeConfig} wave={{ disabled: true }}>
          {children}
        </ConfigProvider>
      ),
    });
  }, [themeConfig]);

  return (
    <ThemeModeContext.Provider value={value}>
      <ConfigProvider theme={themeConfig} wave={{ disabled: true }}>
        {children}
      </ConfigProvider>
    </ThemeModeContext.Provider>
  );
}

export function useThemeMode(): ThemeContextValue {
  const ctx = useContext(ThemeModeContext);
  if (!ctx) throw new Error("useThemeMode must be used within AppThemeProvider");
  return ctx;
}
