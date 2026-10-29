// @vitest-environment jsdom
import "./setup";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setPhone } from "./setup";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, StatCard, StatusChip, StepperLayout, Timeline, toneForStatus } from "../index";

afterEach(() => {
  cleanup();
  setPhone(false);
});

const wrap = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("StatusChip", () => {
  it("shows the word and picks a tone from it", () => {
    wrap(<StatusChip status="ON_LEAVE" />);
    expect(screen.getByText("ON LEAVE")).toBeTruthy();
    expect(toneForStatus("approved")).toBe("success");
    expect(toneForStatus("Rejected")).toBe("danger");
    expect(toneForStatus("whatever")).toBe("neutral");
  });
});

describe("EmptyState", () => {
  it("has defaults per kind and a retry button", () => {
    const retry = vi.fn();
    wrap(<EmptyState kind="error" onRetry={retry} />);
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalled();
  });
  it("description null hides the sentence", () => {
    wrap(<EmptyState title="Nothing" description={null} />);
    expect(screen.getByText("Nothing")).toBeTruthy();
    expect(screen.queryByText(/will appear here/)).toBeNull();
  });
});

describe("QueryState", () => {
  it("shows forbidden for a 403", () => {
    const err = Object.assign(new Error("x"), { isAxiosError: true, response: { status: 403, data: {} } });
    wrap(<QueryState isLoading={false} error={err}>content</QueryState>);
    expect(screen.getByText(/don't have access/i)).toBeTruthy();
    expect(screen.queryByText("content")).toBeNull();
  });
  it("shows children when loaded", () => {
    wrap(<QueryState isLoading={false}>content</QueryState>);
    expect(screen.getByText("content")).toBeTruthy();
  });
});

describe("PageHeader", () => {
  it("renders an h1, breadcrumb and actions", () => {
    wrap(<PageHeader title="Headcount" breadcrumb={[{ label: "Reports", to: "/admin/reports" }, { label: "Headcount" }]} actions={<button>Export</button>} />);
    expect(screen.getByRole("heading", { level: 1, name: "Headcount" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Breadcrumb" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Reports" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
  });
});

describe("Panel, StatCard, KeyValueGrid, ApprovalBanner, Timeline, StepperLayout", () => {
  it("render their content accessibly", () => {
    const onEdit = vi.fn();
    wrap(
      <>
        <Panel title="Personal info" onEdit={onEdit}>
          <KeyValueGrid items={[{ label: "Full name", value: "Demo Person" }]} />
        </Panel>
        <StatCard label="Total employees" value={500} delta={{ text: "5%", direction: "up" }} />
        <ApprovalBanner tone="warning" title="Waiting for the checker" />
        <Timeline items={[{ key: "1", content: "Run submitted", time: "now" }]} />
        <StepperLayout steps={["One", "Two", "Three"]} current={1}>
          body
        </StepperLayout>
      </>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(onEdit).toHaveBeenCalled();
    expect(screen.getByText("Full name")).toBeTruthy();
    expect(screen.getByText("500")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Waiting for the checker");
    expect(screen.getByText("Run submitted")).toBeTruthy();
    expect(screen.getByRole("progressbar", { name: "Step 2 of 3" })).toBeTruthy();
  });
});

describe("DataTable", () => {
  const rows = [
    { id: "1", name: "Demo One", status: "ACTIVE" },
    { id: "2", name: "Demo Two", status: "INACTIVE" },
  ];
  const columns = [
    { title: "Name", dataIndex: "name", key: "name" },
    { title: "Status", dataIndex: "status", key: "status", render: (s: string) => <StatusChip status={s} /> },
  ];
  it("is a table on desktop and opens a row on click", () => {
    const open = vi.fn();
    wrap(<DataTable rowKey="id" columns={columns} dataSource={rows} pagination={false} onRowOpen={open} />);
    expect(screen.getByRole("table")).toBeTruthy();
    fireEvent.click(screen.getByText("Demo One"));
    expect(open).toHaveBeenCalledWith(rows[0]);
  });
  it("becomes stacked cards on a phone", () => {
    setPhone(true);
    wrap(<DataTable rowKey="id" columns={columns} dataSource={rows} pagination={false} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(2);
    expect(screen.getAllByText("Status")).toHaveLength(2);
  });
  it("shows the empty state", () => {
    wrap(<DataTable rowKey="id" columns={columns} dataSource={[]} pagination={false} empty={<span>none here</span>} />);
    expect(screen.getByText("none here")).toBeTruthy();
  });
});

describe("FilterBar", () => {
  it("debounces search by about 250 ms", () => {
    vi.useFakeTimers();
    const onSearch = vi.fn();
    wrap(<FilterBar onSearch={onSearch} searchPlaceholder="Search employee" />);
    fireEvent.change(screen.getByLabelText("Search employee"), { target: { value: "dem" } });
    act(() => vi.advanceTimersByTime(100));
    expect(onSearch).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(200));
    expect(onSearch).toHaveBeenCalledWith("dem");
    vi.useRealTimers();
  });
});

describe("SideDrawer and ConfirmModal", () => {
  it("drawer has a close button and Cancel + primary", () => {
    const onClose = vi.fn();
    const onPrimary = vi.fn();
    wrap(
      <SideDrawer open onClose={onClose} title="Add new profile" onPrimary={onPrimary} primaryLabel="Create">
        form
      </SideDrawer>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(onPrimary).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
  it("modal confirms", () => {
    const onConfirm = vi.fn();
    wrap(<ConfirmModal open title="Clock out?" onCancel={() => undefined} onConfirm={onConfirm} confirmLabel="Clock out" />);
    fireEvent.click(screen.getByRole("button", { name: "Clock out" }));
    expect(onConfirm).toHaveBeenCalled();
  });
});
