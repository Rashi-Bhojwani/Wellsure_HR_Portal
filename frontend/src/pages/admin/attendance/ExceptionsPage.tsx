import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Badge, Button, DatePicker, Flex, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, message } from "antd";
import * as adminApi from "../../../api/attendanceAdmin";
import type { AssignPreview, DayExceptionType, ExceptionDay, ExceptionType, MapPreview, MapSelection, UnmappedGroup } from "../../../api/attendanceAdmin";
import * as attendanceApi from "../../../api/attendance";
import * as orgApi from "../../../api/org";
import type { CarriedSelection } from "../../../components/attendance/targetSelection";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { hoursLabel } from "./settings/format";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;
const ATTENDANCE = "/admin/workforce/attendance";
const DAY_TYPES: DayExceptionType[] = ["MISSING_PUNCH", "SHORTFALL", "HALF_DAY_MIN_NOT_MET", "NO_SHIFT", "CLOCK_FLAGGED"];
const TYPE_COLOR: Record<DayExceptionType, string> = { MISSING_PUNCH: "red", SHORTFALL: "gold", HALF_DAY_MIN_NOT_MET: "volcano", NO_SHIFT: "purple", CLOCK_FLAGGED: "geekblue" };
const isType = (v: string | null): v is ExceptionType => !!v && (v === "UNMAPPED_ID" || (DAY_TYPES as string[]).includes(v));
const PAGE_SIZE = 50;

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }) : "—");

// Workforce → Attendance → Attendance Exception (Phase 3 commit 3): the days that need a person to look, in one list, with
// the count of each kind up front; and the device IDs whose punches match nobody. A day leaves the list by itself once it
// is corrected. Late-in and early-out are not here: they are recorded, not problems. Bulk resolving is only where there is
// one obvious answer (map a device ID to the employee with that code; give no-shift days a shift); anything that needs a
// judgement goes to Regularizations or Manual Override with the people and dates carried over.
export function ExceptionsPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
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
  const { data, isLoading, error } = useQuery({ queryKey: ["attendance", "exceptions", query], queryFn: () => adminApi.listExceptions(query), retry: false });
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

  const options: Array<{ key: ExceptionType | undefined; label: string; count: number | undefined; hidden?: boolean }> = [
    { key: undefined, label: "All days", count: counts?.ALL_DAYS },
    { key: "MISSING_PUNCH", label: "Missing punch", count: counts?.MISSING_PUNCH },
    { key: "SHORTFALL", label: "Short of the full day", count: counts?.SHORTFALL },
    { key: "HALF_DAY_MIN_NOT_MET", label: "Half-day minimum not met", count: counts?.HALF_DAY_MIN_NOT_MET },
    { key: "NO_SHIFT", label: "No shift", count: counts?.NO_SHIFT },
    { key: "CLOCK_FLAGGED", label: "Clock-flagged punch", count: counts?.CLOCK_FLAGGED },
    { key: "UNMAPPED_ID", label: "Unmapped device IDs", count: counts?.UNMAPPED_ID },
  ];

  return (
    <Flex vertical gap={12}>
      <Title level={3} style={{ margin: 0 }}>
        Attendance Exception
      </Title>
      <Text type="secondary">
        Days that need someone to look, from the computed attendance. A day leaves this list by itself once it is corrected. Late arrivals and early departures are not listed: they are recorded, not problems to fix.
      </Text>
      <Flex gap={8} wrap align="center">
        <DatePicker.RangePicker
          allowClear={false}
          format="D MMM YYYY"
          value={range}
          onChange={(v) => v?.[0] && v[1] && change(() => setRange([v[0]!, v[1]!]))}
          disabledDate={(d) => d.isAfter(dayjs(), "day")}
        />
        <Select allowClear placeholder="Any branch" style={{ width: 200 }} value={locationId} onChange={(v) => change(() => setLocationId(v))} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
        <Select allowClear placeholder="Any department" style={{ width: 200 }} value={departmentId} onChange={(v) => change(() => setDepartmentId(v))} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
      </Flex>
      <Flex gap={8} wrap>
        {options.map((o) => (
          <Button key={o.key ?? "ALL"} type={type === o.key ? "primary" : "default"} onClick={() => pickType(o.key)}>
            {o.label} <Badge count={o.count ?? 0} showZero color={type === o.key ? "#fff" : undefined} style={type === o.key ? { color: "#1677ff" } : undefined} overflowCount={9999} />
          </Button>
        ))}
      </Flex>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the exceptions.")} />}

      {!unmappedView && (
        <>
          {picked.length > 0 && (
            <Flex gap={8} wrap align="center" style={{ background: "#fafafa", padding: 8, borderRadius: 6 }}>
              <Text strong>
                {picked.length} day{picked.length === 1 ? "" : "s"} selected
              </Text>
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
            </Flex>
          )}
          {type === "CLOCK_FLAGGED" && (
            <Alert
              type="info"
              showIcon
              title="A punch with an implausible time was set aside."
              description={
                <>
                  The day was worked out without it. Accept or discard it on <Link to="/admin/admin-tools/devices?tab=flagged">Devices → Flagged</Link>, and the day recomputes.
                </>
              }
            />
          )}
          <Table<ExceptionDay>
            size="small"
            rowKey="key"
            loading={isLoading}
            dataSource={data?.days ?? []}
            locale={{ emptyText: <EmptyState message="Nothing needs attention in this period." compact /> }}
            scroll={{ x: "max-content" }}
            rowSelection={{ selectedRowKeys: picked, onChange: setPicked, getCheckboxProps: (r) => ({ disabled: r.locked }) }}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: data?.total ?? 0, onChange: (p) => setPage(p), showSizeChanger: false, size: "small", showTotal: (t) => `${t} day${t === 1 ? "" : "s"}` }}
            columns={[
              {
                title: "Employee",
                key: "e",
                render: (_, r) => (
                  <Link to={`${ATTENDANCE}/info?employee=${r.employeeId}&date=${r.date}`}>
                    {r.employeeName ?? r.employeeCode} ({r.employeeCode})
                  </Link>
                ),
              },
              { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("ddd, D MMM YYYY") },
              {
                title: "Why",
                key: "types",
                render: (_, r) => (
                  <Space size={4} wrap>
                    {r.types.map((t) => (
                      <Tag key={t} color={TYPE_COLOR[t]}>
                        {adminApi.EXCEPTION_TYPE_LABEL[t]}
                      </Tag>
                    ))}
                  </Space>
                ),
              },
              { title: "Status", dataIndex: "status" },
              { title: "In – Out", key: "io", render: (_, r) => (r.firstIn || r.lastOut ? `${time(r.firstIn)} – ${time(r.lastOut)}` : "—") },
              { title: "Worked", dataIndex: "actualMinutes", align: "right", render: (m: number | null) => (m === null ? "—" : hoursLabel(m)) },
              { title: "Short by", dataIndex: "shortfallMinutes", align: "right", render: (m: number | null) => (m ? hoursLabel(m) : "—") },
              { title: "Shift", dataIndex: "shiftCode", render: (c: string | null) => c ?? <Text type="secondary">none</Text> },
              { title: "Branch", dataIndex: "branch" },
              { title: "Department", dataIndex: "department" },
              {
                title: "",
                key: "state",
                render: (_, r) => (
                  <Space size={4}>
                    {r.locked && (
                      <Tooltip title="This period is finalised. An administrator with the right to unlock must open it before this day can change.">
                        <Tag>Finalised</Tag>
                      </Tooltip>
                    )}
                    {r.provisional && <Tag color="blue">Day still open</Tag>}
                  </Space>
                ),
              },
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
          loading={isLoading}
          filter={filter}
          canMap={hasPermission("attendance.devices.manage")}
          onMap={setMapping}
          hasDepartmentFilter={!!departmentId}
        />
      )}

      <MapModal selection={mapping} onClose={() => setMapping(null)} onDone={() => void queryClient.invalidateQueries({ queryKey: ["attendance"] })} />
      <AssignModal
        open={assigning}
        onClose={() => setAssigning(false)}
        selection={{ keys: selectedDays.map((d) => ({ employeeId: d.employeeId, date: d.date })) }}
        count={selectedDays.length}
        onDone={() => {
          setPicked([]);
          void queryClient.invalidateQueries({ queryKey: ["attendance"] });
        }}
      />
    </Flex>
  );
}

function UnmappedTable({
  groups,
  total,
  page,
  onPage,
  loading,
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
  filter: adminApi.ExceptionFilter;
  canMap: boolean;
  onMap: (s: MapSelection) => void;
  hasDepartmentFilter: boolean;
}) {
  const [picked, setPicked] = useState<React.Key[]>([]);
  return (
    <>
      <Text type="secondary">
        Punches whose device user ID matched nobody. Where exactly one employee's code is that ID, it is offered as a match. Anything else is mapped by hand on{" "}
        <Link to="/admin/admin-tools/devices?tab=unmapped">Devices → Unmapped</Link>.
      </Text>
      {hasDepartmentFilter && <Alert type="info" showIcon title="Unmapped IDs belong to nobody yet, so they have no department. Clear the department filter to see them." />}
      {canMap && (
        <Flex gap={8} wrap>
          <Button type="primary" disabled={total === 0} onClick={() => onMap(picked.length ? { deviceUserIds: picked as string[] } : { filter })}>
            {picked.length ? `Map the suggested matches among ${picked.length} selected…` : "Map every suggested match…"}
          </Button>
        </Flex>
      )}
      <Table<UnmappedGroup>
        size="small"
        rowKey="deviceUserId"
        loading={loading}
        dataSource={groups}
        locale={{ emptyText: <EmptyState message="No punches are waiting for a device ID to be mapped." compact /> }}
        scroll={{ x: "max-content" }}
        rowSelection={canMap ? { selectedRowKeys: picked, onChange: setPicked } : undefined}
        pagination={{ current: page, pageSize: PAGE_SIZE, total, onChange: onPage, showSizeChanger: false, size: "small", showTotal: (t) => `${t} device ID${t === 1 ? "" : "s"}` }}
        columns={[
          { title: "Device user ID", dataIndex: "deviceUserId", render: (v: string) => <Text strong>{v}</Text> },
          { title: "Punches", dataIndex: "punches", align: "right" },
          { title: "Days", dataIndex: "days", align: "right" },
          { title: "First – last", key: "dates", render: (_, r) => (r.firstDay === r.lastDay ? dayjs(r.firstDay).format("D MMM YYYY") : `${dayjs(r.firstDay).format("D MMM")} – ${dayjs(r.lastDay).format("D MMM YYYY")}`) },
          { title: "Device", dataIndex: "devices", render: (d: string[]) => d.join(", ") },
          { title: "Branch", dataIndex: "branches", render: (b: string[]) => b.join(", ") },
          {
            title: "Suggested match",
            key: "s",
            render: (_, r) =>
              r.suggestion ? (
                <Space orientation="vertical" size={0}>
                  <span>
                    {r.suggestion.employeeName ?? r.suggestion.employeeCode} ({r.suggestion.employeeCode})
                  </span>
                  {r.suggestion.problem ? (
                    <Text type="warning" style={{ fontSize: fs.sm }}>
                      {r.suggestion.problem}
                    </Text>
                  ) : r.suggestion.partial ? (
                    <Text type="secondary" style={{ fontSize: fs.sm }}>
                      They joined after the first punch; the earlier ones stay unmapped.
                    </Text>
                  ) : null}
                </Space>
              ) : (
                <Text type="secondary">No employee has this code</Text>
              ),
          },
        ]}
      />
    </>
  );
}

/** Preview, then confirm exactly what was previewed: which IDs become whose, and what is left alone and why. */
function MapModal({ selection, onClose, onDone }: { selection: MapSelection | null; onClose: () => void; onDone: () => void }) {
  const { data, isFetching, error } = useQuery({
    queryKey: ["attendance", "exceptions", "map-preview", selection],
    queryFn: () => adminApi.previewMapDeviceIds(selection!),
    enabled: !!selection,
    gcTime: 0,
    retry: false,
  });
  const confirm = useMutation({
    mutationFn: (p: MapPreview) => adminApi.confirmMapDeviceIds(selection!, p.fingerprint),
    onSuccess: (r) => {
      void message.success(`${r.mapped} device ID${r.mapped === 1 ? "" : "s"} mapped; ${r.punchesResolved} punch${r.punchesResolved === 1 ? "" : "es"} now belong to someone${r.failed.length ? `. ${r.failed.length} could not be mapped: ${r.failed.map((f) => `${f.deviceUserId} (${f.message})`).join("; ")}` : "."}`);
      onDone();
      onClose();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not map these device IDs."));
      onDone();
      onClose();
    },
  });
  return (
    <Modal
      title="Map the suggested device IDs"
      open={!!selection}
      onCancel={onClose}
      width={820}
      destroyOnHidden
      okText={data ? `Map ${data.count} device ID${data.count === 1 ? "" : "s"}` : "Map"}
      okButtonProps={{ disabled: !data || data.count === 0 }}
      confirmLoading={confirm.isPending}
      onOk={() => data && confirm.mutate(data)}
    >
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not preview.")} />}
      {isFetching && <Text type="secondary">Working out what would be mapped…</Text>}
      {data && (
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Text>
            Each ID below equals exactly one employee's code, and that employee has no device ID yet. Each is mapped from its first punch (never before they joined), the punches are given to them, and their days are worked out again. Every mapping is on record.
          </Text>
          {data.ownLeftOut > 0 && <Alert type="info" showIcon title={`${data.ownLeftOut} of these ${data.ownLeftOut === 1 ? "is" : "are"} your own device ID and ${data.ownLeftOut === 1 ? "is" : "are"} left out: someone else maps those.`} />}
          <Table
            size="small"
            rowKey="deviceUserId"
            pagination={{ pageSize: 8, size: "small", hideOnSinglePage: true }}
            dataSource={data.items}
            locale={{ emptyText: "Nothing here can be mapped without a decision." }}
            columns={[
              { title: "Device ID", dataIndex: "deviceUserId" },
              { title: "Becomes", key: "e", render: (_, r) => `${r.employeeName ?? r.employeeCode} (${r.employeeCode})` },
              { title: "Punches", dataIndex: "punches", align: "right" },
              { title: "From", dataIndex: "firstDay", render: (d: string) => dayjs(d).format("D MMM YYYY") },
              { title: "", key: "p", render: (_, r) => (r.partial ? <Tag color="orange">Some punches predate joining</Tag> : null) },
            ]}
          />
          {data.skipped.length > 0 && (
            <Alert
              type="warning"
              showIcon
              title={`${data.skipped.length} left alone (they need a decision)`}
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.skipped.slice(0, 8).map((s) => (
                    <li key={s.deviceUserId}>
                      <Text strong>{s.deviceUserId}</Text> ({s.punches} punch{s.punches === 1 ? "" : "es"}): {s.reason}
                    </li>
                  ))}
                  {data.skipped.length > 8 && <li>and {data.skipped.length - 8} more</li>}
                </ul>
              }
            />
          )}
        </Space>
      )}
    </Modal>
  );
}

/** Pick a shift for the selected no-shift days, see who it will change and who it can't, then confirm that exact set. */
function AssignModal({ open, onClose, selection, count, onDone }: { open: boolean; onClose: () => void; selection: adminApi.AssignSelection; count: number; onDone: () => void }) {
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
    onError: (err) => void message.error(apiErrorMessage(err, "Could not preview this.")),
  });
  const confirm = useMutation({
    mutationFn: (note: string) => adminApi.confirmAssignShift(selection, shiftId!, preview!.fingerprint, note),
    onSuccess: (r) => {
      void message.success(`${r.shiftCode} assigned to ${r.employees} ${r.employees === 1 ? "person" : "people"}; ${r.days} day${r.days === 1 ? "" : "s"} worked out again.`);
      reset();
      onDone();
      onClose();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not assign this shift."));
      setPreview(null);
    },
  });
  return (
    <Modal
      title="Assign a shift"
      open={open}
      onCancel={() => {
        reset();
        onClose();
      }}
      width={820}
      destroyOnHidden
      okText="Assign"
      okButtonProps={{ disabled: !preview || preview.employees === 0 }}
      confirmLoading={confirm.isPending}
      onOk={() => form.validateFields().then((v) => confirm.mutate((v.note ?? "").trim()), () => undefined)}
    >
      <Space orientation="vertical" size={10} style={{ width: "100%" }}>
        <Text>
          {count} no-shift day{count === 1 ? "" : "s"} selected. The shift is assigned to each person <b>from their earliest selected day onward</b> (an ordinary change to their attendance assignment: their week-off pattern and policy stay as they are), and the days are worked out again.
        </Text>
        <Select
          placeholder="Choose the shift"
          style={{ width: 360 }}
          value={shiftId}
          onChange={(v) => {
            setShiftId(v);
            setPreview(null);
            previewMutation.mutate(v);
          }}
          options={shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code} · ${s.name} (${s.startTime}–${s.endTime})` }))}
        />
        {preview && (
          <>
            {preview.ownLeftOut > 0 && <Alert type="info" showIcon title={`${preview.ownLeftOut} of the days are your own and are left out: another administrator sets your shift.`} />}
            <Table
              size="small"
              rowKey="employeeId"
              pagination={{ pageSize: 8, size: "small", hideOnSinglePage: true }}
              dataSource={preview.items}
              columns={[
                { title: "Employee", key: "e", render: (_, r) => `${r.employeeName ?? r.employeeCode} (${r.employeeCode})` },
                { title: "No-shift days", dataIndex: "noShiftDays", align: "right" },
                { title: "From", dataIndex: "from", render: (d: string) => dayjs(d).format("D MMM YYYY") },
                { title: "Now on", dataIndex: "currentShift", render: (c: string | null) => c ?? <Text type="secondary">no assignment</Text> },
                {
                  title: "",
                  key: "p",
                  render: (_, r) =>
                    r.problemText ? (
                      <Text type="danger">{r.problemText}</Text>
                    ) : r.lockedDays > 0 ? (
                      <Tag>{r.lockedDays} finalised day{r.lockedDays === 1 ? " stays" : "s stay"} as is</Tag>
                    ) : (
                      <Tag color="green">Will change</Tag>
                    ),
                },
              ]}
            />
            <Text>
              {preview.employees} {preview.employees === 1 ? "person" : "people"}, {preview.days} day{preview.days === 1 ? "" : "s"} will change{preview.blockedEmployees > 0 ? `; ${preview.blockedEmployees} cannot be done here and are left alone` : ""}.
            </Text>
            <Form form={form} layout="vertical" requiredMark={false}>
              <Form.Item name="note" label="Note (optional)">
                <Input maxLength={500} placeholder="For the record" />
              </Form.Item>
            </Form>
          </>
        )}
      </Space>
    </Modal>
  );
}
