import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Drawer, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { ClockCircleOutlined, EditOutlined, HistoryOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../../api/attendance";
import type { AssignmentChange, AssignmentListRow, AssignmentRow, Capture } from "../../../../api/attendance";
import * as orgApi from "../../../../api/org";
import { apiErrorMessage } from "../../../../lib/apiError";
import { EffectiveDateHint, HistoryStatusCell } from "../../../../lib/effectiveDate";

const { Text } = Typography;
const longDate = (iso: string) => dayjs(iso).format("D MMM YYYY");

export function CaptureTag({ capture }: { capture: Capture }) {
  return capture === "MANUAL" ? <Tag color="purple">Manual attendance</Tag> : <Tag>Biometric device</Tag>;
}

function useOptions() {
  const shifts = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const patterns = useQuery({ queryKey: ["attendance", "config", "week-offs"], queryFn: attendanceApi.listWeekOffPatterns });
  const policies = useQuery({ queryKey: ["attendance", "config", "policies"], queryFn: attendanceApi.listPolicies });
  const active = <T extends { id: string; code: string; name: string; isActive: boolean }>(rows: T[] | undefined) => (rows ?? []).filter((r) => r.isActive).map((r) => ({ value: r.id, label: `${r.code} — ${r.name}` }));
  return { shifts: active(shifts.data), patterns: active(patterns.data), policies: active(policies.data) };
}

/** The company default for new joiners (System Settings → Attendance). */
function DefaultsCard({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const options = useOptions();
  const { data } = useQuery({ queryKey: ["attendance", "config", "defaults"], queryFn: attendanceApi.getDefaults });
  const [editing, setEditing] = useState(false);
  const [form] = Form.useForm<{ shiftId: string; weekOffPatternId: string; policyId: string }>();
  const save = useMutation({
    mutationFn: attendanceApi.setDefaults,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      void message.success("Company default saved. It applies to people added from now on.");
      setEditing(false);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save the default.")),
  });
  return (
    <Card size="small" title="New joiners get" extra={canManage && !editing && <Button size="small" icon={<EditOutlined />} onClick={() => { form.setFieldsValue({ shiftId: data?.shift?.id, weekOffPatternId: data?.weekOffPattern?.id, policyId: data?.policy?.id }); setEditing(true); }}>Change</Button>}>
      {editing ? (
        <Form form={form} layout="inline" onFinish={(v) => save.mutate(v)}>
          <Form.Item name="shiftId" label="Shift" rules={[{ required: true }]}><Select style={{ width: 200 }} options={options.shifts} /></Form.Item>
          <Form.Item name="weekOffPatternId" label="Week-off" rules={[{ required: true }]}><Select style={{ width: 200 }} options={options.patterns} /></Form.Item>
          <Form.Item name="policyId" label="Policy" rules={[{ required: true }]}><Select style={{ width: 200 }} options={options.policies} /></Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={save.isPending}>Save</Button>
            <Button onClick={() => setEditing(false)}>Cancel</Button>
          </Space>
        </Form>
      ) : (
        <Text>
          {data?.shift?.name ?? "—"} · {data?.weekOffPattern?.name ?? "—"} · {data?.policy?.name ?? "—"}
        </Text>
      )}
    </Card>
  );
}

/** Change one person's (or many people's) shift, week-off or policy from a date — now or scheduled. */
function ChangeModal({ targets, open, onClose }: { targets: AssignmentListRow[]; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const options = useOptions();
  const [form] = Form.useForm<{ shiftId?: string; weekOffPatternId?: string; policyId?: string; effectiveFrom: Dayjs; changeReason?: string }>();
  const effectiveFrom = Form.useWatch("effectiveFrom", form);
  const save = useMutation({
    mutationFn: (v: { shiftId?: string; weekOffPatternId?: string; policyId?: string; effectiveFrom: Dayjs; changeReason?: string }) => {
      const body: AssignmentChange = { shiftId: v.shiftId, weekOffPatternId: v.weekOffPatternId, policyId: v.policyId, effectiveFrom: v.effectiveFrom.format("YYYY-MM-DD"), changeReason: v.changeReason || null };
      return targets.length === 1
        ? attendanceApi.changeAssignment(targets[0]!.employeeId, body).then(() => undefined)
        : attendanceApi.bulkChangeAssignment({ ...body, employeeIds: targets.map((t) => t.employeeId) }).then(() => undefined);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      void message.success(targets.length === 1 ? "Assignment saved." : `Saved for ${targets.length} people.`);
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this change.")),
  });
  return (
    <Modal
      title={targets.length === 1 ? `Change ${targets[0]!.fullName} (${targets[0]!.employeeCode})` : `Change ${targets.length} people`}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      afterOpenChange={(o) => o && form.setFieldsValue({ effectiveFrom: dayjs() })}
    >
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        onFinish={(v) => (v.shiftId || v.weekOffPatternId || v.policyId ? save.mutate(v) : void message.warning("Choose what to change."))}
      >
        <Text type="secondary" style={{ display: "block", marginBottom: 12 }}>
          Leave a field empty to keep what each person has.
        </Text>
        <Form.Item name="shiftId" label="Shift"><Select allowClear placeholder="Keep" options={options.shifts} /></Form.Item>
        <Form.Item name="weekOffPatternId" label="Week-off pattern"><Select allowClear placeholder="Keep" options={options.patterns} /></Form.Item>
        <Form.Item name="policyId" label="Policy"><Select allowClear placeholder="Keep" options={options.policies} /></Form.Item>
        <Form.Item name="effectiveFrom" label="Effective from" rules={[{ required: true }]} extra={<EffectiveDateHint value={effectiveFrom} />}>
          <DatePicker format="D MMM YYYY" allowClear={false} />
        </Form.Item>
        <Form.Item name="changeReason" label="Reason"><Input maxLength={500} /></Form.Item>
        {targets.length > 1 && <Alert type="info" showIcon style={{ marginBottom: 12 }} title="All or nothing: if any one person can't take this change, nobody is changed and you're told who and why." />}
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={save.isPending}>Save</Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

function HistoryDrawer({ row, onClose, canManage }: { row: AssignmentListRow | null; onClose: () => void; canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["attendance", "config", "assignment-history", row?.employeeId], queryFn: () => attendanceApi.assignmentHistory(row!.employeeId), enabled: !!row });
  const cancel = useMutation({
    mutationFn: (rowId: string) => attendanceApi.cancelAssignmentChange(row!.employeeId, rowId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      void message.success("Scheduled change cancelled.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not cancel this change.")),
  });
  return (
    <Drawer open={!!row} onClose={onClose} size={720} title={row ? `${row.fullName} (${row.employeeCode}) — assignment history` : ""}>
      <Table<AssignmentRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        size="small"
        columns={[
          { title: "From", dataIndex: "effectiveFrom", render: longDate },
          { title: "To", key: "to", render: (_, a) => <HistoryStatusCell status={a.status} effectiveFrom={a.effectiveFrom} effectiveTo={a.effectiveTo} /> },
          { title: "Shift", key: "shift", render: (_, a) => `${a.shift.code} (${a.shift.startTime}–${a.shift.endTime})` },
          { title: "Week-off", key: "wop", render: (_, a) => a.weekOffPattern.summary },
          { title: "Policy", key: "policy", render: (_, a) => a.policy.name },
          { title: "Reason", dataIndex: "changeReason", render: (v: string | null) => v ?? "—" },
          ...(canManage
            ? [{
                title: "",
                key: "cancel",
                render: (_: unknown, a: AssignmentRow) =>
                  a.status === "scheduled" && (
                    <Popconfirm title="Cancel this scheduled change?" onConfirm={() => cancel.mutate(a.id)}>
                      <Button size="small" danger>Cancel</Button>
                    </Popconfirm>
                  ),
              }]
            : []),
        ]}
      />
    </Drawer>
  );
}

export function AssignmentsTab({ canManage }: { canManage: boolean }) {
  const [filters, setFilters] = useState<{ search?: string; locationId?: string; capture?: Capture; shiftId?: string }>({});
  const { data = [], isLoading } = useQuery({ queryKey: ["attendance", "config", "assignments", filters], queryFn: () => attendanceApi.listAssignments(filters) });
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const options = useOptions();
  const [selected, setSelected] = useState<string[]>([]);
  const [changing, setChanging] = useState<AssignmentListRow[]>([]);
  const [history, setHistory] = useState<AssignmentListRow | null>(null);

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <DefaultsCard canManage={canManage} />
      <Space wrap>
        <Input.Search allowClear placeholder="Name or employee code" style={{ width: 240 }} onSearch={(v) => setFilters((f) => ({ ...f, search: v || undefined }))} />
        <Select allowClear placeholder="Branch" style={{ width: 200 }} options={locations.map((l) => ({ value: l.id, label: l.name }))} onChange={(v) => setFilters((f) => ({ ...f, locationId: v }))} />
        <Select allowClear placeholder="Shift" style={{ width: 200 }} options={options.shifts} onChange={(v) => setFilters((f) => ({ ...f, shiftId: v }))} />
        <Select allowClear placeholder="Attendance capture" style={{ width: 200 }} options={[{ value: "DEVICE", label: "Biometric device" }, { value: "MANUAL", label: "Manual attendance" }]} onChange={(v) => setFilters((f) => ({ ...f, capture: v }))} />
        {canManage && (
          <Button type="primary" disabled={selected.length === 0} onClick={() => setChanging(data.filter((r) => selected.includes(r.employeeId)))}>
            Change selected ({selected.length})
          </Button>
        )}
      </Space>
      <Table<AssignmentListRow>
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data}
        scroll={{ x: true }}
        pagination={{ pageSize: 50, showSizeChanger: false, showTotal: (t) => `${t} people` }}
        rowSelection={canManage ? { selectedRowKeys: selected, onChange: (keys) => setSelected(keys as string[]), preserveSelectedRowKeys: false } : undefined}
        columns={[
          { title: "Employee", key: "emp", render: (_, r) => <><Text strong>{r.fullName}</Text> <Text type="secondary">{r.employeeCode}</Text></> },
          { title: "Branch", dataIndex: "location", render: (v: string | null) => v ?? "—" },
          { title: "Capture", dataIndex: "capture", render: (v: Capture) => <CaptureTag capture={v} /> },
          { title: "Shift", key: "shift", render: (_, r) => (r.current ? `${r.current.shift.code} (${r.current.shift.startTime}–${r.current.shift.endTime})` : <Text type="warning">None</Text>) },
          { title: "Week-off", key: "wop", render: (_, r) => r.current?.weekOffPattern.summary ?? "—" },
          { title: "Policy", key: "policy", render: (_, r) => r.current?.policy.name ?? "—" },
          {
            title: "Scheduled",
            key: "scheduled",
            render: (_, r) => r.scheduled && <Tag color="gold" icon={<ClockCircleOutlined />}>From {longDate(r.scheduled.effectiveFrom)}</Tag>,
          },
          {
            title: "",
            key: "actions",
            render: (_, r) => (
              <Space>
                <Button size="small" icon={<HistoryOutlined />} onClick={() => setHistory(r)}>History</Button>
                {canManage && <Button size="small" icon={<EditOutlined />} onClick={() => setChanging([r])}>Change</Button>}
              </Space>
            ),
          },
        ]}
      />
      <ChangeModal targets={changing} open={changing.length > 0} onClose={() => { setChanging([]); setSelected([]); }} />
      <HistoryDrawer row={history} onClose={() => setHistory(null)} canManage={canManage} />
    </Space>
  );
}
