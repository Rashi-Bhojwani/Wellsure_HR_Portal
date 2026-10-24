import { useEffect, useState } from "react";
import { Grid } from "antd";
import { isAxiosError } from "axios";

/** < 768 px: phone layout (bottom tabs, stacked-card tables, full-screen sheets). */
export function useIsPhone(): boolean {
  const screens = Grid.useBreakpoint();
  return !screens.md;
}

/** < 1280 px: tablet layout (sidebar becomes a drawer). */
export function useIsCompact(): boolean {
  const screens = Grid.useBreakpoint();
  return !screens.xl;
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
