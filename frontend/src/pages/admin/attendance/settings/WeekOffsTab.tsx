import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Form, Input, Modal, Select, Space, Table, Typography, message } from "antd";
import { EditOutlined, PlusOutlined } from "@ant-design/icons";
import { WEEKDAY_NAMES, isWeekOff, weekOffRuleProblems, type WeekOffRule } from "@shared/utils/attendance";
import * as attendanceApi from "../../../../api/attendance";
import type { WeekOffPatternRow } from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ActiveTag } from "./common";

const { Text } = Typography;
const WEEK_OPTIONS = [1, 2, 3, 4, 5].map((w) => ({ value: w, label: ["1st", "2nd", "3rd", "4th", "5th"][w - 1] }));

// One row per weekday: off every week, off on chosen weeks of the month, or working.
type DayRule = { off: boolean; weeks: number[] };
const toForm = (rules: WeekOffRule[]): DayRule[] => WEEKDAY_NAMES.map((_, d) => {
  const r = rules.find((x) => x.weekday === d);
  return { off: !!r, weeks: r?.weeks ?? [] };
});
const fromForm = (days: DayRule[]): WeekOffRule[] => days.flatMap((d, weekday) => (d.off ? [d.weeks.length ? { weekday, weeks: d.weeks } : { weekday }] : []));

/** The next six weeks from this Monday, week-offs shaded — what the pattern actually does. */
export function WeekOffPreview({ rules }: { rules: WeekOffRule[] }) {
  const monday = dayjs().startOf("day").subtract((dayjs().day() + 6) % 7, "day");
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => monday.add(w * 7 + d, "day")));
  return (
    <table style={{ borderCollapse: "collapse", fontSize: 12 }} aria-label="Six-week preview">
      <thead>
        <tr>{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((h) => <th key={h} style={{ padding: "2px 6px", fontWeight: 500 }}>{h}</th>)}</tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0]!.format("YYYY-MM-DD")}>
            {week.map((day) => {
              const off = isWeekOff(rules, new Date(`${day.format("YYYY-MM-DD")}T00:00:00Z`));
              return (
                <td
                  key={day.format("YYYY-MM-DD")}
                  title={`${day.format("ddd D MMM")}: ${off ? "week-off" : "working day"}`}
                  style={{ padding: "2px 6px", textAlign: "center", border: "1px solid var(--ant-color-border-secondary, #eee)", background: off ? "var(--ant-color-fill-secondary, #f0f0f0)" : undefined, color: off ? "var(--ant-color-text-tertiary, #999)" : undefined }}
                >
                  {off ? "OFF" : day.format("D")}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PatternModal({ editing, open, onClose }: { editing: WeekOffPatternRow | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<{ code: string; name: string; days: DayRule[] }>();
  const queryClient = useQueryClient();
  const days = (Form.useWatch("days", form) ?? []) as DayRule[];
  const rules = fromForm(days.length === 7 ? days : toForm([]));
  const problems = weekOffRuleProblems(rules);
  const save = useMutation({
    mutationFn: (v: { code: string; name: string; days: DayRule[] }) =>
      editing ? attendanceApi.updateWeekOffPattern(editing.id, { name: v.name, rules: fromForm(v.days) }) : attendanceApi.createWeekOffPattern({ code: v.code, name: v.name, rules: fromForm(v.days) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      void message.success("Week-off pattern saved. Days already computed keep the old rule until you run Process Attendance for them.");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this pattern.")),
  });
  return (
    <Modal
      title={editing ? `Edit ${editing.name}` : "Add Week-off Pattern"}
      open={open}
      onCancel={onClose}
      footer={null}
      width={680}
      destroyOnHidden
      afterOpenChange={(o) => o && form.setFieldsValue({ code: editing?.code ?? "", name: editing?.name ?? "", days: toForm(editing?.rules ?? [{ weekday: 0 }]) })}
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => save.mutate(v)}>
        <Space size={12} style={{ width: "100%" }}>
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: "Letters, digits, - or _" }]}>
            <Input disabled={!!editing} style={{ width: 120 }} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]} style={{ flex: 1 }}>
            <Input placeholder="e.g. Sunday + 2nd and 4th Saturday" />
          </Form.Item>
        </Space>
        <Space align="start" size={24} wrap>
          <div>
            {WEEKDAY_NAMES.map((name, d) => (
              <Space key={name} size={8} style={{ display: "flex", marginBottom: 6 }}>
                <Form.Item name={["days", d, "off"]} valuePropName="checked" noStyle>
                  <Checkbox style={{ width: 120 }}>{name}</Checkbox>
                </Form.Item>
                <Form.Item name={["days", d, "weeks"]} noStyle>
                  <Select mode="multiple" allowClear disabled={!days[d]?.off} placeholder="every week" options={WEEK_OPTIONS} style={{ width: 200 }} aria-label={`${name}: which weeks of the month`} />
                </Form.Item>
              </Space>
            ))}
          </div>
          <div>
            <Text type="secondary">Next six weeks</Text>
            <WeekOffPreview rules={rules} />
          </div>
        </Space>
        {problems.length > 0 && <Alert type="warning" showIcon style={{ marginTop: 12 }} title={problems.join(" ")} />}
        <Form.Item style={{ marginTop: 12, marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={save.isPending} disabled={problems.length > 0}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function WeekOffsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { data = [], isLoading } = useQuery({ queryKey: ["attendance", "config", "week-offs"], queryFn: attendanceApi.listWeekOffPatterns });
  const [editing, setEditing] = useState<WeekOffPatternRow | null>(null);
  const [open, setOpen] = useState(false);
  const toggle = useMutation({
    mutationFn: (p: WeekOffPatternRow) => attendanceApi.updateWeekOffPattern(p.id, { isActive: !p.isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] }),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not update this pattern.")),
  });
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {canManage && (
        <Button type="primary" icon={<PlusOutlined />} style={{ alignSelf: "flex-end" }} onClick={() => { setEditing(null); setOpen(true); }}>
          Add Week-off Pattern
        </Button>
      )}
      <Table<WeekOffPatternRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        expandable={{ expandedRowRender: (p) => <WeekOffPreview rules={p.rules} />, expandRowByClick: false }}
        columns={[
          { title: "Code", dataIndex: "code" },
          { title: "Name", dataIndex: "name" },
          { title: "Week-offs", dataIndex: "summary" },
          { title: "People", dataIndex: "employeeCount" },
          { title: "Status", key: "status", render: (_, p) => <ActiveTag isActive={p.isActive} isDefault={p.isDefault} /> },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, p: WeekOffPatternRow) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => { setEditing(p); setOpen(true); }}>
                        Edit
                      </Button>
                      <Button size="small" onClick={() => toggle.mutate(p)}>
                        {p.isActive ? "Deactivate" : "Reactivate"}
                      </Button>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />
      <PatternModal editing={editing} open={open} onClose={() => setOpen(false)} />
    </Space>
  );
}
