import { lazy, type ComponentType, type LazyExoticComponent } from "react";

export type LazyPage = LazyExoticComponent<ComponentType> & { preload: () => Promise<unknown> };

// Route-level code splitting (docs/DESIGN_SYSTEM.md §7): each page is its own chunk, loaded on first visit — or earlier, when the person hovers or focuses its menu
// link (`preload`), so the click feels instant. The shell stays mounted and shows a page-shaped skeleton meanwhile.
export function lazyPage<M extends Record<string, unknown>>(loader: () => Promise<M>, name: keyof M & string): LazyPage {
  let promise: Promise<M> | undefined;
  const load = () => (promise ??= loader());
  const Component = lazy(() => load().then((m) => ({ default: m[name] as ComponentType }))) as LazyPage;
  Component.preload = load;
  return Component;
}

/** Preload a menu element if it is a lazy page (no-op otherwise). */
export function preloadElement(element: unknown): void {
  const p = (element as Partial<LazyPage> | undefined)?.preload;
  if (typeof p === "function") void p().catch(() => undefined);
}
