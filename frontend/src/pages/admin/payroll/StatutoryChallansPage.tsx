import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Segmented, Select } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import type { StatutoryChallanRegister, StatutoryKind } from "../../../api/tax";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, ConfirmModal, DataTable, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Statutory challans (ST-03 / ST-06; PT and LWF: ST-08, docs/plans/A_PARITY_ROWS.md), directors only. Each deposit is entered by one director (the challan reference sealed,
// shown by its last four) and confirmed by a different one typing the amount and reference again. Month by month: what finalised runs worked out on the statute's own
// lines against confirmed deposits — shown, never computed here. Nothing talks to the PF or ESI portals; no official file format.
function years(): string[] {
  const now = Number(financialYearOf(new Date().toISOString().slice(0, 10)).label.slice(0, 4));
  return [now - 2, now - 1, now].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}
type Challan = StatutoryChallanRegister["challans"][number];
type Month = StatutoryChallanRegister["months"][number];
interface EntryForm { month: Dayjs; depositedOn: Dayjs; amount: string; reference: string }

export function StatutoryChallansPage() {
  const queryClient = useQueryClient();
  const [fy, setFy] = useState(years()[2]!);
  const [kind, setKind] = useState<StatutoryKind>("PF");
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<Challan | null>(null);
  const [retype, setRetype] = useState({ amount: "", reference: "" });
  const [form] = Form.useForm<EntryForm>();
  const reg = useQuery({ queryKey: ["statutory-challans", fy, kind], queryFn: () => taxApi.statutoryChallans(fy, kind) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["statutory-challans"] });
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const enter = useMutation({
    mutationFn: (v: EntryForm) => taxApi.enterStatutoryChallan({ kind, month: v.month.format("YYYY-MM"), depositedOn: v.depositedOn.format("YYYY-MM-DD"), amount: v.amount, reference: v.reference }),
    onSuccess: () => { toast.success("Entered. A different director confirms it."); setAdding(false); form.resetFields(); refresh(); },
    onError: fail("Could not enter it."),
  });
  const confirm = useMutation({
    mutationFn: () => taxApi.confirmStatutoryChallan(confirming!.id, retype),
    onSuccess: () => { toast.success("Confirmed."); setConfirming(null); setRetype({ amount: "", reference: "" }); refresh(); },
    onError: fail("Could not confirm it."),
  });
  return (
    <>
      <PageHeader
        title="Statutory challans"
        subtitle="Deposits the company made, confirmed by a second director, against what finalised runs worked out. Nothing here is sent anywhere."
        actions={
          <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
            <Segmented<StatutoryKind> aria-label="Statute" value={kind} onChange={setKind} options={["PF", "ESI", "PT", "LWF"].map((k) => ({ value: k as StatutoryKind, label: k }))} />
            <Select aria-label="Financial year" value={fy} onChange={setFy} options={years().map((y) => ({ value: y, label: y }))} style={{ minWidth: 120 }} />
          </div>
        }
      />
      <Stack>
        <Panel title={`${kind} challans`} subtitle="A different director confirms each by typing the amount and the reference again." extra={<Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>Enter a challan</Button>}>
          <DataTable<Challan>
            rowKey="id"
            loading={reg.isLoading}
            error={reg.error}
            onRetry={() => void reg.refetch()}
            dataSource={reg.data?.challans ?? []}
            empty={`No ${kind} challans for this year.`}
            pagination={false}
            mobile={{ title: (c) => `${c.month} · ${formatRupees(c.amount, 2)}`, subtitle: (c) => `Reference ${c.reference} · deposited ${dayjs(c.depositedOn).format("D MMM YYYY")}`, fields: [{ label: "State", render: (c: Challan) => (c.confirmed ? "Confirmed" : "Waiting") }], actions: (c) => (!c.confirmed && !c.enteredByMe ? <Button onClick={() => setConfirming(c)}>Confirm</Button> : null) }}
            columns={[
              { title: "Month", dataIndex: "month" },
              { title: "Deposited", dataIndex: "depositedOn", render: (x: string) => dayjs(x).format("D MMM YYYY") },
              { title: "Amount", dataIndex: "amount", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Reference", dataIndex: "reference" },
              { title: "State", key: "s", render: (_, c) => <StatusChip tone={c.confirmed ? "success" : "info"}>{c.confirmed ? "Confirmed" : "Waiting"}</StatusChip> },
              { title: "", key: "a", render: (_, c) => (!c.confirmed && !c.enteredByMe ? <Button onClick={() => setConfirming(c)}>Confirm</Button> : !c.confirmed ? <span>Another director confirms</span> : null) },
            ]}
          />
        </Panel>
        <Panel title="Worked out and deposited, month by month" subtitle={reg.data?.note}>
          <DataTable<Month>
            rowKey="month"
            density="compact"
            loading={reg.isLoading}
            dataSource={reg.data?.months ?? []}
            pagination={false}
            columns={[
              { title: "Month", dataIndex: "month" },
              { title: "Employee share", dataIndex: "employee", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Employer share", dataIndex: "employer", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Worked out", dataIndex: "workedOut", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Deposited", dataIndex: "deposited", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Difference", dataIndex: "difference", align: "right", render: (x: string) => formatRupees(x, 2) },
            ]}
          />
        </Panel>
        <ApprovalBanner tone="info" title="Not a portal filing" description="The PF ECR, ESI, PT and LWF files are made from the run (Payroll, Run); the state PT return format is not built. This register only records deposits and compares them." />
      </Stack>
      <SideDrawer open={adding} title={`Enter a ${kind} challan`} subtitle="A different director confirms it." onClose={() => setAdding(false)} formId="stat-challan-form" primaryLabel="Enter" primaryLoading={enter.isPending}>
        <Form id="stat-challan-form" form={form} layout="vertical" requiredMark={false} onFinish={(val) => enter.mutate(val)}>
          <Form.Item name="month" label="Month it covers" rules={[{ required: true, message: "Choose the month" }]}><DatePicker picker="month" format="MMM YYYY" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="depositedOn" label="Deposited on" rules={[{ required: true, message: "Choose the day" }]}><DatePicker format="D MMM YYYY" disabledDate={(x) => x.isAfter(dayjs(), "day")} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="amount" label="Amount (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, up to two decimals" }]}><Input inputMode="decimal" /></Form.Item>
          <Form.Item name="reference" label={kind === "PF" ? "Challan reference (TRRN)" : "Challan or receipt number"} rules={[{ required: true, pattern: /^[A-Za-z0-9]{4,30}$/, message: "4 to 30 letters and digits" }]}><Input autoComplete="off" /></Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!confirming} title="Confirm this challan" description="Type the amount and the reference from the challan itself." confirmLabel="Confirm" confirmDisabled={!retype.amount || !retype.reference} loading={confirm.isPending} onCancel={() => setConfirming(null)} onConfirm={() => confirm.mutate()}>
        <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={retype.amount} onChange={(e) => setRetype((r) => ({ ...r, amount: e.target.value }))} style={{ marginTop: space[2] }} />
        <Input aria-label="Reference" autoComplete="off" placeholder="Challan reference" value={retype.reference} onChange={(e) => setRetype((r) => ({ ...r, reference: e.target.value }))} style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </>
  );
}

export default StatutoryChallansPage;
