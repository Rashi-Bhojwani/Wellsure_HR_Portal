import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Checkbox, Flex, Input, Modal, Space, Spin, Statistic, Table, Tag, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { Link, useNavigate, useParams } from "react-router-dom";
import { HOLD_REASON_LABEL } from "@shared/constants/payrollRun";
import * as payrollApi from "../../../api/payroll";
import { NoPayslipAlert } from "../../../components/payroll/NoPayslipAlert";
import type { ApprovalView, PersonNote, StepPreview, StepSlug, StepState } from "../../../api/payroll";
import { CheckersNote } from "../../../components/payroll/CheckersNote";
import { PlaceholderBanner } from "../../../components/payroll/PlaceholderBanner";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate, formatDateTime } from "../../../lib/dates";
import { formatDifference, formatRupees } from "../../../lib/money";
import { useSocket } from "../../../sockets/SocketProvider";
import { STEP_TITLE, VARIANCE_TAG_LABEL } from "./runText";

const { Title, Text, Paragraph } = Typography;

// Payroll → one step on a run (Phase 6 P6-4): submit for approval, close the period, unlock it, publish payslips, generate the bank file. The same page for all of them,
// because they are the same thing: look at exactly what would happen, say you have looked, and either ask a second person or, if you are that person, decide. The first
// thing on the submit screen is everyone the run leaves out: a run that leaves anybody out cannot be submitted, and nobody should have to scroll to find out why.

const SLUGS: StepSlug[] = ["run", "finalise", "unlock", "publish", "bank-file"];
const isSlug = (s: string): s is StepSlug => (SLUGS as string[]).includes(s);

export function RunStepPage() {
  const { id = "", slug: raw = "" } = useParams();
  const slug = isSlug(raw) ? raw : "run";
  const queryClient = useQueryClient();
  const { socket } = useSocket();

  // Anything that happens to a run's approvals, anywhere, refreshes this: a checker's decision reaches the maker's screen at once.
  useEffect(() => {
    if (!socket) return;
    const events = ["payroll.approval.requested", "payroll.approval.decided", "payroll.approval.withdrawn", "payroll.run.approval_voided", "payroll.run.finalised", "payroll.run.unlocked"];
    const refresh = (e: { runId?: string }) => {
      if (e.runId === id) void queryClient.invalidateQueries({ queryKey: ["payroll"] });
    };
    for (const ev of events) socket.on(ev, refresh);
    return () => {
      for (const ev of events) socket.off(ev, refresh);
    };
  }, [socket, id, queryClient]);

  const state = useQuery({ queryKey: ["payroll", "approvals", id], queryFn: () => payrollApi.getApprovalState(id) });
  const preview = useQuery({ queryKey: ["payroll", "step-preview", id, slug, state.data?.runStatus, state.data?.steps.find((s) => s.slug === slug)?.live?.id ?? "none"], queryFn: () => payrollApi.previewStep(id, slug), enabled: !!state.data, refetchOnWindowFocus: false });

  if (state.isLoading || (state.data && preview.isLoading)) return <Spin />;
  if (state.error || !state.data) return <Alert type="error" showIcon title={apiErrorMessage(state.error, "Could not load this run.")} />;
  if (preview.error || !preview.data) return <Alert type="error" showIcon title={apiErrorMessage(preview.error, "Could not work out what this would do.")} />;
  const step = state.data.steps.find((s) => s.slug === slug)!;
  const p = preview.data;

  return (
    <Flex vertical gap={16}>
      <Link to={`/admin/payroll/run/${id}`}>
        <ArrowLeftOutlined /> Back to the run
      </Link>
      <Flex align="center" gap={12} wrap>
        <Title level={3} style={{ margin: 0 }}>
          {STEP_TITLE[slug]}: {p.cycle.label}
        </Title>
        <Tag>{p.runStatusLabel}</Tag>
        {p.watermark.test && <Tag color="red">TEST</Tag>}
      </Flex>
      {slug === "run" && <LeftOut people={p.leftOut ?? []} />}
      {slug === "publish" && <NoPayslipAlert people={p.noPayslip ?? []} willGet={p.payslips ?? 0} />}
      {!p.blockers.some((b) => b.code === "PLACEHOLDER_RULES") && <PlaceholderBanner watermark={p.watermark} />}
      <Blockers p={p} />
      <Where step={step} />
      <Summary p={p} slug={slug} />
      <Actions p={p} step={step} slug={slug} runId={id} />
    </Flex>
  );
}

// ── Who is left out: first, in full, by name ──

function LeftOut({ people }: { people: PersonNote[] }) {
  if (people.length === 0) return null;
  return (
    <Alert
      type="error"
      showIcon
      title={`${people.length} ${people.length === 1 ? "person is" : "people are"} left out of this run, so it cannot be submitted`}
      description={
        <Flex vertical gap={8}>
          <Text>A run that leaves anybody out would quietly not pay them, so it cannot go for approval. Put right the reason against each name, calculate the run again, then come back.</Text>
          <Table<PersonNote>
            size="small"
            rowKey="employeeId"
            pagination={people.length > 15 ? { pageSize: 15, showSizeChanger: false } : false}
            dataSource={people}
            columns={[
              { title: "Who", render: (_, r) => <div><Text strong>{r.name}</Text><div><Text type="secondary" style={{ fontSize: 12 }}>{r.employeeCode}</Text></div></div> },
              { title: "Why they are left out", render: (_, r) => <div>{r.reason}{r.detail && <div><Text type="secondary" style={{ fontSize: 12 }}>{r.detail}</Text></div>}</div> },
            ]}
          />
        </Flex>
      }
    />
  );
}

function Blockers({ p }: { p: StepPreview }) {
  // The left-out list has its own, bigger card above; everything else that stops this is listed here, each one in words.
  const others = p.blockers.filter((b) => b.code !== "PEOPLE_LEFT_OUT");
  if (others.length === 0) return null;
  return (
    <Flex vertical gap={8}>
      {others.map((b) => (
        <Alert
          key={b.code}
          type="error"
          showIcon
          title={b.title}
          description={
            <Flex vertical gap={4}>
              <Text>{b.message}</Text>
              {b.code === "BLOCKING_EXCEPTIONS" && p.blockingExceptions && (
                <Table<PersonNote>
                  size="small"
                  rowKey={(r) => `${r.employeeId}-${r.code}`}
                  pagination={false}
                  dataSource={p.blockingExceptions}
                  columns={[
                    { title: "Who", dataIndex: "name" },
                    { title: "What", dataIndex: "reason" },
                  ]}
                />
              )}
              {(b.code === "PLACEHOLDER_RULES" || b.code === "RULES_CHANGED") && <Link to="/admin/payroll/rules">Open Rules and setup</Link>}
            </Flex>
          }
        />
      ))}
    </Flex>
  );
}

// ── Where this stands, and who could decide ──

function approvalLine(a: ApprovalView): string {
  if (a.status === "PENDING") return `Asked by ${a.maker.name} on ${formatDateTime(a.submittedAt)}${a.note ? `: “${a.note}”` : ""}. Waiting for a different person to decide.`;
  if (a.status === "APPROVED") return `Approved by ${a.checker?.name ?? "someone"} on ${a.decidedAt ? formatDateTime(a.decidedAt) : ""}${a.decisionNote ? `: “${a.decisionNote}”` : ""}.`;
  if (a.status === "REJECTED") return `Rejected by ${a.checker?.name ?? "someone"}: ${a.decisionNote ?? ""}`;
  if (a.status === "VOIDED") return `Withdrawn or voided: ${a.voidReason ?? ""}`;
  return "Used.";
}

function Where({ step }: { step: StepState }) {
  return (
    <Flex vertical gap={8}>
      {step.live && <Alert type={step.live.status === "APPROVED" ? "success" : "info"} showIcon title={step.live.status === "APPROVED" ? "Approved" : "Waiting for a decision"} description={approvalLine(step.live)} />}
      {!step.live && step.last && step.last.status !== "CONSUMED" && <Alert type={step.last.status === "REJECTED" ? "warning" : "info"} showIcon title={step.last.status === "REJECTED" ? "The last request was rejected" : "The last request was voided"} description={approvalLine(step.last)} />}
      <CheckersNote checkers={step.live?.status === "APPROVED" ? null : step.checkers} what="this" />
    </Flex>
  );
}

// ── What it would do ──

function PersonList({ title, people }: { title: string; people: PersonNote[] }) {
  if (people.length === 0) return null;
  return (
    <Card size="small" title={`${title} (${people.length})`}>
      <Table<PersonNote>
        size="small"
        rowKey="employeeId"
        pagination={people.length > 10 ? { pageSize: 10, showSizeChanger: false } : false}
        dataSource={people}
        columns={[
          { title: "Who", dataIndex: "name" },
          { title: "Why", render: (_, r) => <div>{r.reason}{r.detail && <div><Text type="secondary" style={{ fontSize: 12 }}>{r.detail}</Text></div>}</div> },
        ]}
      />
    </Card>
  );
}

function Summary({ p, slug }: { p: StepPreview; slug: StepSlug }) {
  const v = p.variance;
  return (
    <Flex vertical gap={12}>
      <Flex gap={32} wrap>
        <Statistic title="Gross" value={formatRupees(p.totals.gross)} />
        <Statistic title="Deductions" value={formatRupees(p.totals.deductions)} />
        <Statistic title="Net pay" value={formatRupees(p.totals.net)} />
        <Statistic title="People" value={p.counts.people} />
        <Statistic title="Payable" value={p.counts.payable} />
        <Statistic title="Held" value={p.counts.held} />
      </Flex>
      {p.affected && (
        <Card size="small" title="Who this affects">
          <Flex vertical gap={6}>
            <Text>
              Everyone in the run: {p.affected.people} {p.affected.people === 1 ? "person" : "people"}, of whom {p.affected.payable} would be paid{p.affected.held ? ` and ${p.affected.held} are held` : ""}.
            </Text>
            {p.affected.ownLine && <Alert type="warning" showIcon title={`You are in this run (${p.affected.ownLine.name}, net ${formatRupees(p.affected.ownLine.net, 2)}).`} description="Your own line is not hidden. Somebody else decides this, and you should not be the one who prepared or approved your own pay." />}
            {Object.keys(p.affected.changes).length > 0 && (
              <Space size={4} wrap>
                <Text type="secondary">What changed since last month:</Text>
                {Object.entries(p.affected.changes).map(([tag, n]) => (
                  <Tag key={tag}>
                    {VARIANCE_TAG_LABEL[tag as keyof typeof VARIANCE_TAG_LABEL] ?? tag}: {n}
                  </Tag>
                ))}
              </Space>
            )}
          </Flex>
        </Card>
      )}
      {v && (
        <Card size="small" title="Difference from last month">
          {!v.baseline && <Text type="secondary">There is no run for the previous cycle to compare with.</Text>}
          {v.baseline && (
            <Flex vertical gap={8}>
              <Text type={v.baseline.final ? undefined : "warning"}>
                Compared with {v.baseline.cycleLabel}
                {v.baseline.final ? ", which is finalised." : ", which is only a draft: a closed month it is not."}
              </Text>
              {v.totals.change && (
                <Flex gap={32} wrap>
                  <Statistic title="Net pay" value={formatRupees(v.totals.current!.net)} suffix={<Text type="secondary" style={{ fontSize: 13 }}> {formatDifference(v.totals.change.net)}</Text>} />
                  <Statistic title="Gross" value={formatRupees(v.totals.current!.gross)} suffix={<Text type="secondary" style={{ fontSize: 13 }}> {formatDifference(v.totals.change.gross)}</Text>} />
                </Flex>
              )}
              {v.flaggedCount > 0 && (
                <>
                  <Text strong>{v.flaggedCount} flagged as a large change</Text>
                  <Table
                    size="small"
                    rowKey="employeeId"
                    pagination={false}
                    dataSource={v.items}
                    columns={[
                      { title: "Who", dataIndex: "name" },
                      { title: "Last month", align: "right", render: (_, r) => (r.previous ? formatRupees(r.previous.net, 2) : "") },
                      { title: "This month", align: "right", render: (_, r) => (r.current ? formatRupees(r.current.net, 2) : "") },
                      { title: "Change", align: "right", render: (_, r) => (r.change ? formatDifference(r.change.net) : "") },
                    ]}
                  />
                </>
              )}
              {!v.thresholds.set && <Text type="secondary">Nothing is flagged because the variance thresholds in Rules and setup have no value yet.</Text>}
            </Flex>
          )}
        </Card>
      )}
      {p.held && <PersonList title="Held, not paid by this run" people={p.held.map((h) => ({ ...h, reason: HOLD_REASON_LABEL[h.code as keyof typeof HOLD_REASON_LABEL] ?? h.reason }))} />}
      {slug === "publish" && p.payslips !== undefined && (
        <Card size="small" title="What publishing does">
          <Flex vertical gap={8}>
            <Text>
              <Text strong>{p.payslips}</Text> {p.payslips === 1 ? "payslip" : "payslips"}, net pay <Text strong>{formatRupees(p.netTotal ?? "0", 2)}</Text> in all.
            </Text>
            <ul style={{ margin: 0, paddingLeft: 20 }}>{(p.willDo ?? []).map((w) => <li key={w}>{w}</li>)}</ul>
          </Flex>
        </Card>
      )}
      {slug === "bank-file" && p.paymentDate !== undefined && (
        <Card size="small" title="What the bank file would contain">
          <Flex vertical gap={8}>
            <Text>
              <Text strong>{p.rows ?? 0}</Text> {p.rows === 1 ? "row" : "rows"}, total <Text strong>{formatRupees(p.rowsTotal ?? "0", 2)}</Text>, for the payment date <Text strong>{p.paymentDate ? formatDate(p.paymentDate) : "not set"}</Text>. Each goes to the account in force on that date.
            </Text>
            {p.excluded && p.excluded.length > 0 && (
              <Alert type="warning" showIcon title={`${p.excluded.length} ${p.excluded.length === 1 ? "person is" : "people are"} payable but not in this file`} description={<ul style={{ margin: 0, paddingLeft: 20 }}>{p.excluded.map((e) => <li key={e.employeeId}>{e.name} ({e.employeeCode}): {e.detail}</li>)}</ul>} />
            )}
            <Table size="small" rowKey="employeeCode" pagination={{ pageSize: 10, hideOnSinglePage: true }} dataSource={p.people ?? []} scroll={{ x: "max-content" }} columns={[{ title: "Code", dataIndex: "employeeCode" }, { title: "Name", dataIndex: "name" }, { title: "Bank", dataIndex: "bankName" }, { title: "Account", render: (_, r) => `ending ${r.accountLast4}` }, { title: "IFSC", dataIndex: "ifsc" }, { title: "Amount", align: "right", render: (_, r) => formatRupees(r.amount, 2) }]} />
            <ul style={{ margin: 0, paddingLeft: 20 }}>{(p.willDo ?? []).map((w) => <li key={w}>{w}</li>)}</ul>
          </Flex>
        </Card>
      )}
      {slug === "finalise" && p.lock && (
        <Card size="small" title="What closing the period does">
          <ul style={{ margin: 0, paddingLeft: 20 }}>
            <li>Locks {p.lock.from} to {p.lock.to}. From then on the system refuses:</li>
            <ul>{p.lock.refuses.map((r) => <li key={r}>{r}</li>)}</ul>
            <li>
              Marks {p.adjustmentsMarkedPaid?.count ?? 0} adjustment{p.adjustmentsMarkedPaid?.count === 1 ? "" : "s"} as paid by this run.
            </li>
            <li>Makes these figures final. A correction after that is an adjustment in the next run, or an unlock with a second person’s approval, until payslips are published or a bank file is made.</li>
          </ul>
        </Card>
      )}
      {slug === "unlock" && p.allows && (
        <Card size="small" title="What unlocking allows">
          <ul style={{ margin: 0, paddingLeft: 20 }}>{p.allows.map((a) => <li key={a}>{a}</li>)}</ul>
        </Card>
      )}
      {(slug === "publish" || slug === "bank-file") && (
        <Alert
          type="info"
          showIcon
          title={slug === "publish" ? "What this approves" : "What this approves"}
          description={`${p.rows ?? 0} ${slug === "publish" ? "payslips" : "bank rows"}${p.rowsTotal ? `, ${formatRupees(p.rowsTotal, 2)} in all` : ""}. Producing them is the next build step; the approval is real and is bound to these exact figures now, and an unlock or a change voids it.`}
        />
      )}
    </Flex>
  );
}

// ── What you can do ──

function Actions({ p, step, slug, runId }: { p: StepPreview; step: StepState; slug: StepSlug; runId: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [seen, setSeen] = useState(false);
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [withdrawing, setWithdrawing] = useState(false);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["payroll"] });
  const fail = (e: unknown) => {
    setProblem(apiErrorMessage(e, "That did not work."));
    refresh();
  };

  const request = useMutation({
    mutationFn: () => payrollApi.requestStep(runId, slug, { fingerprint: p.fingerprint, ...(note.trim() ? { note: note.trim() } : {}) }),
    onSuccess: () => {
      void message.success("Sent. A different person has to approve it.");
      setSeen(false);
      setNote("");
      refresh();
    },
    onError: fail,
  });
  const decide = useMutation({
    mutationFn: (decision: "APPROVE" | "REJECT") => payrollApi.decideStep(runId, slug, { decision, ...(note.trim() ? { note: note.trim() } : {}), ...(decision === "APPROVE" ? { hash: step.live!.hash } : {}) }),
    onSuccess: (_, decision) => {
      void message.success(decision === "APPROVE" ? "Approved." : "Rejected.");
      setNote("");
      setSeen(false);
      refresh();
    },
    onError: fail,
  });
  const execute = useMutation({
    mutationFn: async () => {
      if (slug === "finalise") await payrollApi.finaliseRun(runId);
      else if (slug === "publish") await payrollApi.publishPayslips(runId);
      else if (slug === "bank-file") await payrollApi.generateBankFile(runId);
      else await payrollApi.unlockRun(runId);
    },
    onSuccess: () => {
      void message.success(slug === "finalise" ? "The period is closed." : slug === "publish" ? "The payslips are published." : slug === "bank-file" ? "The bank file is ready." : "The period is unlocked.");
      refresh();
      navigate(`/admin/payroll/run/${runId}`);
    },
    onError: fail,
  });

  const live = step.live;
  const needsReason = slug === "unlock";
  return (
    <Card size="small" title="Your part">
      <Flex vertical gap={12}>
        {problem && <Alert type="error" showIcon title={problem} closable onClose={() => setProblem(null)} />}

        {/* Nothing live: ask. */}
        {!live && step.you.canMake && !p.review && (
          <>
            <Paragraph style={{ margin: 0 }}>
              {p.canRequest
                ? "Nothing here stops this. Read the page above, then confirm that you have, and ask for a second person to approve."
                : "This cannot be sent for approval yet. What stands in the way is listed above."}
            </Paragraph>
            {needsReason && <Input.TextArea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why the period needs to be unlocked (required)" />}
            {!needsReason && <Input.TextArea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note for the person who will approve it (optional)" />}
            <Checkbox checked={seen} disabled={!p.canRequest} onChange={(e) => setSeen(e.target.checked)}>
              I have read what is above, including who is affected and what has changed since last month.
            </Checkbox>
            <Space>
              <Button type="primary" disabled={!p.canRequest || !seen || (needsReason && note.trim().length < 5)} loading={request.isPending} onClick={() => request.mutate()}>
                {slug === "run" ? "Submit for approval" : "Ask for approval"}
              </Button>
            </Space>
          </>
        )}
        {!live && !step.you.canMake && <Text type="secondary">{slug === "unlock" ? "Only a Super Admin can ask for a period to be unlocked." : "You can look at this, but only someone who prepares payroll can send it for approval."}</Text>}

        {/* Waiting: the checker decides, anybody else waits. */}
        {live?.status === "PENDING" && step.you.canDecide && (
          <>
            <Paragraph style={{ margin: 0 }}>You are being asked to approve exactly the figures on this page. If anything changes before you decide, the approval is voided and you are shown the new figures.</Paragraph>
            <Input.TextArea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A note (needed if you reject)" />
            <Checkbox checked={seen} onChange={(e) => setSeen(e.target.checked)}>
              I have read what is above and I am approving these figures.
            </Checkbox>
            <Space>
              <Button type="primary" disabled={!seen} loading={decide.isPending} onClick={() => decide.mutate("APPROVE")}>
                Approve
              </Button>
              <Button danger disabled={note.trim().length < 3} loading={decide.isPending} onClick={() => decide.mutate("REJECT")}>
                Reject
              </Button>
            </Space>
          </>
        )}
        {live?.status === "PENDING" && !step.you.canDecide && (
          <Text type="secondary">
            {step.you.isMaker ? "You asked for this, so a different person has to decide it." : step.you.editedFigures ? "You changed these figures after they were submitted, so you cannot be the one who approves them." : "You do not have the permission to approve payroll actions."}
          </Text>
        )}

        {/* Approved: carry it out (finalise, unlock) or leave it standing (publish, bank file). */}
        {live?.status === "APPROVED" && (slug === "finalise" || slug === "unlock") && (
          <>
            <Paragraph style={{ margin: 0 }}>
              {slug === "finalise" ? "A second person approved closing this period. Carrying it out is the last step, and it is done by someone other than the person who approved it." : "A second person approved unlocking this period. Carrying it out is done by someone other than the person who approved it."}
            </Paragraph>
            {step.you.canMake && live.checker && (
              <Space>
                <Button type="primary" danger={slug === "unlock"} loading={execute.isPending} onClick={() => execute.mutate()}>
                  {slug === "finalise" ? "Close the period now" : "Unlock the period now"}
                </Button>
              </Space>
            )}
          </>
        )}
        {live?.status === "APPROVED" && (slug === "publish" || slug === "bank-file") && (
          <>
            <Paragraph style={{ margin: 0 }}>
              {slug === "publish" ? "A second person approved publishing. Carrying it out is done by someone other than the person who approved it." : "A second person approved making the bank file. Carrying it out is done by someone other than the person who approved it. Nothing is sent to the bank: you download the file and upload it yourself."}
            </Paragraph>
            {step.you.canMake && live.checker && (
              <Space>
                <Button type="primary" loading={execute.isPending} onClick={() => execute.mutate()}>
                  {slug === "publish" ? "Publish the payslips now" : "Make the bank file now"}
                </Button>
              </Space>
            )}
          </>
        )}
        {live?.status === "APPROVED" && slug === "run" && <Text type="secondary">Approved. The next step is to ask for the period to be closed, from the run page.</Text>}

        {live && step.you.canMake && (
          <Space>
            <Button onClick={() => setWithdrawing(true)}>{slug === "run" && p.runStatus === "APPROVED" ? "Reopen this run" : "Withdraw this request"}</Button>
          </Space>
        )}
      </Flex>
      {withdrawing && <WithdrawModal runId={runId} slug={slug} onClose={() => setWithdrawing(false)} />}
    </Card>
  );
}

function WithdrawModal({ runId, slug, onClose }: { runId: string; slug: StepSlug; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [why, setWhy] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const preview = useQuery({ queryKey: ["payroll", "withdraw-preview", runId, slug], queryFn: () => payrollApi.previewWithdraw(runId, slug), refetchOnWindowFocus: false });
  const withdraw = useMutation({
    mutationFn: () => payrollApi.withdrawStep(runId, slug, { reason: why.trim(), fingerprint: preview.data!.fingerprint }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["payroll"] });
      onClose();
    },
    onError: (e) => setProblem(apiErrorMessage(e, "That did not work.")),
  });
  const p = preview.data;
  return (
    <Modal open title="Withdraw" onCancel={onClose} okText="Withdraw" okButtonProps={{ danger: true, disabled: !p || why.trim().length < 3, loading: withdraw.isPending }} onOk={() => withdraw.mutate()} destroyOnHidden>
      <Space orientation="vertical" size={8} style={{ width: "100%" }}>
        {preview.isLoading && <Spin />}
        {p && (
          <>
            <Text>This voids {p.willVoid.length === 1 ? "this approval" : "these approvals"}:</Text>
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {p.willVoid.map((w) => (
                <li key={w.approvalId}>
                  {w.subject === "RUN_APPROVAL" ? "The approval of the run" : w.subject === "PERIOD_FINALISE" ? "The approval to close the period" : w.subject.toLowerCase().replace(/_/g, " ")}: {w.status.toLowerCase()}, asked by {w.maker}
                  {w.checker ? `, decided by ${w.checker}` : ""}
                </li>
              ))}
            </ul>
            {p.runWill && <Text>The run will {p.runWill}.</Text>}
            <Input.TextArea value={why} onChange={(e) => setWhy(e.target.value)} rows={2} maxLength={300} placeholder="Why" />
          </>
        )}
        {problem && <Alert type="error" showIcon title={problem} />}
      </Space>
    </Modal>
  );
}
