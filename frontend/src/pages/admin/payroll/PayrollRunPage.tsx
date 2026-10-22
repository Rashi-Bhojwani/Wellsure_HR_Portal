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

  if (isLoading) return <Spin />;
  if (error || !run) return <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load this run.")} />;
  const open = ["NEW", "CALCULATED", "FAILED"].includes(run.status);
  const download = () => void payrollApi.downloadRunWorkbook(id).catch((e) => void message.error(apiErrorMessage(e, "Could not download the register.")));

  return (
    <Flex vertical gap={16}>
      <Link to="/admin/payroll/run">
        <ArrowLeftOutlined /> All payroll runs
      </Link>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Space>
          <Title level={3} style={{ margin: 0 }}>
            Payroll run: {run.cycle.label}
          </Title>
          <Tag color={RUN_STATUS_COLOR[run.status]}>{run.statusLabel}</Tag>
          {run.watermark.test && <Tag color="red">TEST</Tag>}
        </Space>
        <Space wrap>
          {run.runHash && (
            <Button icon={<DownloadOutlined />} onClick={download}>
              Download the register (Excel)
            </Button>
          )}
          {canRun && open && <Button type="primary" onClick={() => setCalculating(true)}>{run.runHash ? "Calculate again" : "Calculate"}</Button>}
          {canRun && open && <Button danger onClick={() => setDiscarding(true)}>Discard this draft</Button>}
        </Space>
      </Flex>
      {run.runHash && <PlaceholderBanner watermark={run.watermark} />}
      <RunApprovalPanel run={run} />
      <ReleasePanels run={run} />
      {run.status === "CALCULATING" && (
        <Alert type="info" showIcon title="Calculating" description={<Progress percent={run.progress.total ? Math.floor((run.progress.done * 100) / run.progress.total) : 0} status="active" />} />
      )}
      {run.status === "FAILED" && <Alert type="error" showIcon title="The calculation did not finish" description={run.failureReason ?? "Nothing was changed."} />}
      {run.stale && <Alert type="warning" showIcon title="A rule this run used has changed since it was calculated" description="Calculate it again before it goes any further. Until then the figures below are the ones that were worked out with the earlier value." />}
      {run.status === "NEW" && <Alert type="info" showIcon title="Not calculated yet" description="Choose Calculate to see what it would do. Nothing is calculated until you confirm." />}
      {run.status === "VOID" && <Alert type="info" showIcon title="Discarded" description={run.voidReason} />}
      {run.runHash && (
        <Flex gap={32} wrap>
          <Statistic title="Gross" value={formatRupees(run.totals.gross)} />
          <Statistic title="Deductions" value={formatRupees(run.totals.deductions)} />
          <Statistic title="Net pay" value={formatRupees(run.totals.net)} />
          <Statistic title="Employer cost (PF, ESI, LWF)" value={formatRupees(run.totals.employerCost)} />
          <Statistic title="Payable" value={run.counts.payable} />
          <Statistic title="Held" value={run.counts.held} />
          <Statistic title="Left out" value={run.counts.excluded} />
          <Statistic title="To resolve" value={run.counts.exceptions} styles={{ content: { color: run.counts.exceptions ? "#cf1322" : undefined } }} />
        </Flex>
      )}
      {run.runHash && (
        <Text type="secondary">
          Calculated {run.calculatedAt ? formatDateTime(run.calculatedAt) : ""}{run.calculatedBy ? ` by ${run.calculatedBy}` : ""}. Version {run.calcVersion}.
        </Text>
      )}
      {run.runHash && (
        <Tabs
          items={[
            { key: "people", label: "People", children: <PeopleTab runId={id} /> },
            { key: "variance", label: "Difference from last month", children: <VarianceTab runId={id} /> },
            { key: "used", label: "What it used", children: <UsedTab run={run} /> },
          ]}
        />
      )}
      {calculating && <CalculateModal runId={id} onClose={() => setCalculating(false)} />}
      {discarding && <DiscardModal runId={id} cycle={run.cycle.label} onClose={() => setDiscarding(false)} />}
    </Flex>
  );
}

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
    <Modal open title={`Discard the draft for ${cycle}`} onCancel={onClose} okText="Discard" okButtonProps={{ danger: true, disabled: why.trim().length < 3, loading: discard.isPending }} onOk={() => discard.mutate()} destroyOnHidden>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        <Text>A discarded run is kept on record and is never changed again. You can start a new run for the same cycle.</Text>
        <Input.TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="Why" />
        {problem && <Alert type="error" showIcon title={problem} />}
      </Space>
    </Modal>
  );
}

function StatusCell({ r }: { r: RunItemRow }) {
  if (r.status === "PAYABLE") return <Tag color="green">Payable</Tag>;
  const label = r.holdReason ? HOLD_REASON_LABEL[r.holdReason] : "";
  return (
    <Tooltip title={r.holdDetail ?? label}>
      <Tag color={r.status === "HELD" ? "orange" : "red"}>{r.status === "HELD" ? "Held" : "Left out"}: {label}</Tag>
    </Tooltip>
  );
}

function PeopleTab({ runId }: { runId: string }) {
  const [status, setStatus] = useState<"ALL" | "PAYABLE" | "HELD" | "EXCLUDED">("ALL");
  const [exceptionsOnly, setExceptionsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["payroll", "run-items", runId, status, exceptionsOnly, search, page],
    queryFn: () => payrollApi.listRunItems(runId, { ...(status === "ALL" ? {} : { status }), ...(search ? { search } : {}), exceptionsOnly, page, pageSize: 50 }),
  });
  return (
    <Flex vertical gap={12}>
      <Flex gap={12} wrap align="center">
        <Segmented value={status} onChange={(v) => { setStatus(v as typeof status); setPage(1); }} options={[{ value: "ALL", label: "Everyone" }, { value: "PAYABLE", label: "Payable" }, { value: "HELD", label: "Held" }, { value: "EXCLUDED", label: "Left out" }]} />
        <Checkbox checked={exceptionsOnly} onChange={(e) => { setExceptionsOnly(e.target.checked); setPage(1); }}>Only people with something to resolve or look at</Checkbox>
        <Input.Search allowClear placeholder="Employee code or name" style={{ width: 260 }} onSearch={(v) => { setSearch(v.trim()); setPage(1); }} />
      </Flex>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the people.")} />}
      <Table<RunItemRow>
        size="small"
        rowKey="employeeId"
        loading={isLoading}
        dataSource={data?.items ?? []}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, showSizeChanger: false, onChange: setPage }}
        columns={[
          { title: "Employee", render: (_, r) => <div><Space size={4}><Text strong>{r.name}</Text>{r.isYou && <Tag color="gold">You</Tag>}</Space><div><Text type="secondary" style={{ fontSize: 12 }}>{r.employeeCode}</Text></div></div> },
          { title: "Status", render: (_, r) => <StatusCell r={r} /> },
          { title: "Paid days", align: "right", render: (_, r) => (r.status === "EXCLUDED" ? "" : r.paidDays.replace(/0+$/, "").replace(/\.$/, "")) },
          { title: "LOP", align: "right", render: (_, r) => (r.status === "EXCLUDED" ? "" : r.lopDays) },
          { title: "Gross", align: "right", render: (_, r) => (r.status === "EXCLUDED" ? "" : formatRupees(r.gross, 2)) },
          { title: "Deductions", align: "right", render: (_, r) => (r.status === "EXCLUDED" ? "" : formatRupees(r.deductions, 2)) },
          { title: "Net pay", align: "right", render: (_, r) => (r.status === "EXCLUDED" ? "" : <Text strong>{formatRupees(r.net, 2)}</Text>) },
          { title: "", render: (_, r) => (r.exceptions > 0 ? <Tag color={r.blocking ? "red" : "gold"}>{r.blocking ? "Resolve" : "Look"}</Tag> : null) },
          { title: "", align: "right", render: (_, r) => <Button size="small" onClick={() => setOpen(r.employeeId)}>Why?</Button> },
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
          <Statistic title="Gross" value={formatRupees(data.totals.current!.gross)} suffix={<Text type="secondary" style={{ fontSize: 13 }}> {formatDifference(data.totals.change.gross)}</Text>} />
          <Statistic title="Deductions" value={formatRupees(data.totals.current!.deductions)} suffix={<Text type="secondary" style={{ fontSize: 13 }}> {formatDifference(data.totals.change.deductions)}</Text>} />
          <Statistic title="Net pay" value={formatRupees(data.totals.current!.net)} suffix={<Text type="secondary" style={{ fontSize: 13 }}> {formatDifference(data.totals.change.net)}</Text>} />
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
          { title: "Employee", render: (_, r) => <div><Text strong>{r.name}</Text><div><Text type="secondary" style={{ fontSize: 12 }}>{r.employeeCode}</Text></div></div> },
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
          { title: "What", render: (_, r) => <div>{r.kind === "RULE" ? <Link to="/admin/payroll/rules">{r.label}</Link> : r.label}{r.frozen && <div><Text type="secondary" style={{ fontSize: 12 }}>What a salary was frozen under</Text></div>}</div> },
          { title: "Version", align: "right", render: (_, r) => (r.notSet ? "" : r.version) },
          { title: "Status", render: (_, r) => <Tag color={r.status === "CONFIRMED" ? "green" : "orange"}>{r.status === "CONFIRMED" ? "Confirmed" : r.notSet ? "Not set" : "Placeholder"}</Tag> },
          { title: "", render: (_, r) => (r.stale ? <Tag color="gold">Changed since</Tag> : null) },
        ]}
      />
      <Text type="secondary">Created by {run.createdBy} on {formatDate(run.createdAt)}.</Text>
    </Flex>
  );
}
