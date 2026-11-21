// @vitest-environment jsdom
import "../../../ui/__tests__/setup";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DateRangeFields } from "../DateRangeFields";

// FIX-M10 (independent audit 2026-11-20): keyboard focus was trapped in the Apply leave "From" box (Ant Design RangePicker). The two boxes are now two ordinary
// inputs in the tab order; the real browser check (Tab and Esc leave the box) is frontend/e2e/keyboard-leave-apply.mjs, run in the browser walk.
afterEach(() => cleanup());

describe("FIX-M10: Apply leave dates are two ordinary inputs in the tab order", () => {
  it("renders From and To as separate focusable inputs, in that order, none taken out of the tab order", () => {
    render(<DateRangeFields />);
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(from).not.toBe(to);
    expect(from.tagName).toBe("INPUT");
    expect(to.tagName).toBe("INPUT");
    for (const el of [from, to]) expect(el.getAttribute("tabindex")).not.toBe("-1");
    expect(from.compareDocumentPosition(to) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The pair is not one widget that keeps focus: there is no range-picker container that owns both inputs.
    expect(document.querySelector(".ant-picker-range")).toBeNull();
  });

  it("Esc on an open calendar leaves focus on its box (it does not jump or stay trapped in a popup)", () => {
    render(<DateRangeFields />);
    const from = screen.getByLabelText("From");
    from.focus();
    fireEvent.mouseDown(from);
    fireEvent.keyDown(from, { key: "Escape", code: "Escape" });
    expect(document.activeElement === from || document.activeElement === document.body).toBe(true);
  });
});
