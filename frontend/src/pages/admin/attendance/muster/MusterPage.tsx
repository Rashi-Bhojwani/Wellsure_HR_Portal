import { useEffect, useMemo, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Input, Popover, Segmented, Select, Typography } from "antd";
import { CheckCircleOutlined, CloudUploadOutlined, ExportOutlined, LockOutlined, SaveOutlined, UndoOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import * as musterApi from "../../../../api/muster";
import type { MusterQuery } from "../../../../api/muster";
import { ManualOverrideModal } from "../../../../components/attendance/ManualOverrideModal";
import { HelpStrip } from "../../../../components/common/HelpStrip";
import { useAuth } from "../../../../hooks/useAuth";
import { apiErrorMessage } from "../../../../lib/apiError";
import { useSocket } from "../../../../sockets/SocketProvider";
import { MusterGrid } from "./MusterGrid";
import { cellKey, useCellTones } from "./musterCells";
import { MusterUploadPanel } from "./MusterUploadPanel";
import { fs, fw, radius, shadow, space, v } from "../../../../theme/tokens";
import { EmptyState, FilterBar, PageHeader, Panel, SideDrawer, SkeletonTable, Stack, toast, useIsPhone } from "../../../../ui";
import { MusterDayList } from "./MusterDayList";

const { Text } = Typography;

type CellErrors = Array<{ employeeId: string; date: string; error: string }>;

/**
 * Workforce → Attendance → Attendance Muster, and the employee portal's
 * Attendance → Mark Attendance for a manager who marks a branch by hand
 * (Phase 2 P2-D, docs/plans/PHASE_2.md §5).
 */
export function MusterPage({ title = "Attendance Muster" }: { title?: string }) {
  const phone = useIsPhone();
  const [view, setView] = useState<"grid" | "day">(() => (typeof window !== "undefined" && window.innerWidth < 768 ? "day" : "grid"));
  const tones = useCellTones();
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [query, setQuery] = useState<MusterQuery>({});
  const [pending, setPending] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focused, setFocused] = useState<string | null>(null);
  const [remark, setRemark] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [presentDay, setPresentDay] = useState<Dayjs | null>(null);
  const [presentBranch, setPresentBranch] = useState<string | undefined>();
  const { hasPermission } = useAuth();
  const canOverride = hasPermission("attendance.override.manage");
  const [overriding, setOverriding] = useState<{ employeeId: string; name: string; date: string } | null>(null);

  const cycles = useQuery({ queryKey: ["attendance", "muster", "cycles"], queryFn: musterApi.cycles, staleTime: 30_000 });
  const muster = useQuery({ queryKey: ["attendance", "muster", query], queryFn: () => musterApi.getMuster(query), placeholderData: (prev) => prev, retry: false });
  const data = muster.data;

  // Live: any recompute (a punch, a leave decision, someone else's entry) refreshes the grid; unsaved typing stays.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    socket.on("attendance.updated", refresh);
    return () => void socket.off("attendance.updated", refresh);
  }, [socket, queryClient]);

  const pendingCount = Object.keys(pending).length;
  useEffect(() => {
    if (!pendingCount) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pendingCount]);

  const change = (key: string, text: string | null) => {
    setErrors(({ [key]: _gone, ...rest }) => rest);
    setPending(({ [key]: _old, ...rest }) => (text === null ? rest : { ...rest, [key]: text }));
  };
  const setFilter = (patch: Partial<MusterQuery>) => {
    if (pendingCount && !window.confirm("You have unsaved changes in the muster. Discard them?")) return;
    setPending({});
    setErrors({});
    setQuery((q) => ({ ...q, ...patch }));
  };

  const save = useMutation({
    mutationFn: () =>
      musterApi.saveEntries(
        Object.entries(pending).map(([key, text]) => {
          const [employeeId, date] = key.split("|") as [string, string];
          // An emptied cell that had an entry clears the day (the grid only keeps it pending if it had one).
          return { employeeId, date, text: text.trim() === "" ? "-" : text, remark: remark.trim() || null };
        }),
      ),
    onSuccess: (r) => {
      toast.success(r.saved ? `Saved ${r.saved} ${r.saved === 1 ? "day" : "days"}.` : "Nothing changed.");
      setPending({});
      setErrors({});
      setRemark("");
      void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    },
    onError: (err) => {
      const cells = (err as AxiosError<{ error?: { details?: { cells?: CellErrors } } }>).response?.data?.error?.details?.cells;
      if (cells) setErrors(Object.fromEntries(cells.map((c) => [cellKey(c.employeeId, c.date), c.error])));
      toast.error(apiErrorMessage(err, "Could not save the muster."));
    },
  });

  const markPresent = useMutation({
    mutationFn: () => musterApi.markAllPresent({ date: presentDay!.format("YYYY-MM-DD"), locationId: presentBranch! }),
    onSuccess: (r) => {
      toast.success(r.marked ? `Marked ${r.marked} present at the shift times. Change the exceptions in the grid.` : "Nobody was left unmarked that day.");
      setPresentDay(null);
      void queryClient.invalidateQueries({ queryKey: ["attendance", "muster"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not mark that day.")),
  });

  const exportFile = useMutation({
    mutationFn: () => musterApi.exportMuster(query),
    onSuccess: (blob) => musterApi.saveBlob(blob, `attendance-muster-${data?.cycle.start ?? "cycle"}.xlsx`),
    onError: (err) => toast.error(apiErrorMessage(err, "Could not export the muster.")),
  });

  const cycleOptions = useMemo(() => (cycles.data?.cycles ?? []).map((c) => ({ value: c.start, label: c.label })), [cycles.data]);
  const markBranches = data?.filters.locations ?? [];

  const header = (
    <PageHeader
      title={title}
      subtitle={data ? `${data.cycle.label} · ${dayjs(data.cycle.start).format("D MMM")} – ${dayjs(data.cycle.end).format("D MMM YYYY")}` : "Each row is one person, each column one day"}
      actions={
        <>
          {data?.canMark && (
            <>
              <Popover
                trigger="click"
                open={presentDay !== null}
                onOpenChange={(o) => setPresentDay(o ? dayjs(data.today) : null)}
                title="Mark everyone present"
                content={
                  <div style={{ display: "flex", flexDirection: "column", gap: space[3], width: 260, maxWidth: "80vw" }}>
                    <Text type="secondary">Fills every unmarked working day at the shift's start and end times, then you change the exceptions. Nothing already marked is touched.</Text>
                    <DatePicker value={presentDay} onChange={setPresentDay} disabledDate={(d) => d.isAfter(dayjs(data.today))} style={{ width: "100%" }} allowClear={false} aria-label="Day to mark" />
                    <Select placeholder="Branch" aria-label="Branch to mark" value={presentBranch} onChange={setPresentBranch} options={markBranches.map((l) => ({ value: l.id, label: l.name }))} />
                    <Button type="primary" block disabled={!presentBranch || !presentDay} loading={markPresent.isPending} onClick={() => markPresent.mutate()}>
                      Mark all present
                    </Button>
                  </div>
                }
              >
                <Button icon={<CheckCircleOutlined />}>Mark all present</Button>
              </Popover>
              <Button icon={<CloudUploadOutlined />} onClick={() => setUploadOpen(true)}>
                Upload muster
              </Button>
            </>
          )}
          <Button icon={<ExportOutlined />} loading={exportFile.isPending} onClick={() => exportFile.mutate()} disabled={!data}>
            Export to Excel
          </Button>
        </>
      }
    />
  );

  if (muster.isError && !data) {
    const status = (muster.error as AxiosError).response?.status;
    return (
      <>
        <PageHeader title={title} />
        <Panel>
          {status === 403 ? (
            <EmptyState kind="forbidden" title="No access to the muster" description="You don't mark attendance for any branch. Admin assigns branches in Attendance Settings." />
          ) : (
            <EmptyState kind="error" title="Could not load the muster" description={apiErrorMessage(muster.error, "Try again in a moment.")} onRetry={() => void muster.refetch()} />
          )}
        </Panel>
      </>
    );
  }

  const filterCount = [query.locationId, query.departmentId, query.employeeId].filter(Boolean).length;
  return (
    <>
      {header}
      <Stack>
        <HelpStrip storageKey="muster-help">
          Each row is one person, each column one day. For people marked by hand, click a day and type the IN and OUT times (10:05-19:10): they're worked out by
          exactly the same rules as a punch, so lateness and half days come out the same. If the times truly aren't known, type a status (P, A, P:A, A:P) — it's
          recorded as "status only". Enter moves on and the arrow keys move around (Tab leaves the grid), then Save. Device days can't be typed into{canOverride ? "; click one to set it by Manual Override" : ""}.
        </HelpStrip>

        <Panel
          title="Muster"
          extra={
            <Segmented<"grid" | "day">
              value={view}
              onChange={setView}
              options={[
                { value: "grid", label: "Whole cycle" },
                { value: "day", label: "One day" },
              ]}
            />
          }
        >
          <FilterBar
            activeCount={filterCount}
            onClear={() => setFilter({ locationId: undefined, departmentId: undefined, employeeId: undefined })}
            filters={
              <>
                <Select
                  aria-label="Select attendance cycle"
                  style={{ width: 210 }}
                  value={query.cycleStart ?? cycles.data?.current.start}
                  onChange={(val) => setFilter({ cycleStart: val })}
                  options={cycleOptions}
                  loading={cycles.isLoading}
                />
                <Select allowClear placeholder="All branches" aria-label="Branch" style={{ width: 200 }} value={query.locationId} onChange={(val) => setFilter({ locationId: val })} options={(data?.filters.locations ?? []).map((l) => ({ value: l.id, label: l.name }))} />
                <Select allowClear placeholder="All departments" aria-label="Department" style={{ width: 200 }} value={query.departmentId} onChange={(val) => setFilter({ departmentId: val })} options={(data?.filters.departments ?? []).map((l) => ({ value: l.id, label: l.name }))} />
                <Select
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  placeholder="One employee"
                  aria-label="Employee"
                  style={{ width: 240 }}
                  value={query.employeeId}
                  onChange={(val) => setFilter({ employeeId: val })}
                  options={(data?.filters.employees ?? []).map((e) => ({ value: e.id, label: `${e.name} (${e.employeeCode})` }))}
                />
              </>
            }
          />
          {!data ? (
            <SkeletonTable rows={10} columns={6} />
          ) : data.rows.length === 0 ? (
            <EmptyState kind={filterCount ? "no-results" : "empty"} compact title="Nobody to show for this cycle and filter." description={null} />
          ) : view === "day" ? (
            <MusterDayList muster={data} pending={pending} errors={errors} onChange={change} onOpenDay={hasPermission("attendance.override.manage") ? (row, cell) => setOverriding({ employeeId: row.employeeId, name: row.name, date: cell.date }) : undefined} />
          ) : (
            <div style={{ opacity: muster.isPlaceholderData ? 0.6 : 1, transition: "opacity 0.15s" }}>
              <MusterGrid
                muster={data}
                pending={pending}
                errors={errors}
                onChange={change}
                focused={focused}
                onFocus={setFocused}
                onOpenDay={hasPermission("attendance.override.manage") ? (row, cell) => setOverriding({ employeeId: row.employeeId, name: row.name, date: cell.date }) : undefined}
              />
            </div>
          )}
        </Panel>

        {pendingCount > 0 && (
          <div
            role="region"
            aria-label="Unsaved changes"
            style={{ position: "sticky", bottom: phone ? 72 : space[2], zIndex: 5, background: v.bgSurface, border: `1px solid ${v.warning}`, borderRadius: radius.lg, boxShadow: shadow.popover, padding: space[4], display: "flex", gap: space[3], alignItems: "center", flexWrap: "wrap" }}
          >
            <Text strong>
              {pendingCount} unsaved {pendingCount === 1 ? "change" : "changes"}
            </Text>
            {Object.keys(errors).length > 0 && <Text type="danger">{Object.keys(errors).length} to fix (hover the red cells)</Text>}
            <Input placeholder="Remark for these changes (optional), e.g. confirmed by phone" aria-label="Remark for these changes" value={remark} onChange={(e) => setRemark(e.target.value)} maxLength={200} style={{ flex: 1, minWidth: 220 }} />
            <div style={{ display: "flex", gap: space[2], width: phone ? "100%" : undefined }}>
              <Button icon={<UndoOutlined />} onClick={() => (setPending({}), setErrors({}))} style={{ flex: phone ? 1 : undefined }}>
                Discard
              </Button>
              <Button type="primary" icon={<SaveOutlined />} loading={save.isPending} onClick={() => save.mutate()} style={{ flex: phone ? 1 : undefined }}>
                Save
              </Button>
            </div>
          </div>
        )}

        {data && (
          <Panel title="Legend">
            <div style={{ display: "flex", gap: space[8], flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <Text type="secondary">What a day shows</Text>
                <div style={{ display: "flex", gap: `${space[2]}px ${space[4]}px`, flexWrap: "wrap", marginTop: space[2], maxWidth: 640 }}>
                  {data.legend.map((l) => {
                    const tone = tones(l.code.split(/[ ,/]/)[0]!);
                    return (
                      <span key={l.code} style={{ display: "inline-flex", alignItems: "center", gap: space[2] }}>
                        <span style={{ background: tone.background, color: tone.color, border: `1px solid ${v.borderDefault}`, borderRadius: radius.xs, padding: "0 6px", fontWeight: fw.semibold, fontSize: fs.sm }}>{l.code}</span>
                        <Text style={{ fontSize: fs.sm }}>{l.label}</Text>
                      </span>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: `${space[2]}px ${space[4]}px`, flexWrap: "wrap", marginTop: space[3], fontSize: fs.sm, color: v.textSecondary }}>
                  <span><span style={{ display: "inline-block", width: 14, height: 14, verticalAlign: "middle", boxShadow: `inset 0 0 0 1px ${v.borderControl}`, marginRight: 4 }} />Status only, no times</span>
                  <span><span style={{ display: "inline-block", width: 0, height: 0, borderTop: `8px solid ${v.danger}`, borderLeft: "8px solid transparent", marginRight: 4 }} />One time only (forgot to punch out?)</span>
                  <span><span style={{ display: "inline-block", width: 6, height: 6, borderRadius: 6, background: v.success, marginRight: 4, verticalAlign: "middle" }} />Worked on an off day</span>
                  <span><span style={{ display: "inline-block", width: 14, height: 14, verticalAlign: "middle", background: v.warningSubtle, border: `1px solid ${v.warning}`, marginRight: 4 }} />Unsaved</span>
                  <span><LockOutlined /> Finalised</span>
                  <span><b style={{ color: v.accentText }}>~</b> Corrected: a request was approved (not from the device)</span>
                  <span><b style={{ color: v.accentText }}>#</b> Set by HR (Manual Override)</span>
                  <span><b style={{ color: v.accentText }}>^</b> Shift set for that day by HR</span>
                </div>
              </div>
              {data.canMark && (
                <div>
                  <Text type="secondary">What you can type</Text>
                  <ul style={{ margin: `${space[2]}px 0 0`, paddingLeft: 18, fontSize: fs.sm }}>
                    {data.inputHelp.map((h) => (
                      <li key={h.code}>
                        <Text code>{h.code}</Text> {h.label}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Panel>
        )}
      </Stack>

      <ManualOverrideModal target={overriding} onClose={() => setOverriding(null)} />

      <SideDrawer open={uploadOpen} onClose={() => setUploadOpen(false)} size="wide" title="Upload a filled-in muster" footer={null}>
        {data && <MusterUploadPanel branches={markBranches} cycles={cycles.data?.cycles ?? []} defaultBranch={query.locationId} defaultCycle={data.cycle.start} />}
      </SideDrawer>
    </>
  );
}
