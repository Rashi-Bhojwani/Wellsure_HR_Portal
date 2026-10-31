import { BankRepaymentCard } from "./BankRepayment";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Flex, Input, Space, Tooltip, Typography, Upload } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { Link } from "react-router-dom";
import * as payrollApi from "../../api/payroll";
import type { OutputKind, PayslipRow, RunDetail } from "../../api/payroll";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate, formatDateTime } from "../../lib/dates";
import { formatRupees } from "../../lib/money";
import { NoPayslipAlert } from "./NoPayslipAlert";
import { PayslipView } from "./PayslipView";
import { fs } from "../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, Panel, SideDrawer, SkeletonCard, Stack, StatusChip, toast, type ChipTone } from "../../ui";
import { FileRow, Num } from "./payrollUi";
import { PayslipWhyButton } from "./PayslipWhy";

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

const EMAIL_TAG: Record<payrollApi.EmailStatus, { tone: ChipTone; label: string }> = {
  SENT: { tone: "success", label: "Email sent" },
  FILE_ONLY: { tone: "warning", label: "Not emailed (development)" },
  FAILED: { tone: "danger", label: "Email failed" },
  PENDING: { tone: "neutral", label: "Not yet" },
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
      toast[r.queued ? "success" : "error"](r.queued ? "Preparing again. Anything not yet done will be done; nothing is repeated." : "The background worker could not be reached. Try again in a moment.");
      window.setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["payroll", "payslips", run.id] }), 3000);
    },
    onError: (e) => toast.error(apiErrorMessage(e, "That did not work.")),
  });
  const slips = data?.payslips ?? [];
  const failed = slips.filter((s) => s.delivery.emailStatus === "FAILED").length;
  const noPdf = slips.filter((s) => !s.delivery.rendered).length;
  return (
    <div data-testid="payslips-card">
    <Panel title="Payslips" extra={slips.length > 0 ? <StatusChip tone="success">{slips.length} published</StatusChip> : undefined}>
      <Flex vertical gap={10}>
        {isLoading && <SkeletonCard lines={3} />}
        {canView && !isLoading && slips.length === 0 && (
          <Flex justify="space-between" align="center" wrap gap={8}>
            <Text>Not published yet. Employees cannot see their payslips until they are.</Text>
            <Link to={stepLink(run.id, "publish")}>
              <Button size="small">Publish payslips…</Button>
            </Link>
          </Flex>
        )}
        {!canView && <Text type="secondary">You do not have permission to see payslips.</Text>}
        {slips.length > 0 && (data?.noPayslip.length ?? 0) > 0 && <NoPayslipAlert people={data!.noPayslip} willGet={slips.length} />}
        {slips.length > 0 && (
          <>
            <Text>
              {slips.length} published. {noPdf > 0 ? `${noPdf} PDF${noPdf === 1 ? " is" : "s are"} still being prepared. ` : "Every PDF is ready. "}
            </Text>
            {failed > 0 && <Alert type="error" showIcon title={`${failed} ${failed === 1 ? "person has" : "people have"} not been emailed`} description="They can still read their payslip in the app. The reason is shown against each name; Prepare again tries the ones that failed." />}
            <DataTable<PayslipRow>
              density="compact"
              rowKey="id"
              pagination={slips.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
              dataSource={slips}
              mobile={{
                title: (r) => r.name,
                subtitle: (r) => r.employeeCode,
                status: (r) => <StatusChip tone={EMAIL_TAG[r.delivery.emailStatus].tone}>{EMAIL_TAG[r.delivery.emailStatus].label}</StatusChip>,
                fields: [
                  { label: "Net pay", render: (r) => <Num>{formatRupees(r.net, 2)}</Num> },
                  { label: "PDF", render: (r) => (r.delivery.rendered ? "Ready" : r.delivery.renderError ? `Failed: ${r.delivery.renderError}` : "Preparing") },
                  ...(slips.some((x) => x.delivery.emailError) ? [{ label: "Email problem", render: (r: PayslipRow) => r.delivery.emailError ?? "—" }] : []),
                ],
                actions: (r) => <Button block onClick={() => setViewing(r.id)}>Read</Button>,
              }}
              columns={[
                { title: "Code", dataIndex: "employeeCode" },
                { title: "Name", dataIndex: "name" },
                { title: "Net pay", key: "net", align: "right", className: "ws-num", render: (_, r) => formatRupees(r.net, 2) },
                { title: "PDF", key: "pdf", render: (_, r) => (r.delivery.rendered ? <StatusChip tone="success">Ready</StatusChip> : r.delivery.renderError ? <Tooltip title={r.delivery.renderError}><span tabIndex={0}><StatusChip tone="danger">Failed</StatusChip></span></Tooltip> : <StatusChip tone="neutral">Preparing</StatusChip>) },
                {
                  title: "Told",
                  key: "told",
                  render: (_, r) => (
                    <Space orientation="vertical" size={2}>
                      <StatusChip tone={EMAIL_TAG[r.delivery.emailStatus].tone}>{EMAIL_TAG[r.delivery.emailStatus].label}</StatusChip>
                      {r.delivery.emailTo && <Text type="secondary" style={{ fontSize: fs.sm }}>{r.delivery.emailTo}</Text>}
                      {r.delivery.emailError && <Text type="danger" style={{ fontSize: fs.sm }}>{r.delivery.emailError}</Text>}
                    </Space>
                  ),
                },
                { title: "", key: "actions", align: "right", render: (_, r) => <Button size="small" onClick={() => setViewing(r.id)}>Read</Button> },
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
      <SideDrawer open={viewing !== null} onClose={() => setViewing(null)} size="wide" title="Payslip" footer={null}>
        {viewing && <OnePayslip id={viewing} />}
      </SideDrawer>
    </Panel>
    </div>
  );
}

function OnePayslip({ id }: { id: string }) {
  const { data, isLoading, error } = useQuery({ queryKey: ["payroll", "payslip", id], queryFn: () => payrollApi.getPayslip(id) });
  if (isLoading) return <SkeletonCard lines={8} />;
  if (error || !data) return <EmptyState kind="error" compact title="Could not load this payslip" description={apiErrorMessage(error, "Could not load this payslip.")} />;
  return (
    <>
      <PayslipWhyButton queryKey={["payroll", "payslip", id, "why"]} load={() => payrollApi.getPayslipWhy(id)} />
      <PayslipView content={data.content} />
    </>
  );
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
    onError: (e) => toast.error(apiErrorMessage(e, "Could not get the file.")),
  });
  const upload = useMutation({
    mutationFn: (file: File) => payrollApi.attachBatchResponse(batch!.id, file),
    onSuccess: () => {
      toast.success("The bank's response is stored. It is not read by this system.");
      refresh();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not store that file.")),
  });
  return (
    <div data-testid="bank-card">
    <Panel title="Bank file" subtitle="Nothing is sent to the bank from here" extra={batch ? <StatusChip tone={batch.status === "PAID" ? "success" : "info"}>{batch.status === "PAID" ? "Marked paid" : "File made, not yet marked paid"}</StatusChip> : undefined}>
      <Flex vertical gap={10}>
        {isLoading && <SkeletonCard lines={3} />}
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
            <Text>
              {batch.rowCount} {batch.rowCount === 1 ? "row" : "rows"}, <span className="ws-num">{formatRupees(batch.total, 2)}</span>, payment date {formatDate(batch.paymentDate)}
            </Text>
            {batch.excluded.length > 0 && <Alert type="warning" showIcon title={`${batch.excluded.length} payable ${batch.excluded.length === 1 ? "person is" : "people are"} not in this file`} description={<ul style={{ margin: 0, paddingLeft: 20 }}>{batch.excluded.map((e) => <li key={e.employeeId}>{e.name} ({e.employeeCode}): {e.detail}</li>)}</ul>} />}
            <FileRow
              name={batch.fileName}
              meta={`SHA-256 ${batch.fileSha256.slice(0, 16)}… · made ${formatDateTime(batch.generatedAt)}`}
              actions={
                <Button icon={<DownloadOutlined />} loading={download.isPending} onClick={() => download.mutate()}>
                  Download the file
                </Button>
              }
            />
            {batch.paid && (
              <Text>
                Recorded as paid by the bank on {batch.paid.on ? formatDate(batch.paid.on) : ""}, reference <Text strong>{batch.paid.reference}</Text>. This is HR’s own record; the system does not check it with the bank.
              </Text>
            )}
            {batch.response && <Text type="secondary">The bank’s response ({batch.response.fileName}) is stored, attached {batch.response.attachedAt ? formatDateTime(batch.response.attachedAt) : ""}. It has not been read.</Text>}
            <Space wrap>
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
    </Panel>
    </div>
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
      toast.success("Recorded.");
      onDone();
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  return (
    <ConfirmModal open title="Record that the bank paid this batch" onCancel={onClose} confirmLabel="Record" confirmDisabled={reference.trim().length < 3 || confirm.trim().toUpperCase() !== "PAID"} loading={mark.isPending} onConfirm={() => mark.mutate()}>
      <Space orientation="vertical" style={{ width: "100%" }} size={10}>
        <Paragraph type="secondary" style={{ margin: 0 }}>This is your own statement that you uploaded the file and the bank gave this reference. It moves no money and is not checked with the bank. It is recorded under your name and cannot be changed.</Paragraph>
        <Input aria-label="The bank’s reference for the batch" placeholder="The bank’s reference for the batch" value={reference} onChange={(e) => setReference(e.target.value)} maxLength={60} />
        <DatePicker aria-label="Paid on" value={paidOn} onChange={(d) => d && setPaidOn(d)} format="DD MMM YYYY" style={{ width: "100%" }} />
        <Input aria-label="Type PAID to confirm" placeholder="Type PAID to confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={20} />
        {problem && <Alert type="error" showIcon title={problem} />}
      </Space>
    </ConfirmModal>
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
    onError: (e) => toast.error(apiErrorMessage(e, "Could not get the file.")),
  });
  const ready = (k: OutputKind) => k === "SALARY_REGISTER" || data?.layouts.find((l) => l.kind === k)?.ready === true;
  return (
    <div data-testid="outputs-card">
    <Panel title="Statutory files and the register">
      <Flex vertical gap={10}>
        {isLoading && <SkeletonCard lines={3} />}
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
            <div>
              {(data?.outputs ?? []).length === 0 && !isLoading && <EmptyState compact illustration="documents" title="Nothing made yet" description="Files you make appear here, ready to download." />}
              {(data?.outputs ?? []).map((r) => (
                <FileRow
                  key={r.id}
                  kind={r.kind === "SALARY_REGISTER" ? "excel" : "text"}
                  name={OUTPUT_LABEL[r.kind]}
                  meta={
                    <>
                      <span className="ws-num">{r.rows}</span> rows · made {formatDateTime(r.generatedAt)} · SHA-256 <Text code style={{ fontSize: fs.sm }}>{r.sha256.slice(0, 12)}…</Text>
                    </>
                  }
                  actions={
                    <Button size="small" icon={<DownloadOutlined />} loading={download.isPending && download.variables === r.id} onClick={() => download.mutate(r.id)}>
                      Download
                    </Button>
                  }
                />
              ))}
            </div>
          </>
        )}
      </Flex>
    </Panel>
    </div>
  );
}

function RepaymentOfRun({ run }: { run: RunDetail }) {
  const { hasPermission } = useAuth();
  const canView = hasPermission("payroll.bank.view");
  const { data } = useQuery({ queryKey: ["payroll", "bank-batch", run.id], queryFn: () => payrollApi.getBankBatchForRun(run.id), enabled: canView });
  return data?.batch ? <BankRepaymentCard batchId={data.batch.id} /> : null;
}

export function ReleasePanels({ run }: { run: RunDetail }) {
  if (run.status !== "FINALISED") return null;
  return (
    <Stack>
      <PayslipsCard run={run} />
      <BankCard run={run} />
      <RepaymentOfRun run={run} />
      <OutputsCard run={run} />
    </Stack>
  );
}
