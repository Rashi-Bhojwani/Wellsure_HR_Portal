import { useEffect, useId } from "react";

// Keeps Tab and Shift+Tab inside an open dialog (2026-11-11 walk: after a drawer's last button, Tab reached the skip link and the logo behind the overlay).
// antd's Drawer and Modal move focus in on open and back on close; this closes the gap in between. The dialog's root gets a unique class; while it is open,
// a Tab on its last focusable element goes to its first, and a Shift+Tab on its first goes to its last; a Tab from outside it comes back in.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusablesIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[aria-hidden='true'], [hidden]") && el.tabIndex >= 0);
}

/** Returns the class to give the dialog's root; traps Tab inside the element `.{class} {panelSelector}` while `open`. */
export function useTabTrap(open: boolean, panelSelector: string): string {
  const id = `ws-trap-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const panel = document.querySelector<HTMLElement>(panelSelector.split(",").map((sel) => `.${id} ${sel.trim()}`).join(", "));
      if (!panel) return;
      const items = focusablesIn(panel);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      const inside = !!active && panel.contains(active);
      if (!inside) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, id, panelSelector]);
  return id;
}
