import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Radio, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import * as leaveApi from "../../../../api/leave";
import * as orgApi from "../../../../api/org";
import * as parityApi from "../../../../api/parity";
import * as workforceApi from "../../../../api/workforce";
import { useAuth } from "../../../../hooks/useAuth";
import { EmployeePicker } from "../../../../components/letters/LetterFields";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ConfirmModal, DataTable, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../../ui";
import { space } from "../../../../theme/tokens";

// A-10 G4 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 9b, 10): which locations a holiday is for, and weekend overrides for chosen people over a range.
// Both feed the attendance engine at once (the affected days are worked out again). Each change needs a reason and is kept; nothing is overwritten.

const fmt = (s: string) => dayjs(s).format("D MMM YYYY");

function ReasonBox({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  return <Input.TextArea aria-label="Reason" placeholder="Why (a few words)" rows={2} maxLength={300} value={value} onChange={(e) => onChange(e.target.value)} style={{ marginTop: space[2] }} />;
}

function HolidayLocations() {
  const queryClient = useQueryClient();
  const year = dayjs().year();
  const holidays = useQuery({ queryKey: ["holidays", year], queryFn: () => leaveApi.listHolidays(year) });
  const scopes = useQuery({ queryKey: ["workforce", "holiday-locations"], queryFn: workforceApi.holidayLocations });
  const locations = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const [editing, setEditing] = useState<{ id: string; name: string; ids: string[] } | null>(null);
  const [reason, setReason] = useState("");
  const name = new Map((locations.data ?? []).map((l) => [l.id, l.name]));
  const save = useMutation({
    mutationFn: () => workforceApi.setHolidayLocations(editing!.id, editing!.ids, reason.trim()),
    onSuccess: () => {
      toast.success("Saved. The day is being worked out again.");
      setEditing(null);
      setReason("");
      void queryClient.invalidateQueries({ queryKey: ["workforce", "holiday-locations"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save it.")),
  });
  return (
    <Panel title={`Holidays ${year}: for which locations`} subtitle="A holiday is for everyone unless you limit it to some locations.">
      <DataTable<leaveApi.HolidayRow>
        rowKey="id"
        loading={holidays.isLoading || scopes.isLoading}
        error={holidays.error ?? scopes.error}
        onRetry={() => void holidays.refetch()}
        dataSource={holidays.data ?? []}
        empty="No holidays this year."
        pagination={false}
        columns={[
          { title: "Date", dataIndex: "date", render: (x: string) => fmt(x) },
          { title: "Holiday", dataIndex: "name" },
          { title: "For", key: "for", render: (_, r) => { const ids = scopes.data?.[r.id] ?? []; return ids.length ? ids.map((i) => name.get(i) ?? i).join(", ") : "Everyone"; } },
          { title: "", key: "act", render: (_, r) => <Button onClick={() => setEditing({ id: r.id, name: r.name, ids: scopes.data?.[r.id] ?? [] })}>Change</Button> },
        ]}
      />
      <ConfirmModal open={!!editing} title={`Who gets ${editing?.name ?? "this holiday"}?`} description="Leave the list empty for everyone." confirmLabel="Save" confirmDisabled={reason.trim().length < 3} loading={save.isPending} onCancel={() => setEditing(null)} onConfirm={() => save.mutate()}>
        <Select mode="multiple" aria-label="Locations" placeholder="Everyone" style={{ width: "100%", marginTop: space[2] }} value={editing?.ids ?? []} onChange={(ids: string[]) => setEditing((e) => (e ? { ...e, ids } : e))} options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        <ReasonBox value={reason} onChange={setReason} />
      </ConfirmModal>
    </Panel>
  );
}

interface WeekendForm {
  range: [Dayjs, Dayjs];
  weekOffPatternId: string;
  who: "PEOPLE" | "SEGMENT";
  employeeIds?: string[];
  segmentId?: string;
  reason: string;
}

function WeekendOverrides() {
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [voiding, setVoiding] = useState<workforceApi.WeekendOverrideView | null>(null);
  const [reason, setReason] = useState("");
  const [form] = Form.useForm<WeekendForm>();
  const who = Form.useWatch("who", form);
  const rows = useQuery({ queryKey: ["workforce", "weekend"], queryFn: workforceApi.listWeekendOverrides });
  const patterns = useQuery({ queryKey: ["attendance", "week-off-patterns"], queryFn: attendanceApi.listWeekOffPatterns, enabled: adding });
  const segments = useQuery({ queryKey: ["segments"], queryFn: parityApi.listSegments, enabled: adding });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["workforce", "weekend"] });
  const create = useMutation({
    mutationFn: (v: WeekendForm) =>
      workforceApi.createWeekendOverride({ fromDate: v.range[0].format("YYYY-MM-DD"), toDate: v.range[1].format("YYYY-MM-DD"), weekOffPatternId: v.weekOffPatternId, employeeIds: v.who === "PEOPLE" ? v.employeeIds : undefined, segmentId: v.who === "SEGMENT" ? v.segmentId : null, reason: v.reason.trim() }),
    onSuccess: () => {
      toast.success("Saved. Those days are being worked out again.");
      setAdding(false);
      form.resetFields();
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save it.")),
  });
  const doVoid = useMutation({
    mutationFn: () => workforceApi.voidWeekendOverride(voiding!.id, reason.trim()),
    onSuccess: () => {
      toast.success("Voided.");
      setVoiding(null);
      setReason("");
      refresh();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not void it.")),
  });
  return (
    <Panel title="Weekend overrides" subtitle="Different week-off days for chosen people over a range of days (for example a swapped weekend)." extra={<Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>New override</Button>}>
      <DataTable<workforceApi.WeekendOverrideView>
        rowKey="id"
        loading={rows.isLoading}
        error={rows.error}
        onRetry={() => void rows.refetch()}
        dataSource={rows.data ?? []}
        empty="No weekend overrides."
        pagination={{ pageSize: 20 }}
        columns={[
          { title: "Days", key: "days", render: (_, r) => `${fmt(r.fromDate)} – ${fmt(r.toDate)}` },
          { title: "Week-offs", dataIndex: "pattern" },
          { title: "People", key: "people", render: (_, r) => (r.segmentName ? `${r.segmentName} (${r.people})` : r.people) },
          { title: "Reason", dataIndex: "reason", render: (x: string, r) => (r.voidReason ? `${x} · Voided: ${r.voidReason}` : x) },
          { title: "State", key: "state", render: (_, r) => <StatusChip tone={r.voidedAt ? "neutral" : "success"}>{r.voidedAt ? "Void" : "In force"}</StatusChip> },
          { title: "", key: "act", render: (_, r) => (r.voidedAt ? null : <Button onClick={() => setVoiding(r)}>Void</Button>) },
        ]}
      />
      <SideDrawer open={adding} title="New weekend override" subtitle="The days are worked out again at once." onClose={() => setAdding(false)} formId="weekend-form" primaryLabel="Save" primaryLoading={create.isPending}>
        <Form id="weekend-form" form={form} layout="vertical" requiredMark={false} initialValues={{ who: "PEOPLE" }} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="range" label="Days" rules={[{ required: true, message: "Choose the days" }]}>
            <DatePicker.RangePicker format="D MMM YYYY" style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="weekOffPatternId" label="Week-off days for those days" rules={[{ required: true, message: "Choose a pattern" }]}>
            <Select loading={patterns.isLoading} options={(patterns.data ?? []).filter((x) => x.isActive !== false).map((x) => ({ value: x.id, label: `${x.name} (${x.summary})` }))} />
          </Form.Item>
          <Form.Item name="who" label="For">
            <Radio.Group options={[{ value: "PEOPLE", label: "Chosen people" }, { value: "SEGMENT", label: "A saved segment" }]} />
          </Form.Item>
          {who === "SEGMENT" ? (
            <Form.Item name="segmentId" label="Segment" extra="The people in it now are taken." rules={[{ required: true, message: "Choose a segment" }]}>
              <Select loading={segments.isLoading} options={(segments.data ?? []).map((s) => ({ value: s.id, label: `${s.name} (${s.count})` }))} />
            </Form.Item>
          ) : (
            <Form.Item name="employeeIds" label="People" rules={[{ required: true, message: "Choose at least one person" }]}>
              <EmployeePicker multiple />
            </Form.Item>
          )}
          <Form.Item name="reason" label="Reason" rules={[{ required: true, min: 3, message: "Say why (a few words)" }]}>
            <Input.TextArea rows={2} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!voiding} title="Void this weekend override?" description="Their usual week-off days apply again; the days are worked out again." confirmLabel="Void" confirmDisabled={reason.trim().length < 3} loading={doVoid.isPending} onCancel={() => setVoiding(null)} onConfirm={() => doVoid.mutate()}>
        <ReasonBox value={reason} onChange={setReason} />
      </ConfirmModal>
    </Panel>
  );
}

export function CalendarAdjustmentsPage() {
  const { hasPermission } = useAuth(); // a director holds every key
  const holidays = hasPermission("leave.policy.manage");
  const weekend = hasPermission("attendance.config.manage");
  return (
    <>
      <PageHeader title="Calendar Adjustments" subtitle="Holidays for some locations only, and weekend overrides. Attendance follows at once." />
      <Stack>
        {holidays && <HolidayLocations />}
        {weekend && <WeekendOverrides />}
      </Stack>
    </>
  );
}
