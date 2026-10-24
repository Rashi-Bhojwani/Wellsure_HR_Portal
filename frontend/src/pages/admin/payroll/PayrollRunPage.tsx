import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, Flex, Input, Modal, Progress, Segmented, Space, Spin, Statistic, Table, Tabs, Tag, Tooltip, Typography, message } from "antd";
import { ArrowLeftOutlined, DownloadOutlined } from "@ant-design/icons";
import { Link, useParams } from "react-router-dom";
import { HOLD_REASON_LABEL } from "@shared/constants/payrollRun";
import * as payrollApi from "../../../api/payroll";
import type { RunDetail, RunItemRow, VarianceRow } from "../../../api/payroll";
import { CalculateModal } from "../../../components/payroll/CalculateModal";
import { PlaceholderBanner } from "../../../components/payroll/PlaceholderBanner";
import { RunApprovalPanel } from "../../../components/payroll/RunApprovalPanel";
import { ReleasePanels } from "../../../components/payroll/ReleasePanels";
import { RunItemDrawer } from "../../../components/payroll/RunItemDrawer";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { formatDifference, formatRupees } from "../../../lib/money";
import { useSocket } from "../../../sockets/SocketProvider";
import { RUN_STATUS_COLOR, VARIANCE_TAG_LABEL } from "./runText";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;

// Payroll → one payroll run (Phase 6 P6-3, P6-4): where it stands, who is in it and why each figure is what it is, how it differs from last month, what it used, and
// the road from a draft to a final, locked month (submit, approve, close the period). A run on Placeholder rules carries the TEST banner here and in the workbook.

export function PayrollRunPage() {
  const { id = "" } = useParams();
  const { hasPermission } = useAuth();
  const canRun = hasPermission("payroll.run");
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const [calculating, setCalculating] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const { data: run, isLoading, error } = useQuery({
    queryKey: ["payroll", "run", id],
    queryFn: () => payrollApi.getRun(id),
    refetchInterval: (q) => (q.state.data?.status === "CALCULATING" ? 2500 : false),
  });

  // Progress arrives as it happens (counts only, never a figure); the poll above is the fallback.
  useEffect(() => {
    if (!socket) return;
    const onProgress = (e: { runId?: string }) => {
      if (e.runId === id) void queryClient.invalidateQueries({ queryKey: ["payroll"] });
    };
    socket.on("payroll.run.progress", onProgress);
    return () => {
      socket.off("payroll.run.progress", onProgress);
    };
  }, [socket, id, queryClient]);

  if (isLoading) return <PageSkeleton />;
  if (error || !run) return <EmptyState kind="error" title="Could not load this run" description={apiErrorMessage(error, "Could not load this run.")} />;
  const open = ["NEW", "CALCULATED", "FAILED"].includes(run.status);
  const download = () => void payrollApi.downloadRunWorkbook(id).catch((e) => toast.error(apiErrorMessage(e, "Could not download the register.")));
  const stepIndex = STEP_OF[run.status];

  return (
    <>
      <PageHeader
        back="/admin/payroll/run"
        title={`Payroll run: ${run.cycle.label}`}
        breadcrumb={[{ label: "Payroll runs", to: "/admin/payroll/run" }, { label: run.cycle.label }]}
        tags={
          <>
            <RunStatusChip status={run.status} label={run.statusLabel} />
            {run.watermark.test && <TestChip />}
          </>
        }
        actions={
          <>
            {run.runHash && (
              <Button icon={<DownloadOutlined />} onClick={download}>
                Download the register (Excel)
              </Button>
            )}
            {canRun && open && <Button danger onClick={() => setDiscarding(true)}>Discard this draft</Button>}
            {canRun && open && <Button type="primary" onClick={() => setCalculating(true)}>{run.runHash ? "Calculate again" : "Calculate"}</Button>}
          </>
        }
      />
      <Stack>
        {run.runHash && <PlaceholderBanner watermark={run.watermark} />}
        {stepIndex !== null && (
          <Panel>
            <StepStrip steps={RUN_STEPS} current={stepIndex} done={run.status === "FINALISED"} />
          </Panel>
        )}
        <RunApprovalPanel run={run} />
        <ReleasePanels run={run} />
        {run.status === "CALCULATING" && (
          <ApprovalBanner tone="info" title="Calculating" description={<Progress percent={run.progress.total ? Math.floor((run.progress.done * 100) / run.progress.total) : 0} status="active" />} />
        )}
        {run.status === "FAILED" && <ApprovalBanner tone="danger" title="The calculation did not finish" description={run.failureReason ?? "Nothing was changed."} />}
        {run.stale && <ApprovalBanner tone="warning" title="A rule this run used has changed since it was calculated" description="Calculate it again before it goes any further. Until then the figures below are the ones that were worked out with the earlier value." />}
        {run.status === "NEW" && <ApprovalBanner tone="info" title="Not calculated yet" description="Choose Calculate to see what it would do. Nothing is calculated until you confirm." />}
        {run.status === "VOID" && <ApprovalBanner tone="info" title="Discarded" description={run.voidReason} />}
        {run.runHash && (
          <Panel
            title="What it came to"
            subtitle={`Calculated ${run.calculatedAt ? formatDateTime(run.calculatedAt) : ""}${run.calculatedBy ? ` by ${run.calculatedBy}` : ""}. Version ${run.calcVersion}.`}
          >
            <FigureRow>
              <Figure label="Gross" value={formatRupees(run.totals.gross)} />
              <Figure label="Deductions" value={formatRupees(run.totals.deductions)} />
              <Figure label="Net pay" value={formatRupees(run.totals.net)} />
              <Figure label="Employer cost (PF, ESI, LWF)" value={formatRupees(run.totals.employerCost)} />
              <Figure label="Payable" value={run.counts.payable} />
              <Figure label="Held" value={run.counts.held} />
              <Figure label="Left out" value={run.counts.excluded} />
              <Figure label="To resolve" value={run.counts.exceptions} tone={run.counts.exceptions ? "danger" : undefined} />
            </FigureRow>
          </Panel>
        )}
        {run.runHash && (
          <Panel>
            <Tabs
              items={[
                { key: "people", label: "People", children: <PeopleTab runId={id} /> },
                { key: "variance", label: "Difference from last month", children: <VarianceTab runId={id} /> },
                { key: "used", label: "What it used", children: <UsedTab run={run} /> },
              ]}
            />
          </Panel>
        )}
      </Stack>
      {calculating && <CalculateModal runId={id} onClose={() => setCalculating(false)} />}
      {discarding && <DiscardModal runId={id} cycle={run.cycle.label} onClose={() => setDiscarding(false)} />}
    </>
  );
}

// The road from a draft to a final month, shown as numbered steps. Worked out from the run's status alone; the Approval panel below says what is next and who does it.
const RUN_STEPS: StepItem[] = [
  { key: "calc", label: "Calculate" },
  { key: "submit", label: "Submit for approval" },
  { key: "approve", label: "Approval" },
  { key: "close", label: "Close the period" },
  { key: "release", label: "Payslips and bank file" },
];
const STEP_OF: Record<RunDetail["status"], number | null> = { NEW: 0, CALCULATING: 0, FAILED: 0, CALCULATED: 1, SUBMITTED: 2, APPROVED: 3, FINALISED: 4, VOID: null };

function DiscardModal({ runId, cycle, onClose }: { runId: string; cycle: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const discard = useMutation({
    mutationFn: () => payrollApi.voidRun(runId, why),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  return (
    <ConfirmModal
      open
      title={`Discard the draft for ${cycle}`}
      description="A discarded run is kept on record and is never changed again. You can start a new run for the same cycle."
      onCancel={onClose}
      confirmLabel="Discard"
      danger
      confirmDisabled={why.trim().length < 3}
      loading={discard.isPending}
      onConfirm={() => discard.mutate()}
    >
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Input.TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="Why" aria-label="Why" />
        {problem && <Alert type="error" showIcon title={problem} />}
      </Space>
    </ConfirmModal>
  );
}

function StatusCell({ r }: { r: RunItemRow }) {
  if (r.status === "PAYABLE") return <StatusChip tone="success">Payable</StatusChip>;
  const label = r.holdReason ? HOLD_REASON_LABEL[r.holdReason] : "";
  return (
    <Tooltip title={r.holdDetail ?? label}>
      <span tabIndex={0}>
        <StatusChip tone={r.status === "HELD" ? "warning" : "danger"}>
          {r.status === "HELD" ? "Held" : "Left out"}: {label}
        </StatusChip>
      </span>
    </Tooltip>
  );
}

function PeopleTab({ runId }: { runId: string }) {
  const [status, setStatus] = useState<"ALL" | "PAYABLE" | "HELD" | "EXCLUDED">("ALL");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["payroll", "run-items", runId, status, exceptionsOnly, search, page],
    queryFn: () => payrollApi.listRunItems(runId, { ...(status === "ALL" ? {} : { status }), ...(search ? { search } : {}), exceptionsOnly, page, pageSize: 50 }),
    placeholderData: keepPreviousData,
  });
  return (
    <Flex vertical gap={12}>
      <FilterBar
        onSearch={(v) => { setSearch(v.trim()); setPage(1); }}
        searchPlaceholder="Employee code or name"
        activeCount={(status === "ALL" ? 0 : 1) + (exceptionsOnly ? 1 : 0)}
        onClear={() => { setStatus("ALL"); setExceptionsOnly(false); setPage(1); }}
        filters={
          <>
            <Segmented value={status} onChange={(v) => { setStatus(v as typeof status); setPage(1); }} options={[{ value: "ALL", label: "Everyone" }, { value: "PAYABLE", label: "Payable" }, { value: "HELD", label: "Held" }, { value: "EXCLUDED", label: "Left out" }]} />
            <Checkbox checked={exceptionsOnly} onChange={(e) => { setExceptionsOnly(e.target.checked); setPage(1); }}>Only people with something to resolve or look at</Checkbox>
          </>
        }
      />
      <DataTable<RunItemRow>
        density="compact"
        rowKey="employeeId"
        loading={isLoading || isFetching}
        error={error}
        onRetry={() => void refetch()}
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => r.employeeCode,
          status: (r) => <StatusCell r={r} />,
          fields: [
            { label: "Paid days", render: (r) => (r.status === "EXCLUDED" ? "—" : <Num>{r.paidDays.replace(/0+$/, "").replace(/\.$/, "")}</Num>) },
            { label: "Gross", render: (r) => (r.status === "EXCLUDED" ? "—" : <Num>{formatRupees(r.gross, 2)}</Num>) },
            { label: "Net pay", render: (r) => (r.status === "EXCLUDED" ? "—" : <Num strong>{formatRupees(r.net, 2)}</Num>) },
          ],
          actions: (r) => <Button block onClick={() => setOpen(r.employeeId)}>Why?</Button>,
        }}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: "Employee", key: "emp", render: (_, r) => <PersonCell name={r.name} code={r.employeeCode} extra={r.isYou && <StatusChip tone="warning">You</StatusChip>} /> },
          { title: "Status", key: "status", render: (_, r) => <StatusCell r={r} /> },
          { title: "Paid days", key: "paid", align: "right", className: "ws-num", render: (_, r) => (r.status === "EXCLUDED" ? "" : r.paidDays.replace(/0+$/, "").replace(/\.$/, "")) },
          { title: "LOP", key: "lop", align: "right", className: "ws-num", render: (_, r) => (r.status === "EXCLUDED" ? "" : r.lopDays) },
          { title: "Gross", key: "gross", align: "right", className: "ws-num", render: (_, r) => (r.status === "EXCLUDED" ? "" : formatRupees(r.gross, 2)) },
          { title: "Deductions", key: "ded", align: "right", className: "ws-num", render: (_, r) => (r.status === "EXCLUDED" ? "" : formatRupees(r.deductions, 2)) },
          { title: "Net pay", key: "net", align: "right", className: "ws-num", render: (_, r) => (r.status === "EXCLUDED" ? "" : <Text strong>{formatRupees(r.net, 2)}</Text>) },
          { title: "To do", key: "exc", render: (_, r) => (r.exceptions > 0 ? <StatusChip tone={r.blocking ? "danger" : "warning"}>{r.blocking ? "Resolve" : "Look"}</StatusChip> : null) },
          { title: "", key: "actions", align: "right", render: (_, r) => <Button size="small" onClick={() => setOpen(r.employeeId)}>Why?</Button> },
        ]}
      />
      {open && <RunItemDrawer runId={runId} employeeId={open} onClose={() => setOpen(null)} />}
    </Flex>
  );
}

function VarianceTab({ runId }: { runId: string }) {
  const [view, setView] = useState<"CHANGED" | "FLAGGED" | "ALL">("CHANGED");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["payroll", "run-variance", runId, view, page],
    queryFn: () => payrollApi.getRunVariance(runId, { changedOnly: view === "CHANGED", flaggedOnly: view === "FLAGGED", page, pageSize: 50 }),
  });
  if (error) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not work out the difference.")} />;
  return (
    <Flex vertical gap={12}>
      {data && !data.baseline && <Alert type="info" showIcon title="There is no run for the previous cycle to compare with" />}
      {data?.baseline && (
        <Alert
          type={data.baseline.final ? "success" : "warning"}
          showIcon
          title={`Compared with ${data.baseline.cycleLabel}${data.baseline.final ? ", which is finalised" : ""}`}
          description={data.baseline.final ? undefined : "That run is only a draft, not a closed month: the comparison is with figures that can still change."}
        />
      )}
      {data && !data.thresholds.set && <Alert type="info" showIcon title="Nothing is highlighted yet" description={<>The rules “Variance: flag above (percent)” and “Variance: ignore below (rupees)” have no value. <Link to="/admin/payroll/rules">Set them</Link> to have large changes flagged. They only decide what is highlighted; they never change a figure.</>} />}
      {data?.totals.previous && data.totals.change && (
        <Flex gap={32} wrap>
          <Statistic title="Gross" value={formatRupees(data.totals.current!.gross)} suffix={<Text type="secondary" style={{ fontSize: fs.table }}> {formatDifference(data.totals.change.gross)}</Text>} />
          <Statistic title="Deductions" value={formatRupees(data.totals.current!.deductions)} suffix={<Text type="secondary" style={{ fontSize: fs.table }}> {formatDifference(data.totals.change.deductions)}</Text>} />
          <Statistic title="Net pay" value={formatRupees(data.totals.current!.net)} suffix={<Text type="secondary" style={{ fontSize: fs.table }}> {formatDifference(data.totals.change.net)}</Text>} />
        </Flex>
      )}
      <Flex gap={8} wrap align="center">
        <Segmented value={view} onChange={(v) => { setView(v as typeof view); setPage(1); }} options={[{ value: "CHANGED", label: "Who changed" }, { value: "FLAGGED", label: `Flagged${data ? ` (${data.flaggedCount})` : ""}` }, { value: "ALL", label: "Everyone" }]} />
        {data && Object.entries(data.tagCounts).map(([tag, n]) => <Tag key={tag}>{VARIANCE_TAG_LABEL[tag as keyof typeof VARIANCE_TAG_LABEL] ?? tag}: {n}</Tag>)}
      </Flex>
      <Table<VarianceRow>
        size="small"
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: "Employee", render: (_, r) => <div><Text strong>{r.name}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{r.employeeCode}</Text></div></div> },
          { title: "Net last month", align: "right", render: (_, r) => (r.previous ? formatRupees(r.previous.net, 2) : "") },
          { title: "Net this month", align: "right", render: (_, r) => (r.current ? formatRupees(r.current.net, 2) : "") },
          { title: "Change", align: "right", render: (_, r) => (r.change ? <Text type={r.flagged ? "danger" : undefined} strong={r.flagged}>{formatDifference(r.change.net)}{r.percent ? ` (${r.percent}%)` : ""}</Text> : "") },
          { title: "Why", render: (_, r) => <Space size={4} wrap>{r.tags.map((t) => <Tag key={t}>{VARIANCE_TAG_LABEL[t]}</Tag>)}</Space> },
          { title: "", render: (_, r) => (r.flagged ? <Tag color="red">Flagged</Tag> : null) },
        ]}
      />
    </Flex>
  );
}

function UsedTab({ run }: { run: RunDetail }) {
  return (
    <Flex vertical gap={12}>
      <Text type="secondary">Everything this run actually read. A run is real only when every item below is Confirmed by somebody other than the person who entered it.</Text>
      {run.notices.map((n) => <Alert key={n} type="info" showIcon title={n} />)}
      <Table
        size="small"
        rowKey={(r) => `${r.kind}-${r.key}-${r.version}-${r.frozen}`}
        pagination={false}
        dataSource={run.rules}
        columns={[
          { title: "What", render: (_, r) => <div>{r.kind === "RULE" ? <Link to="/admin/payroll/rules">{r.label}</Link> : r.label}{r.frozen && <div><Text type="secondary" style={{ fontSize: fs.sm }}>What a salary was frozen under</Text></div>}</div> },
          { title: "Version", align: "right", render: (_, r) => (r.notSet ? "" : r.version) },
          { title: "Status", render: (_, r) => <Tag color={r.status === "CONFIRMED" ? "green" : "orange"}>{r.status === "CONFIRMED" ? "Confirmed" : r.notSet ? "Not set" : "Placeholder"}</Tag> },
          { title: "", render: (_, r) => (r.stale ? <Tag color="gold">Changed since</Tag> : null) },
        ]}
      />
      <Text type="secondary">Created by {run.createdBy} on {formatDate(run.createdAt)}.</Text>
    </Flex>
  );
}
