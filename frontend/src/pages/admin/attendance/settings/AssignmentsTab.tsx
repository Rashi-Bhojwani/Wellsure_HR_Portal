import { useEffect, useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, DatePicker, Form, Input, Select } from "antd";
import { ClockCircleOutlined, EditOutlined, HistoryOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import type { AssignmentChange, AssignmentListRow, AssignmentRow, Capture } from "../../../../api/attendance";
import * as orgApi from "../../../../api/org";
import { apiErrorMessage } from "../../../../lib/apiError";
import { EffectiveDateHint, HistoryStatusCell } from "../../../../lib/effectiveDate";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FilterBar, KeyValueGrid, Panel, SideDrawer, Skel, StatusChip, toast, useIsPhone } from "../../../../ui";
import { fs, fw, space, v } from "../../../../theme/tokens";
import { Hint } from "./common";

const longDate = (iso: string) => dayjs(iso).format("D MMM YYYY");
const DEFAULTS_FORM = "attendance-defaults-form";
const CHANGE_FORM = "attendance-assignment-form";

export function CaptureTag({ capture }: { capture: Capture }) {
  return capture === "MANUAL" ? <StatusChip tone="purple">Manual attendance</StatusChip> : <StatusChip tone="neutral">Biometric device</StatusChip>;
}

function useOptions() {
  const shifts = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const patterns = useQuery({ queryKey: ["attendance", "config", "week-offs"], queryFn: attendanceApi.listWeekOffPatterns });
  const policies = useQuery({ queryKey: ["attendance", "config", "policies"], queryFn: attendanceApi.listPolicies });
  const active = <T extends { id: string; code: string; name: string; isActive: boolean }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }));
  return { shifts: active(shifts.data), patterns: active(patterns.data), policies: active(policies.data) };
}

/** The company default for new joiners (System Settings → Attendance). */
function DefaultsPanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const options = useOptions();
  const { data, isLoading } = useQuery({ queryKey: ["attendance", "config", "defaults"], queryFn: attendanceApi.getDefaults });
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{ shiftId: string; weekOffPatternId: string; policyId: string }>();
  useEffect(() => {
    if (editing) form.setFieldsValue({ shiftId: data?.shift?.id, weekOffPatternId: data?.weekOffPattern?.id, policyId: data?.policy?.id });
  }, [editing, data, form]);
  const save = useMutation({
    mutationFn: attendanceApi.setDefaults,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success("Company default saved. It applies to people added from now on.");
      setEditing(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save the default.")),
  });
  return (
    <>
      <Panel
        title="New joiners get"
        subtitle="The shift, week-off pattern and policy given to people added from now on"
        extra={
          canManage && (
            <Button icon={<EditOutlined />} onClick={() => setEditing(true)}>
              Change
            </Button>
          )
        }
      >
        {isLoading ? (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(180px, 100%), 1fr))", gap: space[4] }}>
            {[0, 1, 2].map((i) => (
              <div key={i}>
                <Skel w={80} h={12} />
                <Skel w="70%" h={16} style={{ marginTop: space[2] }} />
              </div>
            ))}
          </div>
        ) : (
          <KeyValueGrid
            columns={3}
            items={[
              { key: "shift", label: "Shift", value: data?.shift?.name ?? "—" },
              { key: "wop", label: "Week-off pattern", value: data?.weekOffPattern?.name ?? "—" },
              { key: "policy", label: "Policy", value: data?.policy?.name ?? "—" },
            ]}
          />
        )}
      </Panel>
      <SideDrawer open={editing} onClose={() => setEditing(false)} title="New joiners get" subtitle="Applies to people added from now on. Nobody already here changes." formId={DEFAULTS_FORM} primaryLoading={save.isPending}>
        <Form id={DEFAULTS_FORM} form={form} layout="vertical" requiredMark={false} onFinish={(val) => save.mutate(val)}>
          <Form.Item name="shiftId" label="Shift" rules={[{ required: true }]}>
            <Select options={options.shifts} />
          </Form.Item>
          <Form.Item name="weekOffPatternId" label="Week-off pattern" rules={[{ required: true }]}>
            <Select options={options.patterns} />
          </Form.Item>
          <Form.Item name="policyId" label="Policy" rules={[{ required: true }]}>
            <Select options={options.policies} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}

type ChangeValues = { shiftId?: string; weekOffPatternId?: string; policyId?: string; effectiveFrom: Dayjs; changeReason?: string };

/** Change one person's (or many people's) shift, week-off or policy from a date — now or scheduled. */
function ChangeDrawer({ targets, open, onClose }: { targets: AssignmentListRow[]; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const options = useOptions();
  const [form] = Form.useForm<ChangeValues>();
  const effectiveFrom = Form.useWatch("effectiveFrom", form);
  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ effectiveFrom: dayjs() });
  }, [open, form]);
  const save = useMutation({
    mutationFn: (val: ChangeValues) => {
      const body: AssignmentChange = { shiftId: val.shiftId, weekOffPatternId: val.weekOffPatternId, policyId: val.policyId, effectiveFrom: val.effectiveFrom.format("YYYY-MM-DD"), changeReason: val.changeReason || null };
      return targets.length === 1
        ? attendanceApi.changeAssignment(targets[0]!.employeeId, body).then(() => undefined)
        : attendanceApi.bulkChangeAssignment({ ...body, employeeIds: targets.map((t) => t.employeeId) }).then(() => undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success(targets.length === 1 ? "Assignment saved." : `Saved for ${targets.length} people.`);
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this change.")),
  });
  const title = targets.length === 1 ? `Change ${targets[0]!.fullName} (${targets[0]!.employeeCode})` : `Change ${targets.length} people`;
  return (
    <SideDrawer open={open} onClose={onClose} title={title} subtitle="Leave a field empty to keep what each person has." formId={CHANGE_FORM} primaryLabel="Save" primaryLoading={save.isPending}>
      <Form
        id={CHANGE_FORM}
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(val) => (val.shiftId || val.weekOffPatternId || val.policyId ? save.mutate(val) : toast.warning("Choose what to change."))}
      >
        <Form.Item name="shiftId" label="Shift">
          <Select allowClear placeholder="Keep" options={options.shifts} />
        </Form.Item>
        <Form.Item name="weekOffPatternId" label="Week-off pattern">
          <Select allowClear placeholder="Keep" options={options.patterns} />
        </Form.Item>
        <Form.Item name="policyId" label="Policy">
          <Select allowClear placeholder="Keep" options={options.policies} />
        </Form.Item>
        <Form.Item name="effectiveFrom" label="Effective from" rules={[{ required: true }]} extra={<EffectiveDateHint value={effectiveFrom} />}>
          <DatePicker format="D MMM YYYY" allowClear={false} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item name="changeReason" label="Reason">
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        {targets.length > 1 && <ApprovalBanner tone="info" title="All or nothing: if any one person can't take this change, nobody is changed and you're told who and why." />}
      </Form>
    </SideDrawer>
  );
}

function HistoryDrawer({ row, onClose, canManage }: { row: AssignmentListRow | null; onClose: () => void; canManage: boolean }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [cancelling, setCancelling] = useState<AssignmentRow | null>(null);
  const { data = [], isLoading, error, refetch } = useQuery({
    queryKey: ["attendance", "config", "assignment-history", row?.employeeId],
    queryFn: () => attendanceApi.assignmentHistory(row!.employeeId),
    enabled: !!row,
  });
  const cancel = useMutation({
    mutationFn: (rowId: string) => attendanceApi.cancelAssignmentChange(row!.employeeId, rowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success("Scheduled change cancelled.");
      setCancelling(null);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not cancel this change.")),
  });
  const shiftLabel = (a: AssignmentRow) => `${a.shift.code} (${a.shift.startTime}–${a.shift.endTime})`;
  const cancelButton = (a: AssignmentRow) =>
    canManage && a.status === "scheduled" ? (
      <Button size={phone ? "middle" : "small"} danger onClick={() => setCancelling(a)}>
        Cancel
      </Button>
    ) : null;
  return (
    <>
      <SideDrawer open={!!row} onClose={onClose} size="wide" title={row ? `${row.fullName} (${row.employeeCode})` : ""} subtitle="Assignment history" footer={null}>
        <DataTable<AssignmentRow>
          rowKey="id"
          density="compact"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={false}
          empty={<EmptyState compact title="No assignments yet" description="This person has no shift, week-off or policy on record." />}
          columns={[
            { title: "From", dataIndex: "effectiveFrom", render: longDate },
            { title: "To", key: "to", render: (_, a) => <HistoryStatusCell status={a.status} effectiveFrom={a.effectiveFrom} effectiveTo={a.effectiveTo} /> },
            { title: "Shift", key: "shift", render: (_, a) => shiftLabel(a) },
            { title: "Week-off", key: "wop", render: (_, a) => a.weekOffPattern.summary },
            { title: "Policy", key: "policy", render: (_, a) => a.policy.name },
            { title: "Reason", dataIndex: "changeReason", render: (x: string | null) => x ?? "—" },
            ...(canManage ? [{ title: "", key: "actions", render: (_: unknown, a: AssignmentRow) => cancelButton(a) }] : []),
          ]}
          mobile={{
            title: (a) => `From ${longDate(a.effectiveFrom)}`,
            subtitle: (a) => <HistoryStatusCell status={a.status} effectiveFrom={a.effectiveFrom} effectiveTo={a.effectiveTo} />,
            fields: [
              { label: "Shift", render: shiftLabel },
              { label: "Week-off", render: (a) => a.weekOffPattern.summary },
              { label: "Policy", render: (a) => a.policy.name },
              { label: "Reason", render: (a) => a.changeReason ?? "—" },
            ],
            actions: canManage ? (a) => cancelButton(a) : undefined,
          }}
        />
      </SideDrawer>
      <ConfirmModal
        open={!!cancelling}
        onCancel={() => setCancelling(null)}
        title="Cancel this scheduled change?"
        description={cancelling ? `The change from ${longDate(cancelling.effectiveFrom)} won't happen; ${row?.fullName ?? "they"} keep${row ? "s" : ""} the current assignment.` : undefined}
        confirmLabel="Cancel change"
        cancelLabel="Keep it"
        danger
        loading={cancel.isPending}
        onConfirm={() => cancelling && cancel.mutate(cancelling.id)}
      />
    </>
  );
}

type Filters = { search?: string; locationId?: string; capture?: Capture; shiftId?: string };

export function AssignmentsTab({ canManage }: { canManage: boolean }) {
  const phone = useIsPhone();
  const [filters, setFilters] = useState<Filters>({});
  const { data = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["attendance", "config", "assignments", filters],
    queryFn: () => attendanceApi.listAssignments(filters),
    placeholderData: keepPreviousData,
  });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const options = useOptions();
  const [selected, setSelected] = useState<string[]>([]);
  const [changing, setChanging] = useState<AssignmentListRow[]>([]);
  const [history, setHistory] = useState<AssignmentListRow | null>(null);
  const activeCount = [filters.locationId, filters.shiftId, filters.capture].filter(Boolean).length;
  const size = phone ? "middle" : "small";

  const shiftCell = (r: AssignmentListRow) => (r.current ? `${r.current.shift.code} (${r.current.shift.startTime}–${r.current.shift.endTime})` : <StatusChip tone="warning">None</StatusChip>);
  const scheduledCell = (r: AssignmentListRow) =>
    r.scheduled ? (
      <StatusChip tone="warning" icon={<ClockCircleOutlined />}>
        From {longDate(r.scheduled.effectiveFrom)}
      </StatusChip>
    ) : null;
  const rowActions = (r: AssignmentListRow) => (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[2] }}>
      {phone && canManage && (
        <Checkbox
          checked={selected.includes(r.employeeId)}
          onChange={(e) => setSelected((s) => (e.target.checked ? [...s, r.employeeId] : s.filter((x) => x !== r.employeeId)))}
          style={{ minHeight: 44, alignItems: "center", marginRight: "auto" }}
        >
          Select
        </Checkbox>
      )}
      <Button size={size} icon={<HistoryOutlined />} onClick={() => setHistory(r)}>
        History
      </Button>
      {canManage && (
        <Button size={size} icon={<EditOutlined />} onClick={() => setChanging([r])}>
          Change
        </Button>
      )}
    </div>
  );

  return (
    <>
      <DefaultsPanel canManage={canManage} />
      <Panel title="Who works what" subtitle={!isLoading ? `${data.length} ${data.length === 1 ? "person" : "people"}` : undefined}>
        <Hint>Each person's shift, week-off pattern and policy today, and any change scheduled ahead. Select people to change several at once.</Hint>
        <FilterBar
          onSearch={(s) => setFilters((f) => ({ ...f, search: s || undefined }))}
          searchValue={filters.search ?? ""}
          searchPlaceholder="Name or employee code"
          activeCount={activeCount}
          onClear={() => setFilters((f) => ({ search: f.search }))}
          filters={
            <>
              <Select allowClear placeholder="Branch" aria-label="Branch" style={{ minWidth: 180 }} value={filters.locationId} options={locations.map((l) => ({ value: l.id, label: l.name }))} onChange={(x) => setFilters((f) => ({ ...f, locationId: x }))} />
              <Select allowClear placeholder="Shift" aria-label="Shift" style={{ minWidth: 180 }} value={filters.shiftId} options={options.shifts} onChange={(x) => setFilters((f) => ({ ...f, shiftId: x }))} />
              <Select
                allowClear
                placeholder="Attendance capture"
                aria-label="Attendance capture"
                style={{ minWidth: 180 }}
                value={filters.capture}
                options={[{ value: "DEVICE", label: "Biometric device" }, { value: "MANUAL", label: "Manual attendance" }]}
                onChange={(x) => setFilters((f) => ({ ...f, capture: x }))}
              />
            </>
          }
          actions={
            canManage && (
              <Button type="primary" disabled={selected.length === 0} onClick={() => setChanging(data.filter((r) => selected.includes(r.employeeId)))}>
                Change selected ({selected.length})
              </Button>
            )
          }
        />
        <DataTable<AssignmentListRow>
          rowKey="employeeId"
          loading={isFetching}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={{ pageSize: 50, showSizeChanger: false }}
          rowSelection={canManage ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]), preserveSelectedRowKeys: false } : undefined}
          empty={
            <EmptyState
              compact
              kind={filters.search || activeCount ? "no-results" : "empty"}
              title={filters.search || activeCount ? "Nobody matches these filters" : "No employees yet"}
              description={filters.search || activeCount ? "Try another name, or clear the filters." : "People appear here once they're added."}
            />
          }
          columns={[
            {
              title: "Employee",
              key: "emp",
              render: (_, r) => (
                <div>
                  <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{r.fullName}</div>
                  <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{r.employeeCode}</div>
                </div>
              ),
            },
            { title: "Branch", dataIndex: "location", render: (x: string | null) => x ?? "—" },
            { title: "Capture", dataIndex: "capture", render: (x: Capture) => <CaptureTag capture={x} /> },
            { title: "Shift", key: "shift", render: (_, r) => shiftCell(r) },
            { title: "Week-off", key: "wop", render: (_, r) => r.current?.weekOffPattern.summary ?? "—" },
            { title: "Policy", key: "policy", render: (_, r) => r.current?.policy.name ?? "—" },
            { title: "Scheduled", key: "scheduled", render: (_, r) => scheduledCell(r) },
            { title: "", key: "actions", render: (_, r) => rowActions(r) },
          ]}
          mobile={{
            selection: false, // renders its own select control on the card
            title: (r) => r.fullName,
            subtitle: (r) => `${r.employeeCode}${r.location ? ` · ${r.location}` : ""}`,
            status: (r) => <CaptureTag capture={r.capture} />,
            fields: [
              { label: "Shift", render: shiftCell },
              { label: "Week-off", render: (r) => r.current?.weekOffPattern.summary ?? "—" },
              { label: "Policy", render: (r) => r.current?.policy.name ?? "—" },
              { label: "Scheduled", render: (r) => scheduledCell(r) ?? "—" },
            ],
            actions: rowActions,
          }}
        />
      </Panel>
      <ChangeDrawer
        targets={changing}
        open={changing.length > 0}
        onClose={() => {
          setChanging([]);
          setSelected([]);
        }}
      />
      <HistoryDrawer row={history} onClose={() => setHistory(null)} canManage={canManage} />
    </>
  );
}
