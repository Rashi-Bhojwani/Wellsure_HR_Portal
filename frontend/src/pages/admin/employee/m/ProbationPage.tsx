import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Segmented } from "antd";
import { CheckOutlined, FieldTimeOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import * as api from "../../../../api/probation";
import { apiErrorMessage } from "../../../../lib/apiError";
import { formatDate } from "../../../../lib/dates";
import { fs, fw, space, v } from "../../../../theme/tokens";
import { DataTable, EmptyState, PageHeader, Panel, SideDrawer, StatusChip, toast, useIsPhone } from "../../../../ui";

// M session block 2, ER-26: people whose probation ends soon (or has passed), to confirm or extend. The length and the reminder window are a policy
// setting (System Settings → Policy settings; default 3 months, reminded 15 days before).
type Acting = { row: api.ProbationRow; kind: "confirm" | "extend" };

export function ProbationPage() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [show, setShow] = useState<"due" | "all">("due");
  const [acting, setActing] = useState<Acting | null>(null);
  const [form] = Form.useForm<{ reason: string; until?: dayjs.Dayjs }>();
  const q = useQuery({ queryKey: ["probation", show], queryFn: () => api.listProbation(show) });
  const act = useMutation({
    mutationFn: (vals: { reason: string; until?: dayjs.Dayjs }) => (acting!.kind === "confirm" ? api.confirmProbation(acting!.row.employeeId, vals.reason) : api.extendProbation(acting!.row.employeeId, vals.until!.format("YYYY-MM-DD"), vals.reason)),
    onSuccess: () => { toast.success(acting?.kind === "confirm" ? "Confirmed. The employee is told." : "Extended. The employee is told."); setActing(null); void queryClient.invalidateQueries({ queryKey: ["probation"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")),
  });
  const open = (row: api.ProbationRow, kind: Acting["kind"]) => { form.resetFields(); setActing({ row, kind }); };
  const actions = (r: api.ProbationRow) => (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
      <Button icon={<FieldTimeOutlined />} onClick={() => open(r, "extend")} block={phone} aria-label={`Extend ${r.fullName}'s probation`}>Extend</Button>
      <Button type="primary" icon={<CheckOutlined />} onClick={() => open(r, "confirm")} block={phone} aria-label={`Confirm ${r.fullName}`}>Confirm</Button>
    </div>
  );
  const status = (r: api.ProbationRow) => (r.overdue ? <StatusChip tone="danger">Past its end</StatusChip> : r.extended ? <StatusChip tone="warning">Extended</StatusChip> : <StatusChip tone="info">In probation</StatusChip>);

  return (
    <>
      <PageHeader title="Probation" subtitle={q.data ? `Probation lasts ${q.data.policy.months} month(s) from joining; HR and the manager are reminded ${q.data.policy.reminderDays} days before it ends.` : "Confirm or extend probation."} />
      <Panel
        title={show === "due" ? "Ending soon or past" : "Everyone in probation"}
        extra={<Segmented value={show} onChange={(val) => setShow(val as "due" | "all")} options={[{ value: "due", label: "Ending soon" }, { value: "all", label: "Everyone" }]} aria-label="Which people" />}
      >
        <DataTable<api.ProbationRow>
          rowKey="employeeId"
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          dataSource={q.data?.people ?? []}
          pagination={(q.data?.people.length ?? 0) > 20 ? { pageSize: 20 } : false}
          empty={<EmptyState compact title={show === "due" ? "Nobody's probation ends soon" : "Nobody is in probation"} description={null} />}
          columns={[
            { title: "Employee", key: "e", render: (_, r) => <span><span style={{ fontWeight: fw.semibold }}>{r.fullName}</span><span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{r.employeeCode}{r.department ? ` · ${r.department}` : ""}</span></span> },
            { title: "Joined", dataIndex: "dateOfJoining", render: (d: string) => formatDate(d) },
            { title: "Last day", dataIndex: "lastDay", render: (d: string) => formatDate(d) },
            { title: "Manager", dataIndex: "manager", render: (m: string | null) => m ?? "—" },
            { title: "Status", key: "s", render: (_, r) => status(r) },
            { title: "", key: "a", align: "right", render: (_, r) => actions(r) },
          ]}
          mobile={{ title: (r) => r.fullName, subtitle: (r) => r.employeeCode, status, fields: [{ label: "Last day", render: (r) => formatDate(r.lastDay) }, { label: "Manager", render: (r) => r.manager ?? "—" }], actions }}
        />
      </Panel>
      <SideDrawer open={!!acting} title={acting?.kind === "confirm" ? "Confirm after probation" : "Extend probation"} subtitle={acting ? `${acting.row.fullName} · last day ${formatDate(acting.row.lastDay)}` : undefined} onClose={() => setActing(null)} formId="probation-form" primaryLabel={acting?.kind === "confirm" ? "Confirm" : "Extend"} primaryLoading={act.isPending}>
        <Form id="probation-form" form={form} layout="vertical" requiredMark={false} onFinish={(vals) => act.mutate(vals)}>
          {acting?.kind === "extend" && (
            <Form.Item name="until" label="New last day" rules={[{ required: true, message: "Choose the new last day" }]}>
              <DatePicker style={{ width: "100%" }} disabledDate={(d) => !!acting && d.format("YYYY-MM-DD") <= acting.row.lastDay} />
            </Form.Item>
          )}
          <Form.Item name="reason" label={acting?.kind === "confirm" ? "Note (the employee sees it)" : "Reason (the employee sees it)"} rules={[{ required: true, min: 3, message: "A few words" }]}>
            <Input.TextArea rows={3} maxLength={300} />
          </Form.Item>
        </Form>
      </SideDrawer>
    </>
  );
}
