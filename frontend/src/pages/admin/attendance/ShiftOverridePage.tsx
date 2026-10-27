import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select, Tooltip } from "antd";
import * as adminApi from "../../../api/attendanceAdmin";
import type { ShiftOverrideBody, ShiftOverridePreview } from "../../../api/attendanceAdmin";
import * as attendanceApi from "../../../api/attendance";
import * as employeeApi from "../../../api/employee";
import { TargetPicker } from "../../../components/attendance/TargetPicker";
import { selectionOf, type CarriedSelection, type TargetValues } from "../../../components/attendance/targetSelection";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, CardGrid, ConfirmModal, DataTable, EmptyState, FilterBar, FormGroupTitle, PageHeader, Panel, Stack, StatCard, StatusChip, toast, useIsPhone } from "../../../ui";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ConfirmBar, LeftOutList } from "./previewParts";

interface Values extends TargetValues {
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  shiftId?: string;
  note?: string;
}

type PreviewRow = ShiftOverridePreview["rows"][number];
type Entry = adminApi.ShiftOverrideEntry;

// Workforce → Attendance → Shift Override (Phase 3 commit 2): a shift for specific dates for one person or many, ahead of
// their usual assignment. It changes the shift only (the week-off pattern and policy stay theirs), is previewed first, and
// every change is on record. For a repeating pattern from tomorrow, use Shift Roster instead.
export function ShiftOverridePage() {
  const [form] = Form.useForm<Values>();
  const phone = useIsPhone();
  const carried = (useLocation().state as { carried?: CarriedSelection } | null)?.carried; // people and dates chosen on the Exceptions queue
  useEffect(() => {
    if (carried) form.setFieldsValue({ who: "LIST", employeeIds: carried.employeeIds, range: [dayjs(carried.from), dayjs(carried.to)] });
  }, [carried, form]);
  const [noteForm] = Form.useForm<{ note: string }>();
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<{ data: ShiftOverridePreview; body: ShiftOverrideBody } | null>(null);
  const [looked, setLooked] = useState(false);
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const { data: shifts = [] } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const { data: people } = useQuery({ queryKey: ["employees", "picker", search], queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20 }) });
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["attendance", "shift-overrides", employeeId, page],
    queryFn: () => adminApi.listShiftOverrides({ employeeId, page, pageSize: 15 }),
    placeholderData: keepPreviousData,
  });

  const previewMutation = useMutation({
    mutationFn: (body: ShiftOverrideBody) => adminApi.previewShiftOverride(body).then((d) => ({ data: d, body })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not preview this shift override.")),
  });
  const confirm = useMutation({
    mutationFn: () => adminApi.confirmShiftOverride(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      toast.success(`Shift set for ${r.days} employee-day${r.days === 1 ? "" : "s"} (${r.employees} ${r.employees === 1 ? "person" : "people"}).`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setPreview(null);
      form.resetFields();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not apply this shift override."));
      setPreview(null);
      setLooked(false);
    },
  });
  const clear = useMutation({
    mutationFn: (note: string) => adminApi.clearShiftOverride({ employeeId: removing!.employeeId, date: removing!.date, note }),
    onSuccess: () => {
      toast.success("Removed: the day follows their usual shift again.");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setRemoving(null);
      noteForm.resetFields();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove this shift override.")),
  });

  const stateCell = (r: Entry) =>
    r.inForce ? (
      <Tooltip title="Goes back to the person's usual shift for that day.">
        <Button size={phone ? "middle" : "small"} onClick={() => setRemoving(r)}>
          Remove
        </Button>
      </Tooltip>
    ) : (
      <StatusChip tone="neutral">{r.cleared ? "removal" : "replaced"}</StatusChip>
    );

  const d = preview?.data;
  return (
    <>
      <PageHeader title="Shift Override" subtitle="Set a different shift on particular days, for one person or many" />
      <Stack>
        <Panel title="Set a shift for specific dates" subtitle="Preview first; nothing changes until you confirm.">
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ who: "LIST" }}
            onValuesChange={() => {
              setPreview(null);
              setLooked(false);
            }}
            onFinish={(val) => {
              const sel = selectionOf(val);
              if (!sel.selection) return void toast.error(sel.error);
              previewMutation.mutate({ selection: sel.selection, from: val.range![0].format("YYYY-MM-DD"), to: val.range![1].format("YYYY-MM-DD"), shiftId: val.shiftId!, note: (val.note ?? "").trim() });
            }}
          >
            <ApprovalBanner
              tone="info"
              title="For a swap or cover on particular days"
              description="A past day in the current or previous cycle, or a day up to the usual scheduling limit ahead. Only the shift changes; the week-off pattern and policy stay the person's own. Your own days are left out."
              style={{ marginBottom: space[5] }}
            />
            <FormGroupTitle>Who</FormGroupTitle>
            <TargetPicker known={carried?.people} />
            <FormGroupTitle>Dates and shift</FormGroupTitle>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(280px, 100%), 1fr))", gap: `0 ${space[4]}px`, maxWidth: 640 }}>
              <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]}>
                <DatePicker.RangePicker format="D MMM YYYY" style={{ width: "100%" }} />
              </Form.Item>
              <Form.Item name="shiftId" label="Shift" rules={[{ required: true, message: "Choose a shift" }]}>
                <Select placeholder="Choose a shift" options={shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code}: ${s.name} ${s.startTime}–${s.endTime}` }))} />
              </Form.Item>
            </div>
            <Form.Item name="note" label="Why? (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. covering the late counter" }]}>
              <Input.TextArea rows={2} maxLength={500} showCount style={{ maxWidth: 640 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={previewMutation.isPending} block={phone}>
              Preview what will change
            </Button>
          </Form>
        </Panel>

        {d && (
          <Panel title="What will change" subtitle={d.count > 0 ? "Check the days, then confirm below." : undefined}>
            <Stack gap={space[4]}>
              {d.count === 0 ? (
                <ApprovalBanner tone="warning" title="Nothing in that selection can be changed." description="See why below." />
              ) : (
                <CardGrid min={180} gap={space[4]}>
                  <StatCard variant="compact" label="Employee-days" value={d.count} />
                  <StatCard variant="compact" label="People" value={d.employees} />
                  <StatCard variant="compact" label="Shift" value={<span style={{ fontSize: fs.lg }}>{d.shift}</span>} />
                </CardGrid>
              )}
              {d.ownLeftOut > 0 && <ApprovalBanner tone="info" title={`${d.ownLeftOut} of your own days are left out.`} description="Nobody changes their own shift. Another HR admin does that." />}
              <LeftOutList title="Not changed, and why" groups={d.cannotOverride.map((g) => ({ ...g, examples: g.examples.map((e) => `${e.name} ${dayjs(e.date).format("D MMM")}`) }))} />
              {d.count > 0 && (
                <>
                  <DataTable<PreviewRow>
                    rowKey={(r) => `${r.employeeId}|${r.date}`}
                    density="compact"
                    dataSource={d.rows}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    columns={[
                      { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                      { title: "Day", dataIndex: "date", render: (x: string) => dayjs(x).format("ddd, D MMM") },
                      { title: "Shift now", dataIndex: "shiftBefore", render: (x: string | null) => x ?? "—" },
                      { title: "Day now", dataIndex: "statusBefore", render: (x: string | null) => x ?? "—" },
                      { title: "Day after", dataIndex: "statusAfter", render: (x: string | null) => afterCell(x) },
                    ]}
                    mobile={{
                      title: (r) => r.name,
                      subtitle: (r) => `${r.employeeCode} · ${dayjs(r.date).format("ddd, D MMM")}`,
                      fields: [
                        { label: "Shift now", render: (r) => r.shiftBefore ?? "—" },
                        { label: "Day now", render: (r) => r.statusBefore ?? "—" },
                        { label: "Day after", render: (r) => afterCell(r.statusAfter) },
                      ],
                    }}
                  />
                  <ConfirmBar
                    checked={looked}
                    onChecked={setLooked}
                    label={<>I have looked at these {d.count} employee-days and want their shift set.</>}
                    action={<>Set shift for {d.count} employee-day{d.count === 1 ? "" : "s"}</>}
                    loading={confirm.isPending}
                    onConfirm={() => confirm.mutate()}
                  />
                </>
              )}
            </Stack>
          </Panel>
        )}

        <Panel title="Shift overrides made" subtitle={data ? `${data.total} on record, newest first` : undefined}>
          <FilterBar
            activeCount={employeeId ? 1 : 0}
            onClear={() => {
              setEmployeeId(undefined);
              setPage(1);
            }}
            filters={
              <Select
                allowClear
                showSearch={{ filterOption: false, onSearch: setSearch }}
                placeholder="Filter by employee"
                aria-label="Filter by employee"
                style={{ width: phone ? "100%" : 300 }}
                value={employeeId}
                onChange={(x) => {
                  setEmployeeId(x);
                  setPage(1);
                }}
                options={(people?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
              />
            }
          />
          <DataTable<Entry>
            rowKey="id"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.entries ?? []}
            empty={<EmptyState compact title={employeeId ? "No shift overrides for this person" : "No shift has been overridden yet."} description={employeeId ? "Clear the filter to see everyone's." : "Overrides you set above appear here."} />}
            pagination={{ current: page, pageSize: 15, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
            columns={[
              { title: "Employee", key: "e", render: (_, r) => `${r.employeeName} (${r.employeeCode})` },
              { title: "Day", dataIndex: "date", render: (x: string) => dayjs(x).format("ddd, D MMM YYYY") },
              { title: "Shift", dataIndex: "shift" },
              { title: "Why", dataIndex: "reason", render: (x: string) => x || <span style={{ color: v.textSecondary }}>—</span> },
              { title: "By", dataIndex: "by" },
              { title: "When", dataIndex: "at", render: (x: string) => dayjs(x).format("D MMM YYYY, HH:mm") },
              { title: "", key: "actions", render: (_, r) => stateCell(r) },
            ]}
            mobile={{
              title: (r) => r.employeeName,
              subtitle: (r) => `${r.employeeCode} · ${dayjs(r.date).format("ddd, D MMM YYYY")}`,
              status: (r) => (r.inForce ? <StatusChip tone="success">In force</StatusChip> : null),
              fields: [
                { label: "Shift", render: (r) => r.shift },
                { label: "Why", render: (r) => r.reason || "—" },
                { label: "By", render: (r) => r.by },
                { label: "When", render: (r) => dayjs(r.at).format("D MMM YYYY, HH:mm") },
              ],
              actions: stateCell,
            }}
          />
        </Panel>
      </Stack>

      <ConfirmModal
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        title={removing ? `Remove the shift override: ${removing.employeeName}, ${dayjs(removing.date).format("D MMM")}` : ""}
        description="The day goes back to the person's usual shift."
        confirmLabel="Remove"
        danger
        loading={clear.isPending}
        onConfirm={() => noteForm.submit()}
      >
        <Form form={noteForm} layout="vertical" requiredMark={false} onFinish={(val) => clear.mutate(val.note.trim())}>
          <Form.Item name="note" label="Why? (kept on record)" rules={[{ required: true, min: 5, message: "A few words" }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </ConfirmModal>
    </>
  );
}

function afterCell(x: string | null) {
  return x ? <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{x}</span> : <span style={{ color: v.textSecondary }}>worked out when the day comes</span>;
}
