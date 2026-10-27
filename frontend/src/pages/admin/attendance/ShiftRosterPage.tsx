import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, InputNumber, Radio, Segmented, Select, Tooltip } from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import * as adminApi from "../../../api/attendanceAdmin";
import type { RosterBody, RosterPreview } from "../../../api/attendanceAdmin";
import * as attendanceApi from "../../../api/attendance";
import { TargetPicker } from "../../../components/attendance/TargetPicker";
import { selectionOf, type TargetValues } from "../../../components/attendance/targetSelection";
import { apiErrorMessage } from "../../../lib/apiError";
import { ApprovalBanner, CardGrid, DataTable, FormGroupTitle, PageHeader, Panel, Stack, StatCard, toast, useIsPhone } from "../../../ui";
import { fs, radius, space, v } from "../../../theme/tokens";
import { ConfirmBar, LeftOutList } from "./previewParts";
import { RosterGrid } from "./RosterGrid";

interface Values extends TargetValues {
  start?: dayjs.Dayjs;
  mode: "ONE" | "ROTATION";
  shiftId?: string;
  steps?: Array<{ shiftId?: string; days?: number }>;
  until?: dayjs.Dayjs;
  then: "RETURN" | "STAY";
  note?: string;
}

type PreviewRow = RosterPreview["rows"][number];
const segmentsText = (segs: Array<{ from: string; shift: string }>) => segs.map((s) => `${dayjs(s.from).format("D MMM")} ${s.shift}`);

// Workforce → Attendance → Shift Roster (Phase 3 commit 2): assign a shift to many people from a future date, or generate a
// rotation (for example one week early, one week late, repeating). It writes the same dated assignment changes as
// Attendance Settings, so it only looks forward: from tomorrow, up to the scheduling limit. Today and earlier days are
// corrected with Shift Override.
export function ShiftRosterPage() {
  const [form] = Form.useForm<Values>();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [preview, setPreview] = useState<{ data: RosterPreview; body: RosterBody } | null>(null);
  const [looked, setLooked] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  const mode = Form.useWatch("mode", form) ?? "ONE";
  const { data: shifts = [] } = useQuery({ queryKey: ["attendance", "config", "shifts"], queryFn: attendanceApi.listShifts });
  const shiftOptions = shifts.filter((s) => s.isActive).map((s) => ({ value: s.id, label: `${s.code}: ${s.name} ${s.startTime}–${s.endTime}` }));
  const tomorrow = dayjs().add(1, "day");

  const previewMutation = useMutation({
    mutationFn: (body: RosterBody) => adminApi.previewRoster(body).then((data) => ({ data, body })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not preview this roster.")),
  });
  const confirm = useMutation({
    mutationFn: () => adminApi.confirmRoster(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      toast.success(`Roster written for ${r.people} ${r.people === 1 ? "person" : "people"} (${r.changes} shift change${r.changes === 1 ? "" : "s"}${r.replacedScheduled ? `, replacing ${r.replacedScheduled} that were scheduled` : ""}).`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setPreview(null);
      form.resetFields();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not write this roster."));
      setPreview(null);
      setLooked(false);
    },
  });

  const d = preview?.data;
  const wide = { width: "100%", maxWidth: 420 };
  return (
    <>
      <PageHeader title="Shift Roster" subtitle="Give many people a shift from a future date, or a rotation that repeats" />
      <Stack>
        <Panel title="Build a roster" subtitle="Preview first; nothing is written until you confirm.">
          <Form
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ who: "GROUP", mode: "ONE", then: "RETURN", steps: [{ days: 7 }, { days: 7 }] }}
            onValuesChange={() => {
              setPreview(null);
              setLooked(false);
            }}
            onFinish={(val) => {
              const sel = selectionOf(val);
              if (!sel.selection) return void toast.error(sel.error);
              const rotation = val.mode === "ROTATION";
              const steps = rotation ? (val.steps ?? []).map((s) => ({ shiftId: s.shiftId!, days: s.days! })) : [{ shiftId: val.shiftId!, days: 1 }];
              if (rotation && steps.length < 2) return void toast.error("A rotation needs at least two steps.");
              previewMutation.mutate({ selection: sel.selection, start: val.start!.format("YYYY-MM-DD"), steps, repeat: rotation, until: rotation ? val.until?.format("YYYY-MM-DD") : null, then: val.then, note: (val.note ?? "").trim() });
            }}
          >
            <ApprovalBanner
              tone="info"
              title="Looks forward only"
              description="A roster starts tomorrow at the earliest; writing one again for the same dates replaces what was scheduled from the start date. People who have left, and you, are left out."
              style={{ marginBottom: space[5] }}
            />
            <FormGroupTitle>Who</FormGroupTitle>
            <TargetPicker />

            <FormGroupTitle>When and what</FormGroupTitle>
            <Form.Item name="start" label="Starting" rules={[{ required: true, message: "Choose the first day" }]}>
              <DatePicker format="D MMM YYYY" disabledDate={(x) => x.isBefore(tomorrow, "day")} style={{ width: phone ? "100%" : 220 }} />
            </Form.Item>
            <Form.Item name="mode" label="What?">
              <Radio.Group
                optionType={phone ? "default" : "button"}
                style={phone ? { display: "flex", flexDirection: "column", gap: space[2] } : undefined}
                options={[
                  { value: "ONE", label: "One shift from that day" },
                  { value: "ROTATION", label: "A rotation that repeats" },
                ]}
              />
            </Form.Item>
            {mode === "ONE" ? (
              <Form.Item name="shiftId" label="Shift" rules={[{ required: true, message: "Choose a shift" }]}>
                <Select style={wide} placeholder="Choose a shift" options={shiftOptions} />
              </Form.Item>
            ) : (
              <>
                <Form.Item label="The pattern, in order (it repeats until the end date)" required>
                  <Form.List name="steps">
                    {(fields, { add, remove }) => (
                      <div style={{ display: "flex", flexDirection: "column", gap: space[2], maxWidth: 640 }}>
                        {fields.map((f, i) => (
                          <div
                            key={f.key}
                            role="group"
                            aria-label={`Step ${i + 1}`}
                            style={{
                              display: "grid",
                              gridTemplateColumns: phone ? "1fr auto" : "56px minmax(0, 1fr) 140px 40px",
                              gap: space[2],
                              alignItems: "start",
                              padding: space[3],
                              border: `1px solid ${v.borderDefault}`,
                              borderRadius: radius.md,
                              background: v.bgSubtle,
                            }}
                          >
                            <span style={{ color: v.textSecondary, fontSize: fs.table, paddingTop: space[2], gridColumn: phone ? "1 / -1" : undefined }}>Step {i + 1}</span>
                            <Form.Item name={[f.name, "shiftId"]} rules={[{ required: true, message: "Shift" }]} style={{ margin: 0, gridColumn: phone ? "1 / -1" : undefined }}>
                              <Select placeholder="Shift" options={shiftOptions} aria-label={`Step ${i + 1} shift`} />
                            </Form.Item>
                            <Form.Item name={[f.name, "days"]} rules={[{ required: true, message: "Days" }]} style={{ margin: 0 }}>
                              <InputNumber min={1} max={366} suffix="days" style={{ width: "100%" }} aria-label={`Step ${i + 1} days`} />
                            </Form.Item>
                            {fields.length > 2 ? (
                              <Tooltip title="Remove this step">
                                <Button aria-label={`Remove step ${i + 1}`} icon={<DeleteOutlined />} onClick={() => remove(f.name)} />
                              </Tooltip>
                            ) : (
                              <span />
                            )}
                          </div>
                        ))}
                        {fields.length < 14 && (
                          <div>
                            <Button icon={<PlusOutlined />} onClick={() => add({ days: 7 })}>
                              Add a step
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </Form.List>
                </Form.Item>
                <Form.Item name="until" label="Repeat until (last day, inclusive)" rules={[{ required: true, message: "Choose the last day" }]}>
                  <DatePicker format="D MMM YYYY" disabledDate={(x) => x.isBefore(tomorrow, "day")} style={{ width: phone ? "100%" : 220 }} />
                </Form.Item>
                <Form.Item name="then" label="After that">
                  <Radio.Group
                    style={phone ? { display: "flex", flexDirection: "column", gap: space[2] } : undefined}
                    options={[
                      { value: "RETURN", label: "Go back to the shift they had before" },
                      { value: "STAY", label: "Stay on the last shift" },
                    ]}
                  />
                </Form.Item>
              </>
            )}

            <FormGroupTitle>Why</FormGroupTitle>
            <Form.Item name="note" label="Why? (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. the October roster" }]}>
              <Input.TextArea rows={2} maxLength={500} showCount style={{ maxWidth: 640 }} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={previewMutation.isPending} block={phone}>
              Preview what will change
            </Button>
          </Form>
        </Panel>

        {d && (
          <Panel
            title="What will be written"
            subtitle={d.people > 0 ? "Check the roster, then confirm below." : undefined}
            extra={
              d.people > 0 && (
                <Segmented
                  value={view}
                  onChange={(x) => setView(x as "grid" | "list")}
                  options={[
                    { value: "grid", label: "Grid" },
                    { value: "list", label: "List" },
                  ]}
                  aria-label="Show the roster as"
                />
              )
            }
          >
            <Stack gap={space[4]}>
              {d.people === 0 ? (
                <ApprovalBanner tone="warning" title="Nobody in that selection can be rostered." description="See why below." />
              ) : (
                <CardGrid min={180} gap={space[4]}>
                  <StatCard variant="compact" label="People" value={d.people} />
                  <StatCard variant="compact" label="Shift changes written" value={d.changes} />
                  <StatCard variant="compact" label="From" value={dayjs(d.start).format("ddd D MMM YYYY")} />
                  <StatCard
                    variant="compact"
                    label="Until"
                    value={d.until ? dayjs(d.until).format("D MMM YYYY") : "No end"}
                    hint={d.until ? `Then ${d.then === "RETURN" ? "back to their previous shift" : "staying on the last shift"}` : "No end: the shift stays"}
                  />
                </CardGrid>
              )}
              {d.replacedScheduled > 0 && (
                <ApprovalBanner
                  tone="warning"
                  title={`${d.replacedScheduled} shift change${d.replacedScheduled === 1 ? "" : "s"} already scheduled from ${dayjs(d.start).format("D MMM")} will be replaced.`}
                  description="Listed against each person below. Changes scheduled before that date stay."
                />
              )}
              <LeftOutList title="Left out, and why" groups={d.cannotRoster.map((g) => ({ ...g, examples: g.examples.map((e) => e.name) }))} />
              {d.people > 0 && (
                <>
                  {view === "grid" ? (
                    <RosterGrid data={d} />
                  ) : (
                    <DataTable<PreviewRow>
                      rowKey="employeeId"
                      density="compact"
                      dataSource={d.rows}
                      pagination={{ pageSize: 8, showSizeChanger: false }}
                      columns={[
                        { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                        { title: "Shift now", dataIndex: "currentShift", render: (x: string | null) => x ?? "—" },
                        { title: "New shifts", key: "s", render: (_, r) => segmentsText(r.segments).join("  →  ") },
                        { title: "Replaces", key: "r", render: (_, r) => (r.replaces.length ? segmentsText(r.replaces).join(", ") : "—") },
                      ]}
                      mobile={{
                        title: (r) => r.name,
                        subtitle: (r) => r.employeeCode,
                        fields: [
                          { label: "Shift now", render: (r) => r.currentShift ?? "—" },
                          { label: "New shifts", render: (r) => segmentsText(r.segments).join(" → ") },
                          { label: "Replaces", render: (r) => (r.replaces.length ? segmentsText(r.replaces).join(", ") : "—") },
                        ],
                      }}
                    />
                  )}
                  {view === "grid" && d.rows.some((r) => r.replaces.length > 0) && (
                    <div style={{ color: v.textSecondary, fontSize: fs.sm }}>Switch to List to see which scheduled changes each person loses.</div>
                  )}
                  <ConfirmBar
                    checked={looked}
                    onChecked={setLooked}
                    label={<>I have looked at this roster for {d.people} {d.people === 1 ? "person" : "people"} and want it written.</>}
                    action="Write the roster"
                    loading={confirm.isPending}
                    onConfirm={() => confirm.mutate()}
                  />
                </>
              )}
            </Stack>
          </Panel>
        )}
      </Stack>
    </>
  );
}
