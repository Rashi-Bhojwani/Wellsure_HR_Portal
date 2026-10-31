import { describe, expect, it } from "vitest";
import { canSeeLeaf, employeeMenu, isEmployeeMenuGroup } from "../../../routes/employeeMenu.config";

// Q-14 (2026-11): the asset register is HR's and the directors' (admin portal). In the Wellsure Office workspace it shows only to a member who holds the
// asset keys (written only while the directors' asset audience lets the office manage it), never to a director.
const office = employeeMenu.find((e) => e.key === "wellsure-office");
const leaves = office && isEmployeeMenuGroup(office) ? office.children : [];
const leaf = (key: string) => leaves.find((l) => l.key === key)!;
const holder = (keys: string[]) => (k: string) => keys.includes(k);

describe("Wellsure Office menu: the asset register", () => {
  it("a member holding the asset keys sees it; a member without them does not", () => {
    expect(canSeeLeaf(leaf("office-assets"), holder(["office.workspace", "assets.view"]))).toBe(true);
    expect(canSeeLeaf(leaf("office-asset-settings"), holder(["office.workspace", "assets.settings.manage"]))).toBe(true);
    expect(canSeeLeaf(leaf("office-assets"), holder(["office.workspace"]))).toBe(false);
  });

  it("a director (who holds every key) does not see it in the workspace", () => {
    const director = () => true;
    expect(canSeeLeaf(leaf("office-assets"), director)).toBe(false);
    expect(canSeeLeaf(leaf("office-asset-settings"), director)).toBe(false);
    expect(canSeeLeaf(leaf("office-members"), director)).toBe(true);
  });
});
