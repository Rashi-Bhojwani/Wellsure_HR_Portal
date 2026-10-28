import { useEffect, useState } from "react";
import { Grid } from "antd";
import { isAxiosError } from "axios";

// antd's useBreakpoint answers {} on a component's first render (it subscribes in a layout effect), so every component used to render — and run its
// layout effects — once as a phone before correcting itself. Until it answers, ask the browser directly (antd's default md/xl breakpoints).
function firstScreens(): { md?: boolean; xl?: boolean } {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return {};
  return { md: window.matchMedia("(min-width: 768px)").matches, xl: window.matchMedia("(min-width: 1200px)").matches };
}

/** < 768 px: phone layout (bottom tabs, stacked-card tables, full-screen sheets). */
export function useIsPhone(): boolean {
  const screens = Grid.useBreakpoint();
  return !(screens.md ?? firstScreens().md);
}

/** < 1280 px: tablet layout (sidebar becomes a drawer). */
export function useIsCompact(): boolean {
  const screens = Grid.useBreakpoint();
  return !(screens.xl ?? firstScreens().xl);
}

/** A value that settles `delay` ms after its last change (search boxes: about 250 ms, DESIGN_SYSTEM.md §7). */
export function useDebouncedValue<T>(value: T, delay = 250): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return settled;
}

/** HTTP status of a failed request, if it was one. */
export function errorStatus(error: unknown): number | undefined {
  return isAxiosError(error) ? error.response?.status : undefined;
}

export function isForbidden(error: unknown): boolean {
  return errorStatus(error) === 403;
}

export function isOffline(error: unknown): boolean {
  return isAxiosError(error) && !error.response;
}

/** Whether the person prefers reduced motion. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    try {
      return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const on = () => setReduced(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
}
