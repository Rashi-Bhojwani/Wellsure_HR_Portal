import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Space } from "antd";
import { MinusCircleOutlined, PlusOutlined } from "@ant-design/icons";
import * as api from "../../../api/settlements";
import type { SeparationRow, SettlementLine } from "../../../api/settlements";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, DataTable, PageHeader, SideDrawer, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";
import { WRAP_TEXT as WRAP } from "../../../ui/textStyles";
import { SettlementGuide } from "./SettlementGuide";

// Payroll > Settlements (P7-6), directors only: the full and final settlement of each leaver, with every line and where it comes from. One director prepares, a
// different director confirms; never one's own. Paying it is an off-cycle run (P7-6b, Payroll > Off-cycle runs); nothing is paid from here.
export function SettlementsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState<SeparationRow | null>(null);
  const [form] = Form.useForm<{ lines: Array<{ label: string; amount: string; source: string }> }>();
  const q = useQuery({ queryKey: ["settlements"], queryFn: api.listSettlements });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["settlements"] });
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const prepare = useMutation({ mutationFn: (v: { lines?: Array<{ label: string; amount: string; source: string }> }) => api.prepareSettlement({ separationId: open!.separationId, directorLines: v.lines ?? [] }), onSuccess: () => { toast.success("Prepared."); setOpen(null); form.resetFields(); refresh(); }, onError: fail("Could not prepare it.") });
  const ask = useMutation({ mutationFn: (r: SeparationRow) => api.askToConfirm(r.settlement!.id, r.settlement!.fingerprint), onSuccess: () => { toast.success("Sent to the other director."); refresh(); }, onError: fail("Could not ask.") });
  const decide = useMutation({ mutationFn: ({ r, d }: { r: SeparationRow; d: "APPROVE" | "REJECT" }) => api.decideSettlement(r.settlement!.id, r.settlement!.fingerprint, d), onSuccess: () => { toast.success("Decided."); refresh(); }, onError: fail("Could not decide.") });
  return (
    <>
      <PageHeader title="Settlements" subtitle="Full and final settlement for each leaver: every line with its source, confirmed by a different director." />
      <ApprovalBanner tone="info" title="Paying a settlement" description="A confirmed settlement with a positive total is paid by an off-cycle run (Payroll, Off-cycle runs). Nothing is paid from this screen." style={{ marginBottom: space[4] }} />
      <DataTable<SeparationRow>
        rowKey="separationId"
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        dataSource={q.data ?? []}
        empty="No leavers."
        pagination={{ pageSize: 20 }}
        expandable={{
          rowExpandable: (r) => !!r.settlement,
          expandedRowRender: (r) => (
            <DataTable<SettlementLine>
              rowKey={(l) => `${l.kind}-${l.source}-${l.label}`}
              density="compact"
              dataSource={r.settlement?.lines ?? []}
              pagination={false}
              columns={[
                { title: "Line", dataIndex: "label" },
                { title: "Amount", key: "a", align: "right", render: (_, l) => (l.amount === null ? `${l.days ?? ""} days (no amount)` : formatRupees(l.amount, 2)) },
                { title: "Source", dataIndex: "source", width: 280, render: (t: string) => <span style={WRAP}>{t}</span> },
              ]}
            />
          ),
        }}
        columns={[
          { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
          { title: "Last working day", dataIndex: "lastWorkingDate", render: (x: string) => dayjs(x).format("D MMM YYYY") },
          { title: "Total", key: "t", align: "right", render: (_, r) => (r.settlement ? (r.settlement.payable ? formatRupees(r.settlement.total, 2) : `Recover ${formatRupees(r.settlement.recoverOutsidePayroll ?? "0", 2)} outside payroll`) : "—") },
          { title: "State", key: "s", render: (_, r) => (r.settlement ? <StatusChip status={r.settlement.state} /> : <StatusChip tone="neutral">Not prepared</StatusChip>) },
          {
            title: "",
            key: "act",
            render: (_, r) => (
              <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                {r.settlement?.state !== "PAID" && <Button onClick={() => setOpen(r)}>{r.settlement ? "Prepare again" : "Prepare"}</Button>}
                {r.settlement?.state === "PREPARED" && <Button loading={ask.isPending} onClick={() => ask.mutate(r)}>Ask to confirm</Button>}
                {r.settlement?.state === "WAITING" && (
                  <>
                    <Button type="primary" loading={decide.isPending} onClick={() => decide.mutate({ r, d: "APPROVE" })}>Confirm</Button>
                    <Button danger loading={decide.isPending} onClick={() => decide.mutate({ r, d: "REJECT" })}>Reject</Button>
                  </>
                )}
              </div>
            ),
          },
        ]}
      />
      <SideDrawer open={!!open} title={`Settlement for ${open?.name ?? ""}`} subtitle="Automatic lines are read from their sources. Add the lines only you can give (notice pay or recovery, gratuity, final TDS, leave encashment), each with its source." onClose={() => setOpen(null)} formId="fnf-form" primaryLabel="Prepare" primaryLoading={prepare.isPending}>
        {open && <SettlementGuide separationId={open.separationId} />}
        <Form id="fnf-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => prepare.mutate(v)}>
          <Form.List name="lines">
            {(fields, { add, remove }) => (
              <>
                {fields.map((f) => (
                  <Space key={f.key} direction="vertical" style={{ width: "100%", marginBottom: space[3] }}>
                    <Form.Item name={[f.name, "label"]} rules={[{ required: true, min: 3, message: "What it is" }]} style={{ marginBottom: 0 }}>
                      <Input placeholder="What it is (e.g. Gratuity)" />
                    </Form.Item>
                    <Form.Item name={[f.name, "amount"]} rules={[{ required: true, pattern: /^-?\d+(\.\d{1,2})?$/, message: "A signed amount: negative is recovered" }]} style={{ marginBottom: 0 }}>
                      <Input inputMode="decimal" placeholder="Amount (₹); negative is recovered" />
                    </Form.Item>
                    <Form.Item name={[f.name, "source"]} rules={[{ required: true, min: 3, message: "Where it comes from" }]} style={{ marginBottom: 0 }}>
                      <Input placeholder="Where it comes from" />
                    </Form.Item>
                    <Button type="link" icon={<MinusCircleOutlined />} onClick={() => remove(f.name)}>Remove</Button>
                  </Space>
                ))}
                <Button icon={<PlusOutlined />} onClick={() => add()}>Add a line</Button>
              </>
            )}
          </Form.List>
        </Form>
      </SideDrawer>
    </>
  );
}
