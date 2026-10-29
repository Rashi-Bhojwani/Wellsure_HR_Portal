import { describe, expect, it } from "vitest";
import { PERMISSION_KEYS } from "@shared/constants/permissions";
import { HR_CAPABILITIES } from "@shared/constants/hrCapabilities";
import { adminApps } from "../../../routes/adminMenu.config";
import { adminNav, flattenLeaves } from "../nav";

// The admin menu follows what a director has switched on or off for a person: an item the person's permissions don't cover is not in the sidebar, the search or the phone menu.

const keysOf = (...caps: string[]) => new Set(HR_CAPABILITIES.filter((c) => caps.includes(c.id)).flatMap((c) => c.keys as string[]));
const leavesFor = (permissions: Set<string>, director = false) => flattenLeaves(adminNav((k) => permissions.has(k), director)).map((l) => l.key);

describe("the admin menu", () => {
  it("every permission an item asks for is a real permission", () => {
    for (const app of adminApps) for (const group of app.menus ?? []) for (const item of group.items) for (const k of item.needs?.any ?? []) expect((PERMISSION_KEYS as readonly string[]).includes(k), `${item.key}: ${k}`).toBe(true);
  });

  it("a director sees every item, including the one only directors have", () => {
    const keys = leavesFor(new Set(), true);
    expect(keys).toContain("hr-capabilities");
    expect(keys).toContain("attendance-exception");
    expect(keys).toContain("report-leave-liability");
  });

  it("someone with no attendance permission sees no attendance item, and no HR-only tool", () => {
    const keys = leavesFor(new Set(["employee.view"]));
    for (const gone of ["who-is-in", "attendance-muster", "regularizations", "attendance-exception", "shift-roster", "employee-swipes", "hr-capabilities", "report-late-coming", "report-lop"]) expect(keys, gone).not.toContain(gone);
  });

  it("each switchable duty brings back exactly its own items", () => {
    expect(leavesFor(keysOf("EXCEPTIONS_QUEUE"))).toContain("attendance-exception");
    expect(leavesFor(keysOf("EXCEPTIONS_QUEUE"))).not.toContain("who-is-in");
    expect(leavesFor(keysOf("SHIFT_ROSTER"))).toEqual(expect.arrayContaining(["shift-roster"]));
    expect(leavesFor(keysOf("ATTENDANCE_REPORTS"))).toEqual(expect.arrayContaining(["report-late-coming", "report-excess-hours", "report-exception-summary", "report-attendance-summary"]));
    expect(leavesFor(keysOf("ATTENDANCE_REPORTS"))).not.toContain("report-lop");
    expect(leavesFor(keysOf("LEAVE_REPORTS"))).toEqual(expect.arrayContaining(["report-leave-balance", "report-lop"]));
    expect(leavesFor(keysOf("CORRECTIONS"))).toEqual(expect.arrayContaining(["manual-override", "shift-override"]));
  });

  it("a section or app left with nothing is not shown", () => {
    const nav = adminNav((k) => k === "employee.view", false);
    const reports = nav.find((e) => e.key === "reports");
    const labels = reports && reports.kind === "group" ? reports.children.filter((c) => c.kind === "section").map((c) => c.label) : [];
    expect(labels).not.toContain("Attendance");
    expect(labels).not.toContain("Leave");
  });
});
