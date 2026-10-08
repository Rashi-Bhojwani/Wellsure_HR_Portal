import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from "antd";
import { CheckOutlined, DeleteOutlined, EditOutlined, MoonOutlined, PlusOutlined } from "@ant-design/icons";
import { TIME_REGEX, sessionProblems, sessionTotals, type SessionInput } from "@shared/utils/attendance";
import * as attendanceApi from "../../../../api/attendance";
import type { ShiftInput, ShiftRow } from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ActiveTag, PlaceholderTag } from "./common";
import { hoursLabel } from "./format";

const { Text } = Typography;
const timeRule = { pattern: TIME_REGEX, message: "HH:MM, 24-hour" };

const NEW_SHIFT: ShiftInput = {
  code: "",
  name: "",
  startTime: "10:00",
  endTime: "19:00",
  graceInMinutes: 0,
  graceOutMinutes: 0,
  windowBeforeMinutes: 240,
  windowAfterMinutes: 360,
  sessions: [{ kind: "WORK", label: "Full day", startTime: "10:00", endTime: "19:00" }],
};

function ShiftModal({ editing, open, onClose }: { editing: ShiftRow | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<ShiftInput>();
  const queryClient = useQueryClient();
  const values = Form.useWatch([], form) as ShiftInput | undefined;
  const sessions = (values?.sessions ?? []).filter(Boolean) as SessionInput[];
  const problems = values?.startTime && values?.endTime ? sessionProblems(values.startTime, values.endTime, sessions) : [];
  const totals = problems.length === 0 && values?.startTime ? sessionTotals(values.startTime, sessions) : null;

  const save = useMutation({
    mutationFn: (v: ShiftInput) => {
      if (!editing) return attendanceApi.createShift(v);
      // Only what changed — so an untouched placeholder stays a placeholder.
      const changed = Object.fromEntries(Object.entries(v).filter(([k, val]) => k !== "code" && JSON.stringify(val) !== JSON.stringify(editing[k as keyof ShiftRow])));
      return attendanceApi.updateShift(editing.id, changed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      void message.success(editing ? "Shift saved. Days already computed keep the old rule until you run Process Attendance for them." : "Shift created.");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this shift.")),
  });

  return (
    <Modal
      title={editing ? `Edit ${editing.code} — ${editing.name}` : "Add Shift"}
      open={open}
      onCancel={onClose}
      footer={null}
      width={760}
      destroyOnHidden
      afterOpenChange={(o) => o && form.setFieldsValue(editing ?? NEW_SHIFT)}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => save.mutate(v)}>
        <Space size={12} style={{ width: "100%" }} align="start">
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: "Letters, digits, - or _" }]}>
            <Input disabled={!!editing} style={{ width: 110 }} placeholder="e.g. NIGHT" />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]} style={{ flex: 1, minWidth: 200 }}>
            <Input />
          </Form.Item>
          <Form.Item name="startTime" label="Starts" rules={[{ required: true }, timeRule]}>
            <Input style={{ width: 90 }} placeholder="10:00" />
          </Form.Item>
          <Form.Item name="endTime" label="Ends" rules={[{ required: true }, timeRule]}>
            <Input style={{ width: 90 }} placeholder="19:00" />
          </Form.Item>
        </Space>
        <Space size={12} wrap>
          <Form.Item name="graceInMinutes" label={<>Grace in (min)<PlaceholderTag field="graceInMinutes" placeholders={editing?.placeholderFields ?? []} /></>}>
            <InputNumber min={0} max={240} />
          </Form.Item>
          <Form.Item name="graceOutMinutes" label={<>Grace out (min)<PlaceholderTag field="graceOutMinutes" placeholders={editing?.placeholderFields ?? []} /></>}>
            <InputNumber min={0} max={240} />
          </Form.Item>
          <Form.Item name="windowBeforeMinutes" label="Punch window opens (min before start)" tooltip="Punches earlier than this belong to the previous day's shift.">
            <InputNumber min={0} max={720} />
          </Form.Item>
          <Form.Item name="windowAfterMinutes" label="…and closes (min after end)">
            <InputNumber min={0} max={720} />
          </Form.Item>
        </Space>

        <Typography.Title level={5} style={{ marginTop: 0 }}>
          Sessions
        </Typography.Title>
        <Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
          The parts of the shift, in order: work sessions and the scheduled breaks between them. The first work session is the first half, the last is the
          second half. Our device sends no IN/OUT direction, so a scheduled break covered by someone's first-to-last punch span is deducted from their work time.
        </Text>
        <Form.List name="sessions">
          {(fields, { add, remove }) => (
            <>
              {fields.map((f, i) => (
                <Space key={f.key} align="start" size={8} style={{ display: "flex" }}>
                  <Text style={{ width: 20, paddingTop: 5 }}>{i + 1}.</Text>
                  <Form.Item name={[f.name, "kind"]} rules={[{ required: true }]}>
                    <Select style={{ width: 110 }} options={[{ value: "WORK", label: "Work" }, { value: "BREAK", label: "Break" }]} />
                  </Form.Item>
                  <Form.Item name={[f.name, "label"]} rules={[{ required: true, message: "Name it" }]}>
                    <Input placeholder="e.g. Lunch" style={{ width: 180 }} />
                  </Form.Item>
                  <Form.Item name={[f.name, "startTime"]} rules={[{ required: true }, timeRule]}>
                    <Input style={{ width: 80 }} placeholder="10:00" />
                  </Form.Item>
                  <Text style={{ paddingTop: 5 }}>to</Text>
                  <Form.Item name={[f.name, "endTime"]} rules={[{ required: true }, timeRule]}>
                    <Input style={{ width: 80 }} placeholder="14:00" />
                  </Form.Item>
                  <Button aria-label={`Remove part ${i + 1}`} icon={<DeleteOutlined />} disabled={fields.length === 1} onClick={() => remove(f.name)} />
                </Space>
              ))}
              <Button
                icon={<PlusOutlined />}
                onClick={() => {
                  const last = sessions.at(-1);
                  add({ kind: last?.kind === "WORK" ? "BREAK" : "WORK", label: "", startTime: last?.endTime ?? "", endTime: values?.endTime ?? "" });
                }}
              >
                Add part
              </Button>
            </>
          )}
        </Form.List>
        <div style={{ margin: "12px 0" }}>
          {problems.length > 0 ? (
            <Alert type="warning" showIcon title="Fix the session structure before saving" description={<ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>} />
          ) : (
            totals && <Alert type="info" showIcon title={`Scheduled work ${hoursLabel(totals.workMinutes)}, scheduled breaks ${hoursLabel(totals.breakMinutes)}.`} />
          )}
        </div>
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={save.isPending} disabled={problems.length > 0}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function ShiftsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const [editing, setEditing] = useState<ShiftRow | null>(null);
  const [open, setOpen] = useState(false);
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof attendanceApi.updateShift>[1] }) => attendanceApi.updateShift(id, body),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] }),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not update this shift.")),
  });

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {canManage && (
        <Button
          type="primary"
          icon={<PlusOutlined />}
          style={{ alignSelf: "flex-end" }}
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          Add Shift
        </Button>
      )}
      <Table<ShiftRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          {
            title: "Hours",
            key: "hours",
            render: (_, s) => (
              <>
                {s.startTime}–{s.endTime} {s.crossesMidnight && <Tag icon={<MoonOutlined />}>Crosses midnight</Tag>}
              </>
            ),
          },
          {
            title: "Sessions",
            key: "sessions",
            render: (_, s) => (
              <Space orientation="vertical" size={0}>
                {s.sessions.map((x) => (
                  <Text key={`${x.startTime}-${x.label}`} type={x.kind === "BREAK" ? "secondary" : undefined}>
                    {x.startTime}–{x.endTime} {x.label}
                    {x.kind === "BREAK" ? " (break)" : ""}
                  </Text>
                ))}
                <Text type="secondary">
                  Work {hoursLabel(s.workMinutes)} · breaks {hoursLabel(s.breakMinutes)}
                </Text>
              </Space>
            ),
          },
          {
            title: "Grace in / out",
            key: "grace",
            render: (_, s) => (
              <>
                {s.graceInMinutes} / {s.graceOutMinutes} min
                {s.placeholderFields.length > 0 && <PlaceholderTag field={s.placeholderFields[0]!} placeholders={s.placeholderFields} />}
              </>
            ),
          },
          { title: "People", dataIndex: "employeeCount" },
          { title: "Status", key: "status", render: (_, s) => <ActiveTag isActive={s.isActive} isDefault={s.isDefault} /> },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, s: ShiftRow) => (
                    <Space wrap>
                      <Button
                        size="small"
                        icon={<EditOutlined />}
                        onClick={() => {
                          setEditing(s);
                          setOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      {s.placeholderFields.length > 0 && (
                        <Popconfirm
                          title="Confirm grace as it is?"
                          description={`Grace in ${s.graceInMinutes} min, out ${s.graceOutMinutes} min — only if HR has confirmed these values.`}
                          onConfirm={() => patch.mutate({ id: s.id, body: { confirmPlaceholders: s.placeholderFields } })}
                        >
                          <Button size="small" icon={<CheckOutlined />}>
                            Confirm values
                          </Button>
                        </Popconfirm>
                      )}
                      <Button size="small" onClick={() => patch.mutate({ id: s.id, body: { isActive: !s.isActive } })}>
                        {s.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <ShiftModal editing={editing} open={open} onClose={() => setOpen(false)} />
    </Space>
  );
}
