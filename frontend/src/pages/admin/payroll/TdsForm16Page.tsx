import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select, Upload } from "antd";
import { DownloadOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { saveBlob } from "../../../api/muster";
import { financialYearOf } from "@shared/utils/financialYear";
import * as taxApi from "../../../api/tax";
import type { ChallanView } from "../../../api/tax";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { ApprovalBanner, ConfirmModal, DataTable, PageHeader, Panel, SideDrawer, Stack, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > TDS and Form 16 (P7-7), directors only: the challan register (a different director confirms each by typing it again), the month-by-month
// reconciliation, and Form 16 Part B data (DRAFT until a different director confirms the year). No official file format is built; nothing talks to a portal.
function years(): string[] {
  const now = Number(financialYearOf(new Date().toISOString().slice(0, 10)).label.slice(0, 4));
  return [now - 2, now - 1, now].map((y) => `${y}-${String((y + 1) % 100).padStart(2, "0")}`);
}

export function TdsForm16Page() {
  const queryClient = useQueryClient();
  const [fy, setFy] = useState(years()[1]!);
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<ChallanView | null>(null);
  const [retype, setRetype] = useState({ amount: "", serial: "" });
  const [form] = Form.useForm<{ month: Dayjs; depositedOn: Dayjs; amount: string; bsrCode: string; serial: string }>();
  const reg = useQuery({ queryKey: ["challans", fy], queryFn: () => taxApi.challanRegister(fy) });
  const f16 = useQuery({ queryKey: ["form16", fy], queryFn: () => taxApi.form16Year(fy), retry: false });
  // ST-24: a director's copy of anyone's Form 16 Part B PDF (DRAFT until confirmed); every download is recorded.
  const downloadPdf = async (employeeId: string, code: string) => {
    try {
      saveBlob(await taxApi.form16PdfFor(fy, employeeId), `form16-part-b-${fy}-${code}.pdf`);
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not make the PDF."));
    }
  };
  // ST-25: Part A uploads (the PDF the tax portal issued; nothing is read from it).
  const partA = useQuery({ queryKey: ["form16", "part-a", fy], queryFn: () => taxApi.form16PartAList(fy), retry: false, enabled: !!f16.data });
  const hasPartA = new Set((partA.data?.files ?? []).map((x) => x.employeeId));
  const uploadPartA = async (employeeId: string, file: File) => {
    try {
      await taxApi.uploadForm16PartA(fy, employeeId, file);
      toast.success("Part A uploaded.");
      void queryClient.invalidateQueries({ queryKey: ["form16", "part-a", fy] });
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not upload Part A."));
    }
  };
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["challans"] }).then(() => queryClient.invalidateQueries({ queryKey: ["form16"] }));
  const fail = (what: string) => (err: unknown) => toast.error(apiErrorMessage(err, what));
  const enter = useMutation({ mutationFn: (v: { month: Dayjs; depositedOn: Dayjs; amount: string; bsrCode: string; serial: string }) => taxApi.enterChallan({ fy, month: v.month.format("YYYY-MM"), depositedOn: v.depositedOn.format("YYYY-MM-DD"), amount: v.amount, bsrCode: v.bsrCode, serial: v.serial }), onSuccess: () => { toast.success("Entered. A different director confirms it."); setAdding(false); form.resetFields(); refresh(); }, onError: fail("Could not enter it.") });
  const confirm = useMutation({ mutationFn: () => taxApi.confirmChallan(confirming!.id, retype), onSuccess: () => { toast.success("Confirmed."); setConfirming(null); setRetype({ amount: "", serial: "" }); refresh(); }, onError: fail("Could not confirm it.") });
  const ask = useMutation({ mutationFn: () => taxApi.askForm16(fy, f16.data!.fingerprint), onSuccess: () => { toast.success("Sent to the other director."); refresh(); }, onError: fail("Could not ask.") });
  const decide = useMutation({ mutationFn: (d: "APPROVE" | "REJECT") => taxApi.decideForm16(fy, f16.data!.fingerprint, d), onSuccess: () => { toast.success("Decided."); refresh(); }, onError: fail("Could not decide.") });
  return (
    <>
      <PageHeader title="TDS and Form 16" subtitle="Deposits, the monthly reconciliation and Form 16 data. Nothing here is sent anywhere." actions={<Select aria-label="Financial year" value={fy} onChange={setFy} options={years().map((y) => ({ value: y, label: y }))} style={{ minWidth: 120 }} />} />
      <Stack>
        <Panel title="Challans" subtitle="Each deposit the company made. A different director confirms it by typing the amount and serial again." extra={<Button icon={<PlusOutlined />} onClick={() => setAdding(true)}>Enter a challan</Button>}>
          <DataTable<ChallanView>
            rowKey="id"
            loading={reg.isLoading}
            error={reg.error}
            dataSource={reg.data?.challans ?? []}
            empty="No challans for this year."
            pagination={false}
            columns={[
              { title: "Month", dataIndex: "month" },
              { title: "Deposited", dataIndex: "depositedOn", render: (x: string) => dayjs(x).format("D MMM YYYY") },
              { title: "Amount", dataIndex: "amount", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "BSR", dataIndex: "bsr" },
              { title: "Serial", dataIndex: "serial" },
              { title: "State", key: "s", render: (_, c) => <StatusChip tone={c.confirmed ? "success" : "info"}>{c.confirmed ? "Confirmed" : "Waiting"}</StatusChip> },
              { title: "", key: "a", render: (_, c) => (!c.confirmed && !c.enteredByMe ? <Button onClick={() => setConfirming(c)}>Confirm</Button> : null) },
            ]}
          />
        </Panel>
        <Panel title="Deducted and deposited, month by month" subtitle="Deducted: finished payroll runs. Deposited: confirmed challans.">
          <DataTable<{ month: string; deducted: string; deposited: string; difference: string }>
            rowKey="month"
            density="compact"
            loading={reg.isLoading}
            dataSource={reg.data?.reconciliation ?? []}
            pagination={false}
            columns={[
              { title: "Month", dataIndex: "month" },
              { title: "Deducted", dataIndex: "deducted", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Deposited", dataIndex: "deposited", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Difference", dataIndex: "difference", align: "right", render: (x: string) => formatRupees(x, 2) },
            ]}
          />
        </Panel>
        <Panel title="Form 16 Part B data" subtitle="Made after the year ends. DRAFT until a different director confirms the year; Part A comes from the tax department's portal.">
          {f16.error ? (
            <ApprovalBanner tone="info" title="Not yet" description={apiErrorMessage(f16.error, "Form 16 data is made after the year ends.")} />
          ) : (
            <>
              {f16.data && (
                <ApprovalBanner
                  tone={f16.data.state === "CONFIRMED" ? "success" : "warning"}
                  title={f16.data.state === "CONFIRMED" ? "Confirmed by a different director" : f16.data.state === "WAITING" ? (f16.data.waitingMine ? "Waiting for the other director" : "Waiting for your decision") : "DRAFT"}
                  description="A person's Form 16 also stays a draft while the year's tax values are not confirmed."
                  actions={
                    f16.data.state === "DRAFT" ? <Button loading={ask.isPending} onClick={() => ask.mutate()}>Ask the other director to confirm</Button> : f16.data.state === "WAITING" && !f16.data.waitingMine ? (
                      <div style={{ display: "flex", gap: space[2] }}>
                        <Button type="primary" loading={decide.isPending} onClick={() => decide.mutate("APPROVE")}>Confirm</Button>
                        <Button danger loading={decide.isPending} onClick={() => decide.mutate("REJECT")}>Reject</Button>
                      </div>
                    ) : undefined
                  }
                  style={{ marginBottom: space[3] }}
                />
              )}
              <DataTable<taxApi.Form16Row>
                rowKey={(r) => r.employeeCode}
                loading={f16.isLoading}
                dataSource={f16.data?.rows ?? []}
                empty="Nobody was paid in a finished run this year."
                pagination={{ pageSize: 25 }}
                columns={[
                  { title: "Employee", key: "e", render: (_, r) => `${r.name ?? ""} (${r.employeeCode})` },
                  { title: "Regime", dataIndex: "regime", render: (x: string | null) => x ?? "Not chosen" },
                  { title: "Taxable pay", dataIndex: "taxablePay", align: "right", render: (x: string) => formatRupees(x, 2) },
                  { title: "Tax for the year", key: "t", align: "right", render: (_, r) => (r.computation?.annualTax ? formatRupees(r.computation.annualTax, 2) : "—") },
                  { title: "TDS deducted", dataIndex: "tdsDeducted", align: "right", render: (x: string) => formatRupees(x, 2) },
                  {
                    title: "Part A",
                    key: "partA",
                    render: (_, r) =>
                      r.employeeId ? (
                        <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                          {hasPartA.has(r.employeeId) && (
                            <Button size="small" icon={<DownloadOutlined />} aria-label={`Part A for ${r.name ?? r.employeeCode}`} onClick={() => void taxApi.form16PartAFor(fy, r.employeeId!).then((b) => saveBlob(b, `form16-part-a-${fy}-${r.employeeCode}.pdf`), (e) => toast.error(apiErrorMessage(e, "Could not download.")))}>
                              Part A
                            </Button>
                          )}
                          <Upload accept="application/pdf,.pdf" showUploadList={false} beforeUpload={(file) => { void uploadPartA(r.employeeId!, file); return false; }}>
                            <Button size="small" icon={<UploadOutlined />} aria-label={`Upload Part A for ${r.name ?? r.employeeCode}`}>{hasPartA.has(r.employeeId) ? "Replace" : "Upload"}</Button>
                          </Upload>
                        </div>
                      ) : null,
                  },
                  {
                    title: "PDF",
                    key: "pdf",
                    render: (_, r) =>
                      r.employeeId ? (
                        <Button size="small" icon={<DownloadOutlined />} aria-label={`Form 16 PDF for ${r.name ?? r.employeeCode}`} onClick={() => void downloadPdf(r.employeeId!, r.employeeCode)}>
                          {f16.data?.state === "CONFIRMED" ? "PDF" : "Draft PDF"}
                        </Button>
                      ) : null,
                  },
                ]}
              />
            </>
          )}
        </Panel>
      </Stack>
      <SideDrawer open={adding} title="Enter a challan" subtitle="A different director confirms it." onClose={() => setAdding(false)} formId="challan-form" primaryLabel="Enter" primaryLoading={enter.isPending}>
        <Form id="challan-form" form={form} layout="vertical" requiredMark={false} onFinish={(v) => enter.mutate(v)}>
          <Form.Item name="month" label="Month it covers" rules={[{ required: true, message: "Choose the month" }]}><DatePicker picker="month" style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="depositedOn" label="Deposited on" rules={[{ required: true, message: "Choose the day" }]}><DatePicker format="D MMM YYYY" disabledDate={(x) => x.isAfter(dayjs(), "day")} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="amount" label="Amount (₹)" rules={[{ required: true, pattern: /^\d+(\.\d{1,2})?$/, message: "Digits, up to two decimals" }]}><Input inputMode="decimal" /></Form.Item>
          <Form.Item name="bsrCode" label="BSR code" rules={[{ required: true, pattern: /^\d{7}$/, message: "Seven digits" }]}><Input inputMode="numeric" /></Form.Item>
          <Form.Item name="serial" label="Challan serial" rules={[{ required: true, pattern: /^\d{1,10}$/, message: "Up to ten digits" }]}><Input inputMode="numeric" /></Form.Item>
        </Form>
      </SideDrawer>
      <ConfirmModal open={!!confirming} title="Confirm this challan" description="Type the amount and the serial from the challan itself." confirmLabel="Confirm" confirmDisabled={!retype.amount || !retype.serial} loading={confirm.isPending} onCancel={() => setConfirming(null)} onConfirm={() => confirm.mutate()}>
        <Input aria-label="Amount" inputMode="decimal" placeholder="Amount" value={retype.amount} onChange={(e) => setRetype((r) => ({ ...r, amount: e.target.value }))} style={{ marginTop: space[2] }} />
        <Input aria-label="Serial" inputMode="numeric" placeholder="Challan serial" value={retype.serial} onChange={(e) => setRetype((r) => ({ ...r, serial: e.target.value }))} style={{ marginTop: space[2] }} />
      </ConfirmModal>
    </>
  );
}
