import manifestRaw from "../../../public/manifest.webmanifest?raw";
import swSource from "../../../public/sw.js?raw";
import indexHtml from "../../../index.html?raw";
import { describe, expect, it } from "vitest";
import { employeeMenu, exploreEntries, isComingSoon, isEmployeeMenuGroup, mobileTabs, quickActions, type EmployeeMenuLeaf } from "../employeeMenu.config";
import { activeTabFor } from "../../lib/mobileNav";

// The phone layout (Phase 5 commit G, docs/UI_REFERENCE.md Part 4) is
// generated from employeeMenu.config.tsx — these pin that it stays that way.
const leaves = () => employeeMenu.flatMap((e) => (isEmployeeMenuGroup(e) ? e.children : [e]));
const leaf = (key: string) => leaves().find((l) => l.key === key)!;

describe("mobile tabs and their contents come from the employee menu", () => {
  it("four tabs; Home and Engage reuse their menu entries", () => {
    expect(mobileTabs.map((t) => t.key)).toEqual(["home", "action", "explore", "engage"]);
    for (const t of mobileTabs.filter((x) => x.menuKey)) expect(employeeMenu.some((e) => e.key === t.menuKey)).toBe(true);
  });

  it("Explore lists every menu entry except the tabs themselves", () => {
    expect(exploreEntries().map((e) => e.key)).toEqual(employeeMenu.filter((e) => e.key !== "home" && e.key !== "engage").map((e) => e.key));
  });

  it("Action lists the quickAction pages in menu order — never one that's coming soon", () => {
    const actions = quickActions();
    expect(actions.length).toBeGreaterThan(0);
    expect(actions.map((a) => a.key)).toEqual(leaves().filter((l) => l.quickAction && !isComingSoon(l)).map((l) => l.key));
    expect(actions.every((a) => !isComingSoon(a))).toBe(true);
  });

  it("a menu change shows up on mobile with no mobile code touched", () => {
    const extra: EmployeeMenuLeaf = { key: "test-extra", label: "Test Extra", path: "test-extra", element: () => null, quickAction: true };
    employeeMenu.push(extra);
    try {
      expect(quickActions().map((a) => a.key)).toContain("test-extra");
      expect(exploreEntries().map((e) => e.key)).toContain("test-extra");
    } finally {
      employeeMenu.pop();
    }
  });

  it("anything not built yet is 'coming soon'; Attendance Info and Payslips are real now", () => {
    // Payslips are real now (Phase 6 P6-5): a page, no phase mark.
    expect(leaf("payslips").phase).toBeUndefined();
    expect(leaf("payslips").element).toBeDefined();
    expect(isComingSoon(leaf("payslips"))).toBe(false);
    // Attendance Info is built on real data (Phase 2 P2-E).
    expect(leaf("attendance-info").phase).toBeUndefined();
    expect(isComingSoon(leaf("attendance-info"))).toBe(false);
    expect(isComingSoon(leaf("ytd-reports"))).toBe(true); // phase-marked
    expect(isComingSoon(leaf("leave-apply"))).toBe(false);
    expect(quickActions().map((a) => a.key)).not.toContain("payslips");
  });

  it("the active tab follows the path", () => {
    expect(activeTabFor("/app/home")).toBe("home");
    expect(activeTabFor("/app/engage")).toBe("engage");
    expect(activeTabFor("/app/action")).toBe("action");
    expect(activeTabFor("/app/leave/apply")).toBe("action"); // a quick action
    expect(activeTabFor("/app/people")).toBe("explore");
    expect(activeTabFor("/app/explore")).toBe("explore");
  });
});

describe("PWA installability", () => {
  // Read through Vite (?raw / import.meta.glob), so no Node APIs are needed.
  const manifest = JSON.parse(manifestRaw) as { display: string; start_url: string; icons: Array<{ src: string; sizes: string; purpose: string }> };
  const publicIcons = Object.keys(import.meta.glob("../../../public/icons/*.png")).map((k) => k.replace("../../../public", ""));

  it("the manifest is installable: standalone, a start URL inside the app, 192 and 512 icons plus a maskable one — all present", () => {
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/app/home");
    expect(manifest.icons.map((i) => i.sizes)).toEqual(expect.arrayContaining(["192x192", "512x512"]));
    expect(manifest.icons.some((i) => i.purpose === "maskable")).toBe(true);
    for (const icon of manifest.icons) expect(publicIcons).toContain(icon.src);
  });

  it("index.html links the manifest and the Apple touch icon; the service worker never touches the API", () => {
    expect(indexHtml).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(indexHtml).toContain('rel="apple-touch-icon" href="/icons/apple-touch-icon.png"');
    expect(publicIcons).toContain("/icons/apple-touch-icon.png");
    expect(swSource).toContain("url.origin !== self.location.origin"); // the API is cross-origin: passed straight through
    expect(swSource).toContain('request.method !== "GET"');
  });
});
