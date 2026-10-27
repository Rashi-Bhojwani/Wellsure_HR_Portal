import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, InputNumber, Select, Tooltip } from "antd";
import { CheckOutlined, DeleteOutlined, EditOutlined, MoonOutlined, PlusOutlined } from "@ant-design/icons";
import { TIME_REGEX, sessionProblems, sessionTotals, type SessionInput } from "@shared/utils/attendance";
import * as attendanceApi from "../../../../api/attendance";
import type { ShiftInput, ShiftRow } from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ApprovalBanner, ConfirmModal, DataTable, EmptyState, FormGroupTitle, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";
import { fs, radius, space, v } from "../../../../theme/tokens";
import { ActiveTag, CodeName, FieldGrid, Hint, PlaceholderTag } from "./common";
import { hoursLabel } from "./format";

const timeRule = { pattern: TIME_REGEX, message: "HH:MM, 24-hour" };
const FORM_ID = "attendance-shift-form";

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

function ShiftDrawer({ editing, open, onClose }: { editing: ShiftRow | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<ShiftInput>();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const values = Form.useWatch([], form) as ShiftInput | undefined;
  const sessions = (values?.sessions ?? []).filter(Boolean) as SessionInput[];
  const problems = values?.startTime && values?.endTime ? sessionProblems(values.startTime, values.endTime, sessions) : [];
  const totals = problems.length === 0 && values?.startTime ? sessionTotals(values.startTime, sessions) : null;

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue(editing ?? NEW_SHIFT);
  }, [open, editing, form]);

  const save = useMutation({
    mutationFn: (val: ShiftInput) => {
      if (!editing) return attendanceApi.createShift(val);
      // Only what changed — so an untouched placeholder stays a placeholder.
      const changed = Object.fromEntries(Object.entries(val).filter(([k, x]) => k !== "code" && JSON.stringify(x) !== JSON.stringify(editing[k as keyof ShiftRow])));
      return attendanceApi.updateShift(editing.id, changed);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success(editing ? "Shift saved. Days already computed keep the old rule until you run Process Attendance for them." : "Shift created.");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this shift.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="wide"
      title={editing ? `Edit ${editing.code} — ${editing.name}` : "Add Shift"}
      subtitle={editing ? "Changes apply to days computed from now on." : "Hours, grace, punch window and the parts of the day."}
      formId={FORM_ID}
      primaryLabel="Save"
      primaryLoading={save.isPending}
      primaryDisabled={problems.length > 0}
    >
      <Form id={FORM_ID} form={form} layout="vertical" requiredMark={false} onFinish={(val) => save.mutate(val)}>
        <FormGroupTitle>Shift</FormGroupTitle>
        <FieldGrid min={140}>
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: "Letters, digits, - or _" }]}>
            <Input disabled={!!editing} placeholder="e.g. NIGHT" />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Night shift" />
          </Form.Item>
          <Form.Item name="startTime" label="Starts" rules={[{ required: true }, timeRule]}>
            <Input placeholder="10:00" inputMode="numeric" />
          </Form.Item>
          <Form.Item name="endTime" label="Ends" rules={[{ required: true }, timeRule]}>
            <Input placeholder="19:00" inputMode="numeric" />
          </Form.Item>
        </FieldGrid>

        <FormGroupTitle>Grace and punch window</FormGroupTitle>
        <FieldGrid min={200}>
          <Form.Item name="graceInMinutes" label={<>Grace in (min)<PlaceholderTag field="graceInMinutes" placeholders={editing?.placeholderFields ?? []} /></>}>
            <InputNumber min={0} max={240} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="graceOutMinutes" label={<>Grace out (min)<PlaceholderTag field="graceOutMinutes" placeholders={editing?.placeholderFields ?? []} /></>}>
            <InputNumber min={0} max={240} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="windowBeforeMinutes" label="Punch window opens (min before start)" tooltip="Punches earlier than this belong to the previous day's shift.">
            <InputNumber min={0} max={720} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="windowAfterMinutes" label="…and closes (min after end)">
            <InputNumber min={0} max={720} style={{ width: "100%" }} />
          </Form.Item>
        </FieldGrid>

        <FormGroupTitle>Sessions</FormGroupTitle>
        <Hint>
          The parts of the shift, in order: work sessions and the scheduled breaks between them. The first work session is the first half, the last is the
          second half. Our device sends no IN/OUT direction, so a scheduled break covered by someone's first-to-last punch span is deducted from their work time.
        </Hint>
        <Form.List name="sessions">
          {(fields, { add, remove }) => (
            <div style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
              {fields.map((f, i) => (
                <div
                  key={f.key}
                  role="group"
                  aria-label={`Part ${i + 1}`}
                  style={{
                    display: "grid",
                    gridTemplateColumns: phone ? "1fr 1fr" : "24px 110px minmax(120px, 1fr) 88px 88px auto",
                    gap: `0 ${space[2]}px`,
                    alignItems: "start",
                    padding: phone ? space[3] : 0,
                    border: phone ? `1px solid ${v.borderDefault}` : undefined,
                    borderRadius: radius.md,
                  }}
                >
                  {!phone && <span style={{ paddingTop: space[2], color: v.textSecondary, fontSize: fs.table }}>{i + 1}.</span>}
                  <Form.Item name={[f.name, "kind"]} rules={[{ required: true }]} label={phone ? `Part ${i + 1}` : undefined}>
                    <Select aria-label={`Part ${i + 1} kind`} options={[{ value: "WORK", label: "Work" }, { value: "BREAK", label: "Break" }]} />
                  </Form.Item>
                  <Form.Item name={[f.name, "label"]} rules={[{ required: true, message: "Name it" }]} label={phone ? "Name" : undefined}>
                    <Input aria-label={`Part ${i + 1} name`} placeholder="e.g. Lunch" />
                  </Form.Item>
                  <Form.Item name={[f.name, "startTime"]} rules={[{ required: true }, timeRule]} label={phone ? "From" : undefined}>
                    <Input aria-label={`Part ${i + 1} from`} placeholder="10:00" inputMode="numeric" />
                  </Form.Item>
                  <Form.Item name={[f.name, "endTime"]} rules={[{ required: true }, timeRule]} label={phone ? "To" : undefined}>
                    <Input aria-label={`Part ${i + 1} to`} placeholder="14:00" inputMode="numeric" />
                  </Form.Item>
                  <Tooltip title="Remove this part">
                    <Button
                      aria-label={`Remove part ${i + 1}`}
                      icon={<DeleteOutlined />}
                      disabled={fields.length === 1}
                      onClick={() => remove(f.name)}
                      block={phone}
                      style={phone ? { gridColumn: "1 / -1" } : undefined}
                    >
                      {phone ? "Remove part" : null}
                    </Button>
                  </Tooltip>
                </div>
              ))}
              <div>
                <Button
                  icon={<PlusOutlined />}
                  onClick={() => {
                    const last = sessions.at(-1);
                    add({ kind: last?.kind === "WORK" ? "BREAK" : "WORK", label: "", startTime: last?.endTime ?? "", endTime: values?.endTime ?? "" });
                  }}
                >
                  Add part
                </Button>
              </div>
            </div>
          )}
        </Form.List>
        <div style={{ marginTop: space[4] }} aria-live="polite">
          {problems.length > 0 ? (
            <ApprovalBanner
              tone="warning"
              title="Fix the session structure before saving"
              description={
                <ul style={{ margin: 0, paddingLeft: space[5] }}>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              }
            />
          ) : (
            totals && <ApprovalBanner tone="info" title={`Scheduled work ${hoursLabel(totals.workMinutes)}, scheduled breaks ${hoursLabel(totals.breakMinutes)}.`} />
          )}
        </div>
      </Form>
    </SideDrawer>
  );
}

function SessionsCell({ s }: { s: ShiftRow }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: fs.table }}>
      {s.sessions.map((x) => (
        <span key={`${x.startTime}-${x.label}`} style={{ color: x.kind === "BREAK" ? v.textSecondary : v.textBody }}>
          {x.startTime}–{x.endTime} {x.label}
          {x.kind === "BREAK" ? " (break)" : ""}
        </span>
      ))}
      <span style={{ color: v.textSecondary, fontSize: fs.sm }}>
        Work {hoursLabel(s.workMinutes)} · breaks {hoursLabel(s.breakMinutes)}
      </span>
    </div>
  );
}

function HoursCell({ s }: { s: ShiftRow }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", flexWrap: "wrap", gap: space[2] }}>
      <span style={{ whiteSpace: "nowrap" }}>
        {s.startTime}–{s.endTime}
      </span>
      {s.crossesMidnight && (
        <StatusChip tone="purple" icon={<MoonOutlined />}>
          Crosses midnight
        </StatusChip>
      )}
    </span>
  );
}

function GraceCell({ s }: { s: ShiftRow }) {
  return (
    <span>
      {s.graceInMinutes} / {s.graceOutMinutes} min
      {s.placeholderFields.length > 0 && <PlaceholderTag field={s.placeholderFields[0]!} placeholders={s.placeholderFields} />}
    </span>
  );
}

export function ShiftsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const [editing, setEditing] = useState<ShiftRow | null>(null);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<ShiftRow | null>(null);
  const patch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Parameters<typeof attendanceApi.updateShift>[1] }) => attendanceApi.updateShift(id, body),
    onSuccess: (_r, vars) => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      if (vars.body.confirmPlaceholders) {
        toast.success("Values confirmed.");
        setConfirming(null);
      } else toast.success(vars.body.isActive ? "Shift reactivated." : "Shift deactivated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update this shift.")),
  });
  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (s: ShiftRow) => {
    setEditing(s);
    setOpen(true);
  };
  const busy = (s: ShiftRow) => patch.isPending && patch.variables?.id === s.id && patch.variables.body.isActive !== undefined;

  const actions = (s: ShiftRow) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
      <Button size={phone ? "middle" : "small"} icon={<EditOutlined />} onClick={() => openEdit(s)}>
        Edit
      </Button>
      {s.placeholderFields.length > 0 && (
        <Button size={phone ? "middle" : "small"} icon={<CheckOutlined />} onClick={() => setConfirming(s)}>
          Confirm values
        </Button>
      )}
      <Button size={phone ? "middle" : "small"} loading={busy(s)} onClick={() => patch.mutate({ id: s.id, body: { isActive: !s.isActive } })}>
        {s.isActive ? "Deactivate" : "Reactivate"}
      </Button>
    </div>
  );

  return (
    <>
      <Panel
        title="Shifts"
        subtitle="Working hours, grace and the parts of each day"
        extra={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
              Add Shift
            </Button>
          )
        }
      >
        <DataTable<ShiftRow>
          rowKey="id"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={false}
          onRowOpen={canManage ? openEdit : undefined}
          empty={
            <EmptyState
              compact
              title="No shifts yet"
              description={canManage ? "Add the company's first shift to start computing attendance." : "HR hasn't set up any shifts yet."}
              action={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Add Shift</Button>}
            />
          }
          columns={[
            { title: "Shift", key: "shift", render: (_, s) => <CodeName code={s.code} name={s.name} /> },
            { title: "Hours", key: "hours", render: (_, s) => <HoursCell s={s} /> },
            { title: "Sessions", key: "sessions", render: (_, s) => <SessionsCell s={s} /> },
            { title: "Grace in / out", key: "grace", render: (_, s) => <GraceCell s={s} /> },
            { title: "People", dataIndex: "employeeCount", align: "right" },
            { title: "Status", key: "status", render: (_, s) => <ActiveTag isActive={s.isActive} isDefault={s.isDefault} /> },
            ...(canManage ? [{ title: "", key: "actions", render: (_: unknown, s: ShiftRow) => actions(s) }] : []),
          ]}
          mobile={{
            title: (s) => s.name,
            subtitle: (s) => s.code,
            status: (s) => <ActiveTag isActive={s.isActive} isDefault={s.isDefault} />,
            fields: [
              { label: "Hours", render: (s) => <HoursCell s={s} /> },
              { label: "People", render: (s) => s.employeeCount },
              { label: "Grace in / out", render: (s) => <GraceCell s={s} /> },
              { label: "Sessions", render: (s) => <SessionsCell s={s} /> },
            ],
            actions: canManage ? actions : undefined,
          }}
        />
      </Panel>
      <ShiftDrawer editing={editing} open={open} onClose={() => setOpen(false)} />
      <ConfirmModal
        open={!!confirming}
        onCancel={() => setConfirming(null)}
        title="Confirm grace as it is?"
        description={confirming ? `Grace in ${confirming.graceInMinutes} min, out ${confirming.graceOutMinutes} min — only if HR has confirmed these values.` : undefined}
        confirmLabel="Confirm values"
        loading={patch.isPending}
        onConfirm={() => confirming && patch.mutate({ id: confirming.id, body: { confirmPlaceholders: confirming.placeholderFields } })}
      />
    </>
  );
}
