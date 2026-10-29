import { useEffect, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Form, Input, Select } from "antd";
import { CalendarOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { WEEKDAY_NAMES, isWeekOff, weekOffRuleProblems, type WeekOffRule } from "@shared/utils/attendance";
import * as attendanceApi from "../../../../api/attendance";
import type { WeekOffPatternRow } from "../../../../api/attendance";
import { apiErrorMessage } from "../../../../lib/apiError";
import { ApprovalBanner, DataTable, EmptyState, FormGroupTitle, Panel, SideDrawer, toast, useIsPhone } from "../../../../ui";
import { fs, fw, radius, space, v } from "../../../../theme/tokens";
import { ActiveTag, CodeName, FieldGrid, Hint } from "./common";

const WEEK_OPTIONS = [1, 2, 3, 4, 5].map((w) => ({ value: w, label: ["1st", "2nd", "3rd", "4th", "5th"][w - 1] }));
const FORM_ID = "attendance-week-off-form";

// One row per weekday: off every week, off on chosen weeks of the month, or working.
type DayRule = { off: boolean; weeks: number[] };
const toForm = (rules: WeekOffRule[]): DayRule[] => WEEKDAY_NAMES.map((_, d) => {
  const r = rules.find((x) => x.weekday === d);
  return { off: !!r, weeks: r?.weeks ?? [] };
});
const fromForm = (days: DayRule[]): WeekOffRule[] => days.flatMap((d, weekday) => (d.off ? [d.weeks.length ? { weekday, weeks: d.weeks } : { weekday }] : []));

const cell = { padding: `${space[1]}px ${space[2]}px`, textAlign: "center" as const, border: `1px solid ${v.borderDefault}`, minWidth: 36 };

/** The next six weeks from this Monday, week-offs shaded — what the pattern actually does. */
export function WeekOffPreview({ rules }: { rules: WeekOffRule[] }) {
  const monday = dayjs().startOf("day").subtract((dayjs().day() + 6) % 7, "day");
  const weeks = Array.from({ length: 6 }, (_, w) => Array.from({ length: 7 }, (_, d) => monday.add(w * 7 + d, "day")));
  return (
    <div style={{ overflowX: "auto", maxWidth: "100%" }}>
      <table style={{ borderCollapse: "collapse", fontSize: fs.sm, borderRadius: radius.sm }} aria-label="Six-week preview">
        <thead>
          <tr>
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((h) => (
              <th key={h} scope="col" style={{ ...cell, background: v.bgTableHeader, color: v.textSecondary, fontWeight: fw.medium }}>
                {h}
              </th>
            ))}
          </tr>
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
                    style={{ ...cell, background: off ? v.attOBg : v.bgSurface, color: off ? v.attOFg : v.textBody, fontWeight: off ? fw.semibold : fw.regular }}
                  >
                    {off ? "OFF" : day.format("D")}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type FormValues = { code: string; name: string; days: DayRule[] };

function PatternDrawer({ editing, open, onClose }: { editing: WeekOffPatternRow | null; open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const days = (Form.useWatch("days", form) ?? []) as DayRule[];
  const rules = fromForm(days.length === 7 ? days : toForm([]));
  const problems = weekOffRuleProblems(rules);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    form.setFieldsValue({ code: editing?.code ?? "", name: editing?.name ?? "", days: toForm(editing?.rules ?? [{ weekday: 0 }]) });
  }, [open, editing, form]);

  const save = useMutation({
    mutationFn: (val: FormValues) =>
      editing ? attendanceApi.updateWeekOffPattern(editing.id, { name: val.name, rules: fromForm(val.days) }) : attendanceApi.createWeekOffPattern({ code: val.code, name: val.name, rules: fromForm(val.days) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success("Week-off pattern saved. Days already computed keep the old rule until you run Process Attendance for them.");
      onClose();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not save this pattern.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      size="wide"
      title={editing ? `Edit ${editing.name}` : "Add Week-off Pattern"}
      subtitle="Tick the days off; limit a day to chosen weeks of the month if it isn't off every week."
      formId={FORM_ID}
      primaryLabel="Save"
      primaryLoading={save.isPending}
      primaryDisabled={problems.length > 0}
    >
      <Form id={FORM_ID} form={form} layout="vertical" requiredMark={false} onFinish={(val) => save.mutate(val)}>
        <FieldGrid min={160}>
          <Form.Item name="code" label="Code" rules={[{ required: true }, { pattern: /^[A-Za-z0-9_-]+$/, message: "Letters, digits, - or _" }]}>
            <Input disabled={!!editing} />
          </Form.Item>
          <Form.Item name="name" label="Name" rules={[{ required: true }]}>
            <Input placeholder="e.g. Sunday + 2nd and 4th Saturday" />
          </Form.Item>
        </FieldGrid>
        <FormGroupTitle>Days off</FormGroupTitle>
        <div style={{ display: "flex", flexDirection: "column", gap: space[2], marginBottom: space[5] }}>
          {WEEKDAY_NAMES.map((name, d) => (
            <div
              key={name}
              style={{
                display: "grid",
                gridTemplateColumns: phone ? "1fr" : "140px minmax(0, 1fr)",
                gap: space[2],
                alignItems: "center",
                padding: `${space[2]}px ${space[3]}px`,
                border: `1px solid ${v.borderDefault}`,
                borderRadius: radius.md,
                background: days[d]?.off ? v.bgSubtle : v.bgSurface,
              }}
            >
              <Form.Item name={["days", d, "off"]} valuePropName="checked" noStyle>
                <Checkbox style={{ minHeight: phone ? 44 : undefined, alignItems: "center" }}>{name}</Checkbox>
              </Form.Item>
              <Form.Item name={["days", d, "weeks"]} noStyle>
                <Select mode="multiple" allowClear disabled={!days[d]?.off} placeholder="every week" options={WEEK_OPTIONS} aria-label={`${name}: which weeks of the month`} />
              </Form.Item>
            </div>
          ))}
        </div>
        <FormGroupTitle>Next six weeks</FormGroupTitle>
        <Hint>Shaded days are week-offs under this pattern.</Hint>
        <WeekOffPreview rules={rules} />
        {problems.length > 0 && <ApprovalBanner tone="warning" title={problems.join(" ")} style={{ marginTop: space[4] }} />}
      </Form>
    </SideDrawer>
  );
}

export function WeekOffsTab({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "config", "week-offs"], queryFn: attendanceApi.listWeekOffPatterns });
  const [editing, setEditing] = useState<WeekOffPatternRow | null>(null);
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<WeekOffPatternRow | null>(null);
  const toggle = useMutation({
    mutationFn: (p: WeekOffPatternRow) => attendanceApi.updateWeekOffPattern(p.id, { isActive: !p.isActive }),
    onSuccess: (_r, p) => {
      void queryClient.invalidateQueries({ queryKey: ["attendance", "config"] });
      toast.success(p.isActive ? "Pattern deactivated." : "Pattern reactivated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not update this pattern.")),
  });
  const openNew = () => {
    setEditing(null);
    setOpen(true);
  };
  const openEdit = (p: WeekOffPatternRow) => {
    setEditing(p);
    setOpen(true);
  };
  const size = phone ? "middle" : "small";
  const actions = (p: WeekOffPatternRow) => (
    <div style={{ display: "flex", flexWrap: "wrap", gap: space[2] }}>
      <Button size={size} icon={<CalendarOutlined />} onClick={() => setPreviewing(p)}>
        Preview
      </Button>
      {canManage && (
        <>
          <Button size={size} icon={<EditOutlined />} onClick={() => openEdit(p)}>
            Edit
          </Button>
          <Button size={size} loading={toggle.isPending && toggle.variables?.id === p.id} onClick={() => toggle.mutate(p)}>
            {p.isActive ? "Deactivate" : "Reactivate"}
          </Button>
        </>
      )}
    </div>
  );

  return (
    <>
      <Panel
        title="Week-off patterns"
        subtitle="Which days of the week are off, and on which weeks of the month"
        extra={
          canManage && (
            <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>
              Add Week-off Pattern
            </Button>
          )
        }
      >
        <DataTable<WeekOffPatternRow>
          rowKey="id"
          loading={isLoading}
          error={error}
          onRetry={() => void refetch()}
          dataSource={data}
          pagination={false}
          expandable={{ expandedRowRender: (p) => <WeekOffPreview rules={p.rules} />, expandRowByClick: false }}
          empty={
            <EmptyState
              compact
              title="No week-off patterns yet"
              description={canManage ? "Add one, such as Sunday off, to start computing attendance." : "HR hasn't set up any patterns yet."}
              action={canManage && <Button type="primary" icon={<PlusOutlined />} onClick={openNew}>Add Week-off Pattern</Button>}
            />
          }
          columns={[
            { title: "Pattern", key: "pattern", render: (_, p) => <CodeName code={p.code} name={p.name} /> },
            { title: "Week-offs", dataIndex: "summary" },
            { title: "People", dataIndex: "employeeCount", align: "right" },
            { title: "Status", key: "status", render: (_, p) => <ActiveTag isActive={p.isActive} isDefault={p.isDefault} /> },
            { title: "", key: "actions", render: (_: unknown, p: WeekOffPatternRow) => actions(p) },
          ]}
          mobile={{
            title: (p) => p.name,
            subtitle: (p) => p.code,
            status: (p) => <ActiveTag isActive={p.isActive} isDefault={p.isDefault} />,
            fields: [
              { label: "Week-offs", render: (p) => p.summary },
              { label: "People", render: (p) => p.employeeCount },
            ],
            actions,
          }}
        />
      </Panel>
      <PatternDrawer editing={editing} open={open} onClose={() => setOpen(false)} />
      <SideDrawer open={!!previewing} onClose={() => setPreviewing(null)} title={previewing?.name ?? ""} subtitle={previewing?.summary} footer={null}>
        <Hint>The next six weeks from this Monday. Shaded days are week-offs.</Hint>
        {previewing && <WeekOffPreview rules={previewing.rules} />}
      </SideDrawer>
    </>
  );
}
