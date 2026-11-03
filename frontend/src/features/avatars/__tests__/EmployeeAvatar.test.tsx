// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { EmployeeAvatar } from "../../../components/common/EmployeeAvatar";
import type { AvatarMap } from "../api";

// The one shared avatar (D-35): a chosen character or fun pick, initials when chosen, and initials as the fallback for anyone without a choice or photo.
function withMap(map: AvatarMap, ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["avatars", "map"], map);
  client.setQueryData(["people", "photo-token"], { token: "t", expiresAt: "2099-01-01T00:00:00Z" });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

afterEach(cleanup);

describe("EmployeeAvatar", () => {
  it("draws the person's chosen character from the catalogue art", () => {
    withMap({ e1: { kind: "CHARACTER", file: "characters/person-03.svg", photoVersion: "v1" } }, <EmployeeAvatar employeeId="e1" name="Demo Person" />);
    expect(screen.getByRole("img", { name: "Demo Person" }).getAttribute("src")).toBe("/avatars/characters/person-03.svg");
  });

  it("shows initials when the person chose initials, even with a photo", () => {
    withMap({ e1: { kind: "INITIALS", file: null, photoVersion: "v1" } }, <EmployeeAvatar employeeId="e1" name="Demo Person" />);
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("DP")).toBeTruthy();
  });

  it("falls back to initials with no choice, no photo, or no employee id", () => {
    withMap({}, (
      <>
        <EmployeeAvatar employeeId="e2" name="Test User" />
        <EmployeeAvatar name="Sample Name" />
      </>
    ));
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByText("TU")).toBeTruthy();
    expect(screen.getByText("SN")).toBeTruthy();
  });
});
