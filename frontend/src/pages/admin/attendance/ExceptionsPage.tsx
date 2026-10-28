import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Input, Select, Tooltip } from "antd";
import { ArrowRightOutlined, ClockCircleOutlined } from "@ant-design/icons";
import * as adminApi from "../../../api/attendanceAdmin";
import type { AssignPreview, DayExceptionType, ExceptionDay, ExceptionType, MapPreview, MapSelection, UnmappedGroup } from "../../../api/attendanceAdmin";
import * as attendanceApi from "../../../api/attendance";
import * as orgApi from "../../../api/org";
import type { CarriedSelection } from "../../../components/attendance/targetSelection";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { hoursLabel } from "./settings/format";
import { attendanceStatusColor, fs, fw, radius, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, FilterBar, InitialsAvatar, PageHeader, Panel, QueryState, SideDrawer, Skel, Stack, StatusChip, toast, useIsPhone, type ChipTone } from "../../../ui";

const ATTENDANCE = "/admin/workforce/attendance";
const DAY_TYPES: DayExceptionType[] = ["MISSING_PUNCH", "SHORTFALL", "HALF_DAY_MIN_NOT_MET", "NO_SHIFT", "CLOCK_FLAGGED"];
const TYPE_TONE: Record<DayExceptionType, ChipTone> = { MISSING_PUNCH: "danger", SHORTFALL: "warning", HALF_DAY_MIN_NOT_MET: "danger", NO_SHIFT: "purple", CLOCK_FLAGGED: "info" };
const isType = (val: string | null): val is ExceptionType => !!val && (val === "UNMAPPED_ID" || (DAY_TYPES as string[]).includes(val));
const PAGE_SIZE = 50;
const plural = (n: number, word: string, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "—");
const inOut = (r: ExceptionDay) => (r.firstIn || r.lastOut ? `${time(r.firstIn)} – ${time(r.lastOut)}` : "—");
const muted = (text: string) => <span style={{ color: v.textSecondary }}>{text}</span>;

/** The computed day's status code in its attendance colour; the code is always written, never colour alone. */
function DayCode({ status }: { status: string }) {
  const c = attendanceStatusColor[status.split(":")[0] ?? status] ?? { bg: v.bgSubtle, fg: v.textSecondary };
  return (
    <span className="ws-num" style={{ display: "inline-block", minWidth: 32, textAlign: "center", padding: `0 ${space[2]}px`, borderRadius: radius.xs, background: c.bg, color: c.fg, fontWeight: fw.semibold, fontSize: fs.sm, lineHeight: "22px" }}>
      {status}
    </span>
  );
}

function TypeChips({ types }: { types: DayExceptionType[] }) {
  return (
    <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
      {types.map((t) => (
        <StatusChip key={t} tone={TYPE_TONE[t]}>
          {adminApi.EXCEPTION_TYPE_LABEL[t]}
        </StatusChip>
      ))}
    </div>
  );
}

function DayState({ r }: { r: ExceptionDay }) {
  if (!r.locked && !r.provisional) return null;
  return (
    <div style={{ display: "flex", gap: space[1], flexWrap: "wrap" }}>
      {r.locked && (
        <Tooltip title="This period is finalised. An administrator with the right to unlock must open it before this day can change.">
          <span tabIndex={0}>
            <StatusChip tone="neutral">Finalised</StatusChip>
          </span>
        </Tooltip>
      )}
      {r.provisional && <StatusChip tone="info">Day still open</StatusChip>}
    </div>
  );
}

// Workforce → Attendance → Attendance Exception (Phase 3 commit 3): the days that need a person to look, in one list, with
// the count of each kind up front; and the device IDs whose punches match nobody. A day leaves the list by itself once it
// is corrected. Late-in and early-out are not here: they are recorded, not problems. Bulk resolving is only where there is
// one obvious answer (map a device ID to the employee with that code; give no-shift days a shift); anything that needs a
// judgement goes to Regularizations or Manual Override with the people and dates carried over.
// Board frame checklist-03 (a titled queue with filters top-right and counts up front).
export function ExceptionsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const urlType = params.get("type");
  const [type, setType] = useState<ExceptionType | undefined>(isType(urlType) ? urlType : undefined);
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([params.get("from") ? dayjs(params.get("from")) : dayjs().subtract(13, "day"), params.get("to") ? dayjs(params.get("to")) : dayjs()]);
  const [locationId, setLocationId] = useState<string | undefined>();
  const [departmentId, setDepartmentId] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [picked, setPicked] = useState<React.Key[]>([]);
  const [mapping, setMapping] = useState<MapSelection | null>(null);
  const [assigning, setAssigning] = useState(false);

  const filter = { from: range[0].format("YYYY-MM-DD"), to: range[1].format("YYYY-MM-DD"), locationId, departmentId };
  const query = { ...filter, type, page, pageSize: PAGE_SIZE };
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: () => orgApi.departments.list() });
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["attendance", "exceptions", query],
    queryFn: () => adminApi.listExceptions(query),
    retry: false,
    placeholderData: keepPreviousData,
  });
  const change = (patch: () => void) => {
    patch();
    setPage(1);
    setPicked([]);
  };
  const pickType = (t: ExceptionType | undefined) =>
    change(() => {
      setType(t);
      const next = new URLSearchParams(params);
      if (t) next.set("type", t);
      else next.delete("type");
      setParams(next, { replace: true });
    });

  const counts = data?.counts;
  const unmappedView = type === "UNMAPPED_ID";
  const selectedDays = useMemo(() => (data?.days ?? []).filter((d) => picked.includes(d.key)), [data, picked]);
  const carry = (to: string) => {
    const ids = [...new Set(selectedDays.map((d) => d.employeeId))];
    const dates = selectedDays.map((d) => d.date).sort();
    const carried: CarriedSelection = {
      employeeIds: ids,
      people: ids.map((id) => {
        const d = selectedDays.find((x) => x.employeeId === id)!;
        return { value: id, label: `${d.employeeName ?? d.employeeCode} (${d.employeeCode})` };
      }),
      from: dates[0]!,
      to: dates.at(-1)!,
    };
    navigate(`${ATTENDANCE}/${to}`, { state: { carried } });
  };
  const togglePick = (key: string, on: boolean) => setPicked((p) => (on ? [...p, key] : p.filter((k) => k !== key)));

  const options: Array<{ key: ExceptionType | undefined; label: string; count: number | undefined }> = [
    { key: undefined, label: "All days", count: counts?.ALL_DAYS },
    { key: "MISSING_PUNCH", label: "Missing punch", count: counts?.MISSING_PUNCH },
    { key: "SHORTFALL", label: "Short of the full day", count: counts?.SHORTFALL },
    { key: "HALF_DAY_MIN_NOT_MET", label: "Half-day minimum not met", count: counts?.HALF_DAY_MIN_NOT_MET },
    { key: "NO_SHIFT", label: "No shift", count: counts?.NO_SHIFT },
    { key: "CLOCK_FLAGGED", label: "Clock-flagged punch", count: counts?.CLOCK_FLAGGED },
    { key: "UNMAPPED_ID", label: "Unmapped device IDs", count: counts?.UNMAPPED_ID },
  ];
  const filterCount = (locationId ? 1 : 0) + (departmentId ? 1 : 0);
  const selectWidth = phone ? "100%" : 200;

  const person = (r: ExceptionDay) => (
    <div style={{ display: "flex", alignItems: "center", gap: space[3], minWidth: 0 }}>
      <InitialsAvatar name={r.employeeName ?? r.employeeCode} size={32} />
      <div style={{ minWidth: 0 }}>
        <Link to={`${ATTENDANCE}/info?employee=${r.employeeId}&date=${r.date}`} style={{ fontWeight: fw.semibold }}>
          {r.employeeName ?? r.employeeCode} ({r.employeeCode})
        </Link>
        {(r.branch || r.department) && <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{[r.branch, r.department].filter(Boolean).join(" · ")}</div>}
      </div>
    </div>
  );

  return (
    <>
      <PageHeader title="Attendance Exception" subtitle="Days that need someone to look, from the computed attendance" />
      <Stack>
        <Panel
          title="Exceptions"
          subtitle="A day leaves this list by itself once it is corrected. Late arrivals and early departures are not listed: they are recorded, not problems to fix."
        >
          <FilterBar
            activeCount={filterCount}
            onClear={() => change(() => {
              setLocationId(undefined);
              setDepartmentId(undefined);
            })}
            filters={
              <>
                <DatePicker.RangePicker
                  aria-label="Dates"
                  allowClear={false}
                  format="D MMM YYYY"
                  value={range}
                  style={{ width: phone ? "100%" : undefined }}
                  onChange={(val) => val?.[0] && val[1] && change(() => setRange([val[0]!, val[1]!]))}
                  disabledDate={(d) => d.isAfter(dayjs(), "day")}
                />
                <Select allowClear placeholder="Any branch" aria-label="Branch" style={{ width: selectWidth }} value={locationId} onChange={(val) => change(() => setLocationId(val))} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
                <Select allowClear placeholder="Any department" aria-label="Department" style={{ width: selectWidth }} value={departmentId} onChange={(val) => change(() => setDepartmentId(val))} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
              </>
            }
          />

          {/* The count of each kind up front; picking one narrows the list. Scrolls sideways inside itself on a phone. */}
          <div role="group" aria-label="Exception type" style={{ display: "flex", gap: space[2], flexWrap: phone ? "nowrap" : "wrap", overflowX: phone ? "auto" : undefined, paddingBottom: phone ? space[1] : 0, marginBottom: space[5] }}>
            {options.map((o) => {
              const active = type === o.key;
              return (
                <Button key={o.key ?? "ALL"} type={active ? "primary" : "default"} aria-pressed={active} onClick={() => pickType(o.key)} style={{ flex: "none" }}>
                  {o.label}
                  <span
                    className="ws-num"
                    style={{ marginLeft: space[2], minWidth: 22, padding: `0 ${space[2]}px`, borderRadius: radius.pill, fontSize: fs.xs, fontWeight: fw.semibold, lineHeight: "20px", background: active ? v.bgSurface : v.bgSubtle, color: active ? v.accentText : v.textSecondary }}
                  >
                    {counts ? (o.count ?? 0) : "…"}
                  </span>
                </Button>
              );
            })}
          </div>

          {!unmappedView && (
            <>
              {picked.length > 0 && (
                <div
                  role="region"
                  aria-label="Selected days"
                  style={{ display: "flex", gap: space[2], flexWrap: "wrap", alignItems: "center", background: v.accentSubtle, padding: `${space[3]}px ${space[4]}px`, borderRadius: radius.md, marginBottom: space[4] }}
                >
                  <span style={{ fontWeight: fw.semibold, color: v.accentText, marginRight: space[2] }}>{plural(picked.length, "day")} selected</span>
                  {type === "NO_SHIFT" && hasPermission("attendance.config.manage") && (
                    <Button type="primary" onClick={() => setAssigning(true)}>
                      Assign a shift…
                    </Button>
                  )}
                  {hasPermission("attendance.regularization.bulk") && <Button onClick={() => carry("regularizations")}>Correct in bulk (Regularizations)…</Button>}
                  {hasPermission("attendance.override.manage") && <Button onClick={() => carry("manual-override")}>Set the days (Manual Override)…</Button>}
                  {type === "NO_SHIFT" && hasPermission("attendance.override.manage") && <Button onClick={() => carry("shift-override")}>Give a shift for these days (Shift Override)…</Button>}
                  <Button type="link" onClick={() => setPicked([])}>
                    Clear selection
                  </Button>
                </div>
              )}
              {type === "CLOCK_FLAGGED" && (
                <ApprovalBanner
                  tone="info"
                  icon={<ClockCircleOutlined />}
                  style={{ marginBottom: space[4] }}
                  title="A punch with an implausible time was set aside."
                  description="The day was worked out without it. Accept or discard it on Devices → Flagged, and the day recomputes."
                  actions={
                    <Button onClick={() => navigate("/admin/admin-tools/devices?tab=flagged")} icon={<ArrowRightOutlined />} iconPlacement="end">
                      Devices → Flagged
                    </Button>
                  }
                />
              )}
              <DataTable<ExceptionDay>
                density="compact"
                rowKey="key"
                loading={isLoading || isFetching}
                error={error}
                onRetry={() => void refetch()}
                dataSource={data?.days ?? []}
                empty={
                  <EmptyState
                    compact
                    illustration="success"
                    title="Nothing needs attention in this period."
                    description={type || filterCount ? "Try another kind, a wider date range or clear the filters." : "New exceptions appear here as days are worked out."}
                  />
                }
                rowSelection={{ selectedRowKeys: picked, onChange: setPicked, getCheckboxProps: (r) => ({ disabled: r.locked, "aria-label": `Select ${r.employeeName ?? r.employeeCode} on ${r.date}` }) }}
                pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: (p) => { setPage(p); setPicked([]); }, showSizeChanger: false, showTotal: (t) => plural(t, "day") }}
                mobile={{
                  selection: false, // renders its own select control on the card
                  title: (r) => `${r.employeeName ?? r.employeeCode} (${r.employeeCode})`,
                  subtitle: (r) => dayjs(r.date).format("ddd, D MMM YYYY"),
                  status: (r) => <DayCode status={r.status} />,
                  fields: [
                    { label: "Why", render: (r) => <TypeChips types={r.types} /> },
                    { label: "In – Out", render: inOut },
                    { label: "Worked", render: (r) => (r.actualMinutes === null ? "—" : hoursLabel(r.actualMinutes)) },
                    { label: "Short by", render: (r) => (r.shortfallMinutes ? hoursLabel(r.shortfallMinutes) : "—") },
                    { label: "Shift", render: (r) => r.shiftCode ?? muted("none") },
                    { label: "Branch", render: (r) => r.branch ?? "—" },
                    { label: "Department", render: (r) => r.department ?? "—" },
                  ],
                  actions: (r) => (
                    <div style={{ display: "flex", gap: space[3], alignItems: "center", flexWrap: "wrap", width: "100%" }}>
                      <Checkbox checked={picked.includes(r.key)} disabled={r.locked} onChange={(e) => togglePick(r.key, e.target.checked)} style={{ minHeight: 44, alignItems: "center" }}>
                        Select
                      </Checkbox>
                      <DayState r={r} />
                      <Button style={{ marginLeft: "auto" }} onClick={() => navigate(`${ATTENDANCE}/info?employee=${r.employeeId}&date=${r.date}`)}>
                        Open day
                      </Button>
                    </div>
                  ),
                }}
                columns={[
                  { title: "Employee", key: "e", render: (_, r) => person(r) },
                  { title: "Day", dataIndex: "date", render: (d: string) => <span className="ws-num">{dayjs(d).format("ddd, D MMM YYYY")}</span> },
                  { title: "Why", key: "types", render: (_, r) => <TypeChips types={r.types} /> },
                  { title: "Status", dataIndex: "status", render: (s: string) => <DayCode status={s} /> },
                  { title: "In – Out", key: "io", render: (_, r) => <span className="ws-num">{inOut(r)}</span> },
                  { title: "Worked", dataIndex: "actualMinutes", align: "right", render: (m: number | null) => <span className="ws-num">{m === null ? "—" : hoursLabel(m)}</span> },
                  { title: "Short by", dataIndex: "shortfallMinutes", align: "right", render: (m: number | null) => <span className="ws-num">{m ? hoursLabel(m) : "—"}</span> },
                  { title: "Shift", dataIndex: "shiftCode", render: (c: string | null) => c ?? muted("none") },
                  { title: "", key: "state", render: (_, r) => <DayState r={r} /> },
                ]}
              />
            </>
          )}

          {unmappedView && (
            <UnmappedTable
              groups={data?.unmapped ?? []}
              total={data?.total ?? 0}
              page={page}
              onPage={setPage}
              loading={isLoading || isFetching}
              error={error}
              onRetry={() => void refetch()}
              filter={filter}
              canMap={hasPermission("attendance.devices.manage")}
              onMap={setMapping}
              hasDepartmentFilter={!!departmentId}
            />
          )}
        </Panel>
      </Stack>

      <MapDrawer selection={mapping} onClose={() => setMapping(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: ["attendance"] })} />
      <AssignDrawer
        open={assigning}
        onClose={() => setAssigning(false)}
        selection={{ keys: selectedDays.map((d) => ({ employeeId: d.employeeId, date: d.date })) }}
        count={selectedDays.length}
        onDone={() => {
          setPicked([]);
          void queryClient.invalidateQueries({ queryKey: ["attendance"] });
        }}
      />
    </>
  );
}

function UnmappedTable({
  groups,
  total,
  page,
  onPage,
  loading,
  error,
  onRetry,
  filter,
  canMap,
  onMap,
  hasDepartmentFilter,
}: {
  groups: UnmappedGroup[];
  total: number;
  page: number;
  onPage: (p: number) => void;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  filter: adminApi.ExceptionFilter;
  canMap: boolean;
  onMap: (s: MapSelection) => void;
  hasDepartmentFilter: boolean;
}) {
  const phone = useIsPhone();
  const [pickedRaw, setPicked] = useState<React.Key[]>([]);
  // Only IDs still listed on this page count as selected: mapped ones leave the list, and another page is another set.
  const listed = useMemo(() => new Set(groups.map((g) => g.deviceUserId)), [groups]);
  const picked = useMemo(() => pickedRaw.filter((k) => listed.has(k as string)), [pickedRaw, listed]);
  const dates = (r: UnmappedGroup) => (r.firstDay === r.lastDay ? dayjs(r.firstDay).format("D MMM YYYY") : `${dayjs(r.firstDay).format("D MMM")} – ${dayjs(r.lastDay).format("D MMM YYYY")}`);
  const suggestion = (r: UnmappedGroup) =>
    r.suggestion ? (
      <div>
        <div>
          {r.suggestion.employeeName ?? r.suggestion.employeeCode} ({r.suggestion.employeeCode})
        </div>
        {r.suggestion.problem ? (
          <div style={{ fontSize: fs.sm, color: v.warningText }}>{r.suggestion.problem}</div>
        ) : r.suggestion.partial ? (
          <div style={{ fontSize: fs.sm, color: v.textSecondary }}>They joined after the first punch; the earlier ones stay unmapped.</div>
        ) : null}
      </div>
    ) : (
      muted("No employee has this code")
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
      <p style={{ margin: 0, color: v.textSecondary, fontSize: fs.md }}>
        Punches whose device user ID matched nobody. Where exactly one employee's code is that ID, it is offered as a match. Anything else is mapped by hand on{" "}
        <Link to="/admin/admin-tools/devices?tab=unmapped">Devices → Unmapped</Link>.
      </p>
      {hasDepartmentFilter && <ApprovalBanner tone="info" title="Unmapped IDs belong to nobody yet, so they have no department. Clear the department filter to see them." />}
      {canMap && (
        <div>
          <Button type="primary" disabled={total === 0} block={phone} onClick={() => onMap(picked.length ? { deviceUserIds: picked as string[] } : { filter })}>
            {picked.length ? `Map the suggested matches among ${picked.length} selected…` : "Map every suggested match…"}
          </Button>
        </div>
      )}
      <DataTable<UnmappedGroup>
        density="compact"
        rowKey="deviceUserId"
        loading={loading}
        error={error}
        onRetry={onRetry}
        dataSource={groups}
        empty={<EmptyState compact illustration="success" title="No punches are waiting for a device ID to be mapped." description={null} />}
        rowSelection={canMap ? { selectedRowKeys: picked, onChange: setPicked } : undefined}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: onPage, showSizeChanger: false, showTotal: (t) => plural(t, "device ID") }}
        mobile={{
          selection: false, // renders its own select control on the card
          title: (r) => `Device ID ${r.deviceUserId}`,
          subtitle: dates,
          fields: [
            { label: "Punches", render: (r) => r.punches },
            { label: "Days", render: (r) => r.days },
            { label: "Device", render: (r) => r.devices.join(", ") || "—" },
            { label: "Branch", render: (r) => r.branches.join(", ") || "—" },
            { label: "Suggested match", render: suggestion },
          ],
          actions: canMap
            ? (r) => (
                <Checkbox
                  checked={picked.includes(r.deviceUserId)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, r.deviceUserId] : p.filter((k) => k !== r.deviceUserId)))}
                  style={{ minHeight: 44, alignItems: "center" }}
                >
                  Select
                </Checkbox>
              )
            : undefined,
        }}
        columns={[
          { title: "Device user ID", dataIndex: "deviceUserId", render: (val: string) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{val}</span> },
          { title: "Punches", dataIndex: "punches", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
          { title: "Days", dataIndex: "days", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
          { title: "First – last", key: "dates", render: (_, r) => <span className="ws-num">{dates(r)}</span> },
          { title: "Device", dataIndex: "devices", render: (d: string[]) => d.join(", ") },
          { title: "Branch", dataIndex: "branches", render: (b: string[]) => b.join(", ") },
          { title: "Suggested match", key: "s", render: (_, r) => suggestion(r) },
        ]}
      />
    </div>
  );
}

const previewSkeleton = (
  <div style={{ display: "flex", flexDirection: "column", gap: space[3] }} aria-busy="true" aria-label="Working out what would change">
    <Skel h={18} w="70%" />
    <Skel h={40} r={radius.md} />
    <Skel h={40} r={radius.md} />
    <Skel h={40} r={radius.md} />
  </div>
);

/** Preview, then confirm exactly what was previewed: which IDs become whose, and what is left alone and why. Audited; waits for the server. */
function MapDrawer({ selection, onClose, onDone }: { selection: MapSelection | null; onClose: () => void; onDone: () => void }) {
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["attendance", "exceptions", "map-preview", selection],
    queryFn: () => adminApi.previewMapDeviceIds(selection!),
    enabled: !!selection,
    gcTime: 0,
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: (p: MapPreview) => adminApi.confirmMapDeviceIds(selection!, p.fingerprint),
    onSuccess: (r) => {
      const msg = `${plural(r.mapped, "device ID")} mapped; ${plural(r.punchesResolved, "punch", "punches")} now belong to someone${r.failed.length ? `. ${r.failed.length} could not be mapped: ${r.failed.map((f) => `${f.deviceUserId} (${f.message})`).join("; ")}` : "."}`;
      if (r.failed.length) toast.warning(msg);
      else toast.success(msg);
      onDone();
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not map these device IDs."));
      onDone();
      onClose();
    },
  });
  type Item = MapPreview["items"][number];
  return (
    <SideDrawer
      open={!!selection}
      onClose={() => !confirm.isPending && onClose()}
      size="wide"
      title="Map the suggested device IDs"
      subtitle="Check exactly what is mapped before confirming"
      primaryLabel={data ? `Map ${plural(data.count, "device ID")}` : "Map"}
      onPrimary={() => data && confirm.mutate(data)}
      primaryDisabled={!data || data.count === 0 || isFetching}
      primaryLoading={confirm.isPending}
    >
      <QueryState isLoading={isFetching && !data} error={error} onRetry={() => void refetch()} skeleton={previewSkeleton}>
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            <p style={{ margin: 0, color: v.textBody, fontSize: fs.md }}>
              Each ID below equals exactly one employee's code, and that employee has no device ID yet. Each is mapped from its first punch (never before they joined), the punches are given to them, and their days are worked out again. Every mapping is on record.
            </p>
            {data.ownLeftOut > 0 && (
              <ApprovalBanner tone="info" title={`${data.ownLeftOut} of these ${data.ownLeftOut === 1 ? "is" : "are"} your own device ID and ${data.ownLeftOut === 1 ? "is" : "are"} left out: someone else maps those.`} />
            )}
            <DataTable<Item>
              density="compact"
              rowKey="deviceUserId"
              pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
              showTotal={false}
              dataSource={data.items}
              empty={<EmptyState compact title="Nothing here can be mapped without a decision." description={null} />}
              mobile={{
                title: (r) => `${r.deviceUserId} → ${r.employeeName ?? r.employeeCode} (${r.employeeCode})`,
                subtitle: (r) => `From ${dayjs(r.firstDay).format("D MMM YYYY")}`,
                status: (r) => (r.partial ? <StatusChip tone="warning">Some punches predate joining</StatusChip> : null),
                fields: [{ label: "Punches", render: (r) => r.punches }],
              }}
              columns={[
                { title: "Device ID", dataIndex: "deviceUserId" },
                { title: "Becomes", key: "e", render: (_, r) => `${r.employeeName ?? r.employeeCode} (${r.employeeCode})` },
                { title: "Punches", dataIndex: "punches", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
                { title: "From", dataIndex: "firstDay", render: (d: string) => <span className="ws-num">{dayjs(d).format("D MMM YYYY")}</span> },
                { title: "", key: "p", render: (_, r) => (r.partial ? <StatusChip tone="warning">Some punches predate joining</StatusChip> : null) },
              ]}
            />
            {data.skipped.length > 0 && (
              <ApprovalBanner
                tone="warning"
                title={`${data.skipped.length} left alone (they need a decision)`}
                description={
                  <ul style={{ margin: 0, paddingLeft: space[5] }}>
                    {data.skipped.slice(0, 8).map((s) => (
                      <li key={s.deviceUserId}>
                        <strong>{s.deviceUserId}</strong> ({plural(s.punches, "punch", "punches")}): {s.reason}
                      </li>
                    ))}
                    {data.skipped.length > 8 && <li>and {data.skipped.length - 8} more</li>}
                  </ul>
                }
              />
            )}
          </div>
        )}
      </QueryState>
    </SideDrawer>
  );
}

/** Pick a shift for the selected no-shift days, see who it will change and who it can't, then confirm that exact set. Audited; waits for the server. */
function AssignDrawer({ open, onClose, selection, count, onDone }: { open: boolean; onClose: () => void; selection: adminApi.AssignSelection; count: number; onDone: () => void }) {
  const phone = useIsPhone();
  const [shiftId, setShiftId] = useState<string | undefined>();
  const [preview, setPreview] = useState<AssignPreview | null>(null);
  const [form] = Form.useForm<{ note: string }>();
  const { data: shifts = [] } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts, enabled: open });
  const reset = () => {
    setShiftId(undefined);
    setPreview(null);
    form.resetFields();
  };
  const previewMutation = useMutation({
    mutationFn: (id: string) => adminApi.previewAssignShift(selection, id),
    onSuccess: setPreview,
    onError: (err) => toast.error(apiErrorMessage(err, "Could not preview this.")),
  });
  const confirm = useMutation({
    mutationFn: (note: string) => adminApi.confirmAssignShift(selection, shiftId!, preview!.fingerprint, note),
    onSuccess: (r) => {
      toast.success(`${r.shiftCode} assigned to ${r.employees} ${r.employees === 1 ? "person" : "people"}; ${plural(r.days, "day")} worked out again.`);
      reset();
      onDone();
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not assign this shift."));
      setPreview(null);
    },
  });
  type Item = AssignPreview["items"][number];
  const outcome = (r: Item) =>
    r.problemText ? (
      <span style={{ color: v.danger }}>{r.problemText}</span>
    ) : r.lockedDays > 0 ? (
      <StatusChip tone="neutral">{r.lockedDays} finalised day{r.lockedDays === 1 ? " stays" : "s stay"} as is</StatusChip>
    ) : (
      <StatusChip tone="success">Will change</StatusChip>
    );
  return (
    <SideDrawer
      open={open}
      onClose={() => {
        if (confirm.isPending) return;
        reset();
        onClose();
      }}
      size="wide"
      title="Assign a shift"
      subtitle={`${plural(count, "no-shift day")} selected`}
      primaryLabel="Assign"
      onPrimary={() => form.validateFields().then((val) => confirm.mutate((val.note ?? "").trim()), () => undefined)}
      primaryDisabled={!preview || preview.employees === 0}
      primaryLoading={confirm.isPending}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
        <p style={{ margin: 0, color: v.textBody, fontSize: fs.md }}>
          The shift is assigned to each person <strong>from their earliest selected day onward</strong> (an ordinary change to their attendance assignment: their week-off pattern and policy stay as they are), and the days are worked out again.
        </p>
        <div>
          <label htmlFor="assign-shift-select" style={{ display: "block", fontWeight: fw.medium, marginBottom: space[2] }}>
            Shift
          </label>
          <Select
            id="assign-shift-select"
            placeholder="Choose the shift"
            style={{ width: phone ? "100%" : 360 }}
            value={shiftId}
            loading={previewMutation.isPending}
            onChange={(val) => {
              setShiftId(val);
              setPreview(null);
              previewMutation.mutate(val);
            }}
            options={shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name} (${s.startTime}–${s.endTime})` }))}
          />
        </div>
        {previewMutation.isPending && previewSkeleton}
        {preview && (
          <>
            {preview.ownLeftOut > 0 && <ApprovalBanner tone="info" title={`${preview.ownLeftOut} of the days are your own and are left out: another administrator sets your shift.`} />}
            <DataTable<Item>
              density="compact"
              rowKey="employeeId"
              pagination={{ pageSize: 8, hideOnSinglePage: true, showSizeChanger: false }}
              showTotal={false}
              dataSource={preview.items}
              mobile={{
                title: (r) => `${r.employeeName ?? r.employeeCode} (${r.employeeCode})`,
                subtitle: (r) => `From ${dayjs(r.from).format("D MMM YYYY")}`,
                fields: [
                  { label: "No-shift days", render: (r) => r.noShiftDays },
                  { label: "Now on", render: (r) => r.currentShift ?? muted("no assignment") },
                  { label: "Outcome", render: outcome },
                ],
              }}
              columns={[
                { title: "Employee", key: "e", render: (_, r) => `${r.employeeName ?? r.employeeCode} (${r.employeeCode})` },
                { title: "No-shift days", dataIndex: "noShiftDays", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
                { title: "From", dataIndex: "from", render: (d: string) => <span className="ws-num">{dayjs(d).format("D MMM YYYY")}</span> },
                { title: "Now on", dataIndex: "currentShift", render: (c: string | null) => c ?? muted("no assignment") },
                { title: "", key: "p", render: (_, r) => outcome(r) },
              ]}
            />
            <ApprovalBanner
              tone={preview.employees === 0 ? "warning" : "info"}
              title={`${preview.employees} ${preview.employees === 1 ? "person" : "people"}, ${plural(preview.days, "day")} will change${preview.blockedEmployees > 0 ? `; ${preview.blockedEmployees} cannot be done here and are left alone` : ""}.`}
            />
            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item name="note" label="Note (optional)" style={{ marginBottom: 0 }}>
                <Input maxLength={500} placeholder="For the record" />
              </Form.Item>
            </Form>
          </>
        )}
      </div>
    </SideDrawer>
  );
}
