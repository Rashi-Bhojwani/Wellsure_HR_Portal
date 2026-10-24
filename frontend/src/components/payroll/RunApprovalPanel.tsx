import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Flex, Space, Typography } from "antd";
import { Link } from "react-router-dom";
import * as payrollApi from "../../api/payroll";
import type { RunDetail, StepSlug, StepState } from "../../api/payroll";
import { formatDate, formatDateTime } from "../../lib/dates";
import { useSocket } from "../../sockets/SocketProvider";
import { CheckersNote } from "./CheckersNote";
import { ApprovalBanner, Panel, StatusChip } from "../../ui";
import { space, v } from "../../theme/tokens";

const { Text } = Typography;

// The panel at the top of a run: where it is on the road from a draft to a final, locked month, what is next, and who has to do it. Each button goes to the page for that
// step, where exactly what would happen is shown first.

const stepLink = (runId: string, slug: StepSlug) => `/admin/payroll/run/${runId}/step/${slug}`;

function StateTag({ s }: { s: StepState }) {
  if (!s.live) return null;
  return s.live.status === "APPROVED" ? <StatusChip tone="success">Approved</StatusChip> : <StatusChip tone="warning">Waiting for {s.checkers?.eligible.length === 1 ? s.checkers.eligible[0]!.name : "a decision"}</StatusChip>;
}

export function RunApprovalPanel({ run }: { run: RunDetail }) {
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const open = ["CALCULATED", "SUBMITTED", "APPROVED", "FINALISED"].includes(run.status);
  const { data } = useQuery({ queryKey: ["payroll", "approvals", run.id, run.status], queryFn: () => payrollApi.getApprovalState(run.id), enabled: open });

  useEffect(() => {
    if (!socket) return;
    const events = ["payroll.approval.requested", "payroll.approval.decided", "payroll.approval.withdrawn", "payroll.run.approval_voided", "payroll.run.finalised", "payroll.run.unlocked"];
    const refresh = (e: { runId?: string }) => {
      if (e.runId === run.id) void queryClient.invalidateQueries({ queryKey: ["payroll"] });
    };
    for (const ev of events) socket.on(ev, refresh);
    return () => {
      for (const ev of events) socket.off(ev, refresh);
    };
  }, [socket, run.id, queryClient]);

  if (!open || !data) return null;
  const step = (slug: StepSlug) => data.steps.find((s) => s.slug === slug)!;
  const runStep = step("run");
  const finalise = step("finalise");
  const unlock = step("unlock");

  return (
    <Panel title="Approval" subtitle="Who prepared it, who has to approve it, and what is next">
      <Flex vertical gap={12}>
        {run.status === "CALCULATED" && (
          <>
            {runStep.last?.status === "REJECTED" && <ApprovalBanner tone="warning" title={`Rejected by ${runStep.last.checker?.name ?? "the checker"}`} description={runStep.last.decisionNote} />}
            {runStep.last?.status === "VOIDED" && <ApprovalBanner tone="info" title="The last approval was voided" description={runStep.last.voidReason} />}
            {run.counts.excluded > 0 ? (
              <ApprovalBanner tone="danger" title={`${run.counts.excluded} ${run.counts.excluded === 1 ? "person is" : "people are"} left out of this run, so it cannot be submitted`} description="Open the submit page to see who, and why." />
            ) : (
              <ApprovalBanner tone="info" title="Ready to submit" description="When the figures look right, send the run to a second person for approval." />
            )}
            <CheckersNote checkers={runStep.checkers} what="this run" />
            <Space>
              <Link to={stepLink(run.id, "run")}>
                <Button type="primary">Review and submit for approval…</Button>
              </Link>
            </Space>
          </>
        )}

        {run.status === "SUBMITTED" && runStep.live && (
          <>
            <ApprovalBanner
              tone="warning"
              title="Waiting for approval"
              description={
                <>
                  Submitted by <Text strong>{runStep.live.maker.name}</Text> on {formatDateTime(runStep.live.submittedAt)}. The run cannot be recalculated or changed while it waits.
                </>
              }
            />
            <CheckersNote checkers={runStep.checkers} what="this run" />
            <Space>
              <Link to={stepLink(run.id, "run")}>
                <Button type={runStep.you.canDecide ? "primary" : "default"}>{runStep.you.canDecide ? "Review and decide…" : "See what was submitted"}</Button>
              </Link>
            </Space>
          </>
        )}

        {run.status === "APPROVED" && (
          <>
            <ApprovalBanner
              tone="success"
              title="Approved"
              description={
                <>
                  Approved by <Text strong>{runStep.live?.checker?.name ?? "a checker"}</Text>. The next step is to close the period, which also needs a second person.
                </>
              }
            />
            {!finalise.live && <CheckersNote checkers={finalise.checkers} what="closing the period" />}
            <Space wrap>
              <StateTag s={finalise} />
              <Link to={stepLink(run.id, "finalise")}>
                <Button type="primary">{!finalise.live ? "Ask to close the period…" : finalise.live.status === "APPROVED" ? "Close the period…" : finalise.you.canDecide ? "Review and decide…" : "See the request"}</Button>
              </Link>
              <Link to={stepLink(run.id, "run")}>
                <Button>See what was approved</Button>
              </Link>
            </Space>
          </>
        )}

        {run.status === "FINALISED" && (
          <>
            <ApprovalBanner tone="success" title="This month is final and locked" description={`Closed ${run.finalisedAt ? formatDate(run.finalisedAt) : ""}. Changes to people’s history dated ${formatDate(run.cycle.start)} to ${formatDate(run.cycle.end)} are refused.`} />
            <Flex vertical gap={8}>
              {(["publish", "bank-file"] as const).map((slug) => {
                const s = step(slug);
                return (
                  <Flex key={slug} justify="space-between" align="center" gap={8} wrap style={{ padding: `${space[3]}px 0`, borderBottom: `1px solid ${v.borderDefault}` }}>
                    <Space>
                      <Text strong>{slug === "publish" ? "Publish payslips" : "Generate the bank file"}</Text>
                      {s.live ? <StateTag s={s} /> : s.last?.status === "CONSUMED" ? <StatusChip tone="success">Done</StatusChip> : <StatusChip tone="neutral">Not asked for</StatusChip>}
                    </Space>
                    <Link to={stepLink(run.id, slug)}>
                      <Button size="small">{s.live ? "Open…" : s.last?.status === "CONSUMED" ? "See it…" : "Look at it…"}</Button>
                    </Link>
                  </Flex>
                );
              })}
              <Text type="secondary">Publishing and the file each need a second person’s approval, then somebody other than that person carries it out. What has been produced is shown below.</Text>
            </Flex>
            {unlock.you.canMake && (
              <Flex justify="space-between" align="center" gap={8} wrap>
                <Space>
                  <Text strong>Unlock the period</Text>
                  {unlock.live && <StateTag s={unlock} />}
                </Space>
                <Link to={stepLink(run.id, "unlock")}>
                  <Button size="small" danger>
                    {unlock.live ? "Open…" : "Unlock…"}
                  </Button>
                </Link>
              </Flex>
            )}
          </>
        )}
      </Flex>
    </Panel>
  );
}
