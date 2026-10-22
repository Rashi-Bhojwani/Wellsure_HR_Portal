import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, DatePicker, Drawer, Flex, Input, Modal, Space, Spin, Table, Tag, Tooltip, Typography, Upload, message } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import * as payrollApi from "../../api/payroll";
import type { OutputKind, PayslipRow, RunDetail } from "../../api/payroll";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate, formatDateTime } from "../../lib/dates";
import { formatRupees } from "../../lib/money";
import { PayslipView } from "./PayslipView";

const { Text, Paragraph } = Typography;

// What a final run has produced, and what is left to do with it (docs/plans/PHASE_6.md §14H): the payslips and whether each person has really been told, the bank file and
// HR's own record of uploading it, and the statutory files and the register. Nothing here sends money; a failure is shown as a failure.

const stepLink = (runId: string, slug: "publish" | "bank-file") => `/admin/payroll/run/${runId}/step/${slug}`;

function open(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  a.click();
}

const EMAIL_TAG: Record<payrollApi.EmailStatus, { color: string; label: string }> = {
  SENT: { color: "green", label: "Email sent" },
  FILE_ONLY: { color: "orange", label: "Not emailed (development)" },
  FAILED: { color: "red", label: "Email failed" },
  PENDING: { color: "default", label: "Not yet" },
};

// ── Payslips ──

function PayslipsCard({ run }: { run: RunDetail }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const [viewing, setViewing] = useState<string | null>(null);
  const canView = hasPermission("payroll.payslip.view");
  const { data, isLoading } = useQuery({ queryKey: ["payroll", "payslips", run.id], queryFn: () => payrollApi.listRunPayslips(run.id), enabled: canView });
  const again = useMutation({
    mutationFn: () => payrollApi.preparePayslipsAgain(run.id),
    onSuccess: (r) => {
      void message[r.queued ? "success" : "error"](r.queued ? "Preparing again. Anything not yet done will be done; nothing is repeated." : "The background worker could not be reached. Try again in a moment.");
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["payroll", "payslips", run.id] }), 3000);
    },
    onError: (e) => void message.error(apiErrorMessage(e, "That did not work.")),
  });
  const slips = data?.payslips ?? [];
  const failed = slips.filter((s) => s.delivery.emailStatus === "FAILED").length;
  const noPdf = slips.filter((s) => !s.delivery.rendered).length;
  return (
    <Card size="small" title="Payslips" data-testid="payslips-card">
      <Flex vertical gap={10}>
        {isLoading && <Spin />}
        {canView && !isLoading && slips.length === 0 && (
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Text>Not published yet. Employees cannot see their payslips until they are.</Text>
            <Link to={stepLink(run.id, "publish")}>
              <Button size="small">Publish payslips…</Button>
            </Link>
          </Flex>
        )}
        {!canView && <Text type="secondary">You do not have permission to see payslips.</Text>}
        {slips.length > 0 && (
          <>
            <Text>
              {slips.length} published. {noPdf > 0 ? `${noPdf} PDF${noPdf === 1 ? " is" : "s are"} still being prepared. ` : "Every PDF is ready. "}
            </Text>
            {failed > 0 && <Alert type="error" showIcon title={`${failed} ${failed === 1 ? "person has" : "people have"} not been emailed`} description="They can still read their payslip in the app. The reason is shown against each name; Prepare again tries the ones that failed." />}
            <Table<PayslipRow>
              size="small"
              rowKey="id"
              scroll={{ x: "max-content" }}
              pagination={{ pageSize: 10, hideOnSinglePage: true }}
              dataSource={slips}
              columns={[
                { title: "Code", dataIndex: "employeeCode" },
                { title: "Name", dataIndex: "name" },
                { title: "Net pay", align: "right", render: (_, r) => formatRupees(r.net, 2) },
                { title: "PDF", render: (_, r) => (r.delivery.rendered ? <Tag color="green">Ready</Tag> : r.delivery.renderError ? <Tooltip title={r.delivery.renderError}><Tag color="red">Failed</Tag></Tooltip> : <Tag>Preparing</Tag>) },
                {
                  title: "Told",
                  render: (_, r) => (
                    <Space orientation="vertical" size={0}>
                      <Tag color={EMAIL_TAG[r.delivery.emailStatus].color}>{EMAIL_TAG[r.delivery.emailStatus].label}</Tag>
                      {r.delivery.emailTo && <Text type="secondary" style={{ fontSize: 12 }}>{r.delivery.emailTo}</Text>}
                      {r.delivery.emailError && <Text type="danger" style={{ fontSize: 12 }}>{r.delivery.emailError}</Text>}
                    </Space>
                  ),
                },
                { title: "", render: (_, r) => <Button size="small" onClick={() => setViewing(r.id)}>Read</Button> },
              ]}
            />
            {hasPermission("payroll.run") && (
              <Space>
                <Button loading={again.isPending} onClick={() => again.mutate()}>
                  Prepare again
                </Button>
              </Space>
            )}
          </>
        )}
      </Flex>
      <Drawer open={viewing !== null} onClose={() => setViewing(null)} size="large" title="Payslip" destroyOnHidden>
        {viewing && <OnePayslip id={viewing} />}
      </Drawer>
    </Card>
  );
}

function OnePayslip({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "payslip", id], queryFn: () => payrollApi.getPayslip(id) });
  if (isLoading) return <Spin />;
  if (error || !data) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load this payslip.")} />;
  return <PayslipView content={data.content} />;
}

// ── The bank file ──

function BankCard({ run }: { run: RunDetail }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canView = hasPermission("payroll.bank.view");
  const [paying, setPaying] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ["payroll", "bank-batch", run.id], queryFn: () => payrollApi.getBankBatchForRun(run.id), enabled: canView });
  const batch = data?.batch ?? null;
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll", "bank-batch", run.id] });
  const download = useMutation({
    mutationFn: () => payrollApi.bankBatchFileLink(batch!.id),
    onSuccess: (r) => open(r.url),
    onError: (e) => void message.error(apiErrorMessage(e, "Could not get the file.")),
  });
  const upload = useMutation({
    mutationFn: (file: File) => payrollApi.attachBatchResponse(batch!.id, file),
    onSuccess: () => {
      void message.success("The bank's response is stored. It is not read by this system.");
      refresh();
    },
    onError: (e) => void message.error(apiErrorMessage(e, "Could not store that file.")),
  });
  return (
    <Card size="small" title="Bank file" data-testid="bank-card">
      <Flex vertical gap={10}>
        {isLoading && <Spin />}
        {!canView && <Text type="secondary">You do not have permission to see bank files.</Text>}
        {canView && !isLoading && !batch && (
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Text>No bank file has been made. Nothing is ever sent to the bank from here: you download the file and upload it to net banking yourself.</Text>
            <Link to={stepLink(run.id, "bank-file")}>
              <Button size="small">Bank file…</Button>
            </Link>
          </Flex>
        )}
        {batch && (
          <>
            <Space wrap>
              <Tag color={batch.status === "PAID" ? "green" : "blue"}>{batch.status === "PAID" ? "Marked paid" : "File made, not yet marked paid"}</Tag>
              <Text>
                {batch.rowCount} {batch.rowCount === 1 ? "row" : "rows"}, {formatRupees(batch.total, 2)}, payment date {formatDate(batch.paymentDate)}
              </Text>
            </Space>
            {batch.excluded.length > 0 && <Alert type="warning" showIcon title={`${batch.excluded.length} payable ${batch.excluded.length === 1 ? "person is" : "people are"} not in this file`} description={<ul style={{ margin: 0, paddingLeft: 20 }}>{batch.excluded.map((e) => <li key={e.employeeId}>{e.name} ({e.employeeCode}): {e.detail}</li>)}</ul>} />}
            <Text type="secondary">
              {batch.fileName} · SHA-256 {batch.fileSha256.slice(0, 16)}… · made {formatDateTime(batch.generatedAt)}
            </Text>
            {batch.paid && (
              <Text>
                Recorded as paid by the bank on {batch.paid.on ? formatDate(batch.paid.on) : ""}, reference <Text strong>{batch.paid.reference}</Text>. This is HR’s own record; the system does not check it with the bank.
              </Text>
            )}
            {batch.response && <Text type="secondary">The bank’s response ({batch.response.fileName}) is stored, attached {batch.response.attachedAt ? formatDateTime(batch.response.attachedAt) : ""}. It has not been read.</Text>}
            <Space wrap>
              <Button icon={<DownloadOutlined />} loading={download.isPending} onClick={() => download.mutate()}>
                Download the file
              </Button>
              {batch.status === "GENERATED" && hasPermission("payroll.run") && <Button type="primary" onClick={() => setPaying(true)}>Record that it was paid…</Button>}
              {!batch.response && hasPermission("payroll.run") && (
                <Upload showUploadList={false} beforeUpload={(f) => { upload.mutate(f); return false; }}>
                  <Button loading={upload.isPending}>Attach the bank’s response…</Button>
                </Upload>
              )}
            </Space>
          </>
        )}
      </Flex>
      {paying && batch && <MarkPaidModal batchId={batch.id} onClose={() => setPaying(false)} onDone={refresh} />}
    </Card>
  );
}

function MarkPaidModal({ batchId, onClose, onDone }: { batchId: string; onClose: () => void; onDone: () => void }) {
  const [reference, setReference] = useState("");
  const [paidOn, setPaidOn] = useState(dayjs());
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const mark = useMutation({
    mutationFn: () => payrollApi.markBatchPaid(batchId, { reference: reference.trim(), paidOn: paidOn.format("YYYY-MM-DD"), confirm }),
    onSuccess: () => {
      void message.success("Recorded.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  return (
    <Modal open title="Record that the bank paid this batch" onCancel={onClose} okText="Record" okButtonProps={{ disabled: reference.trim().length < 3 || confirm.trim().toUpperCase() !== "PAID", loading: mark.isPending }} onOk={() => mark.mutate()} destroyOnHidden>
      <Space orientation="vertical" style={{ width: "100%" }} size={10}>
        <Paragraph style={{ margin: 0 }}>This is your own statement that you uploaded the file and the bank gave this reference. It moves no money and is not checked with the bank. It is recorded under your name and cannot be changed.</Paragraph>
        <Input placeholder="The bank’s reference for the batch" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
        <DatePicker value={paidOn} onChange={(d) => d && setPaidOn(d)} format="DD MMM YYYY" style={{ width: "100%" }} />
        <Input placeholder="Type PAID to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={20} />
        {problem && <Alert type="error" showIcon title={problem} />}
      </Space>
    </Modal>
  );
}

// ── Statutory files and the register ──

const OUTPUT_LABEL: Record<OutputKind, string> = { PF_ECR: "PF return (ECR)", ESI: "ESI contribution file", PT: "Professional tax statement", LWF: "Labour welfare fund statement", SALARY_REGISTER: "Salary register (Excel)" };

function OutputsCard({ run }: { run: RunDetail }) {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const canView = hasPermission("reports.salary.view");
  const { data, isLoading } = useQuery({ queryKey: ["payroll", "outputs", run.id], queryFn: () => payrollApi.listOutputs(run.id), enabled: canView });
  const [problem, setProblem] = useState<string | null>(null);
  const make = useMutation({
    mutationFn: (kind: OutputKind) => payrollApi.generateOutput(run.id, kind),
    onSuccess: () => {
      setProblem(null);
      void queryClient.invalidateQueries({ queryKey: ["payroll", "outputs", run.id] });
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That file could not be made.")),
  });
  const download = useMutation({
    mutationFn: (id: string) => payrollApi.outputFileLink(id),
    onSuccess: (r) => open(r.url),
    onError: (e) => void message.error(apiErrorMessage(e, "Could not get the file.")),
  });
  const ready = (k: OutputKind) => k === "SALARY_REGISTER" || data?.layouts.find((l) => l.kind === k)?.ready === true;
  return (
    <Card size="small" title="Statutory files and the register" data-testid="outputs-card">
      <Flex vertical gap={10}>
        {isLoading && <Spin />}
        {!canView && <Text type="secondary">You do not have permission to see these files.</Text>}
        {canView && (
          <>
            {problem && <Alert type="error" showIcon title={problem} closable onClose={() => setProblem(null)} />}
            <Text type="secondary">A statutory file is made in the layout the portal or your state accepts, entered and confirmed under Bank and statutory layouts. Until a layout is confirmed its file cannot be made.</Text>
            <Space wrap>
              {(["SALARY_REGISTER", "PF_ECR", "ESI", "PT", "LWF"] as OutputKind[]).map((k) => (
                <Tooltip key={k} title={ready(k) ? "" : "Its layout is not entered and confirmed yet"}>
                  <span>
                    <Button disabled={!ready(k) || !hasPermission("payroll.run")} loading={make.isPending && make.variables === k} onClick={() => make.mutate(k)}>
                      Make {OUTPUT_LABEL[k]}
                    </Button>
                  </span>
                </Tooltip>
              ))}
            </Space>
            <Table
              size="small"
              rowKey="id"
              pagination={{ pageSize: 8, hideOnSinglePage: true }}
              dataSource={data?.outputs ?? []}
              scroll={{ x: "max-content" }}
              locale={{ emptyText: "Nothing made yet" }}
              columns={[
                { title: "File", render: (_, r) => OUTPUT_LABEL[r.kind] },
                { title: "Rows", dataIndex: "rows" },
                { title: "Made", render: (_, r) => formatDateTime(r.generatedAt) },
                { title: "SHA-256", render: (_, r) => <Text code>{r.sha256.slice(0, 12)}…</Text> },
                { title: "", render: (_, r) => <Button size="small" icon={<DownloadOutlined />} loading={download.isPending && download.variables === r.id} onClick={() => download.mutate(r.id)}>Download</Button> },
              ]}
            />
          </>
        )}
      </Flex>
    </Card>
  );
}

export function ReleasePanels({ run }: { run: RunDetail }) {
  if (run.status !== "FINALISED") return null;
  return (
    <Flex vertical gap={12}>
      <PayslipsCard run={run} />
      <BankCard run={run} />
      <OutputsCard run={run} />
    </Flex>
  );
}
