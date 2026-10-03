import { quickActions, type MobileTab } from "../routes/employeeMenu.config";

export const MOBILE_TAB_BAR_HEIGHT = 60;

// Which bottom tab a path belongs to (Phase 5 commit G): Home and Engage by
// their own paths; Action for its page and any quick-action page;
// everything else is Explore (it lists every section).
export function activeTabFor(pathname: string): MobileTab["key"] {
  const rel = pathname.replace(/^\/app\/?/, "");
  if (rel === "" || rel.startsWith("home")) return "home";
  if (rel.startsWith("engage")) return "engage";
  if (rel.startsWith("action") || quickActions().some((a) => rel === a.path || rel.startsWith(`${a.path}/`))) return "action";
  return "explore";
}
