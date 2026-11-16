import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Flex, Typography } from "antd";
import * as api from "../../api/statutoryPack";
import type { PackEntryView } from "../../api/statutoryPack";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDate } from "../../lib/dates";
import {
  ApprovalBanner,
  ConfirmModal,
  DataTable,
  Panel,
  QueryState,
  SkeletonCard,
  Stack,
  StatusChip,
  toast,
} from "../../ui";

const { Text } = Typography;

// The Standard statutory defaults pack (docs/plans/STATUTORY_DEFAULTS_PLAN.md): every standard value with its source and check date, what needs review, the directors'
// one-time acknowledgement ("I have reviewed the standard values") and later reviews. Nothing is typed; the click is recorded and audited.

const valueText = (v: unknown): string =>
  typeof v === "string"
    ? v
    : v && typeof v === "object" && "levied" in (v as object)
      ? "Not levied"
      : JSON.stringify(v);
const fromText = (e: PackEntryView) => (e.from ? `from ${formatDate(e.from)}` : "in force");

type Row = {
  key: string;
  label: string;
  value: string;
  when: string;
  source: string;
  url: string;
  checkedOn: string;
  reviewNeeded: boolean;
  inUse: string;
};

export function StandardValuesPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["payroll", "statutory-pack"], queryFn: api.getStatutoryPack });
  const [confirming, setConfirming] = useState<"ACK" | "REVIEW" | null>(null);
  const done = () => {
    setConfirming(null);
    void qc.invalidateQueries({ queryKey: ["payroll", "statutory-pack"] });
    void qc.invalidateQueries({ queryKey: ["payroll", "ready"] });
  };
  const ack = useMutation({
    mutationFn: api.acknowledgeStatutoryPack,
    onSuccess: () => {
      toast.success("Recorded: you have reviewed the standard values.");
      done();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")),
  });
  const review = useMutation({
    mutationFn: api.reviewStatutoryPack,
    onSuccess: () => {
      toast.success("Recorded as reviewed today.");
      done();
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")),
  });

  if (q.isLoading || q.error || !q.data)
    return (
      <QueryState
        isLoading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<SkeletonCard lines={4} />}
      >
        {null}
      </QueryState>
    );
  const p = q.data;
      const mine = p.acknowledgedBy.some((a) => a.mine);
      const rows: Row[] = [
        ...p.rules.map((r) => ({
          key: r.key,
          label: r.label,
          value: valueText(r.today.value),
          when: fromText(r.today),
          source: r.today.source.name,
          url: r.today.source.url,
          checkedOn: r.today.checkedOn,
          reviewNeeded: r.today.reviewNeeded,
          inUse: r.inUse,
        })),
        ...(p.state.professionalTax
          ? [
              {
                key: "PT",
                label: `Professional tax, ${p.state.label}`,
                value: `Not levied in ${p.state.label}`,
                when: fromText(p.state.professionalTax),
                source: p.state.professionalTax.source.name,
                url: p.state.professionalTax.source.url,
                checkedOn: p.state.professionalTax.checkedOn,
                reviewNeeded: p.state.professionalTax.reviewNeeded,
                inUse: "STANDARD",
              },
            ]
          : []),
        ...(p.state.labourWelfareFund
          ? [
              {
                key: "LWF",
                label: `Labour welfare fund, ${p.state.label}`,
                value: `Not levied in ${p.state.label}`,
                when: fromText(p.state.labourWelfareFund),
                source: p.state.labourWelfareFund.source.name,
                url: p.state.labourWelfareFund.source.url,
                checkedOn: p.state.labourWelfareFund.checkedOn,
                reviewNeeded: p.state.labourWelfareFund.reviewNeeded,
                inUse: "STANDARD",
              },
            ]
          : []),
        ...p.taxYears.map((t) => ({
          key: `TAX_${t.year}`,
          label: `Income tax ${t.year}`,
          value: "Slabs, standard deduction, rebate, cess, surcharge (Tax Years)",
          when: "the tax year",
          source: "Income Tax Department and the Finance Bill 2026 memorandum",
          url: "",
          checkedOn: p.checkedOn,
          reviewNeeded: t.verification === "UNVERIFIED",
          inUse: t.inUse,
        })),
      ];
      return (
        <Panel
          title={`Using standard statutory values, last reviewed on ${formatDate(p.lastReviewedOn)}`}
          subtitle={`${p.label}. Each value shows its source and the date it was checked. Changing one is the usual entry by a director and confirmation by the other director.`}
          extra={
            <StatusChip tone={p.acknowledged ? "success" : "warning"}>
              {p.acknowledged
                ? "Both directors have reviewed them"
                : `${p.acknowledgedBy.length} of 2 directors have reviewed them`}
            </StatusChip>
          }
        >
          <div style={{ overflowWrap: "anywhere" }}><Stack>
            {!p.state.loaded && (
              <ApprovalBanner
                tone="danger"
                title={`${p.state.label}: ${p.state.notLoadedText}`}
                description="Professional tax and labour welfare fund are refused for this state until a director enters its tables."
              />
            )}
            {p.reviewDue.length > 0 && (
              <ApprovalBanner
                tone="warning"
                title="A review of the standard values is due"
                description={p.reviewDue.join(" ")}
              />
            )}
            {!p.acknowledged && (
              <ApprovalBanner
                tone="info"
                title="Before the first real payroll run, each of the two directors confirms they have reviewed these values"
                description={
                  p.acknowledgedBy.length
                    ? `Done by ${p.acknowledgedBy.map((a) => `${a.name} (${formatDate(a.at.slice(0, 10))})`).join(" and ")}.`
                    : "Nobody has yet. A run that uses them cannot be submitted until both have."
                }
              />
            )}
            <Flex gap={8} wrap>
              {!mine && (
                <Button type="primary" onClick={() => setConfirming("ACK")}>
                  I have reviewed the standard values
                </Button>
              )}
              {mine && (
                <Button onClick={() => setConfirming("REVIEW")}>
                  Mark the standard values as reviewed today
                </Button>
              )}
            </Flex>
            <DataTable<Row>
              rowKey="key"
              density="compact"
              pagination={false}
              dataSource={rows}
              mobile={{
                title: (r) => r.label,
                subtitle: (r) => `${r.value} (${r.when})`,
                status: (r) =>
                  r.reviewNeeded ? (
                    <StatusChip tone="warning">Review needed</StatusChip>
                  ) : (
                    <StatusChip tone="success">Official source</StatusChip>
                  ),
                fields: [
                  { label: "Source", render: (r: Row) => r.source },
                  { label: "Checked", render: (r: Row) => formatDate(r.checkedOn) },
                  {
                    label: "Used",
                    render: (r: Row) =>
                      r.inUse === "DIRECTOR"
                        ? "A director's confirmed value"
                        : "The standard value",
                  },
                ],
              }}
              columns={[
                { title: "Value", dataIndex: "label" },
                {
                  title: "Standard",
                  key: "v",
                  render: (_: unknown, r: Row) => (
                    <>
                      {r.value} <Text type="secondary">({r.when})</Text>
                    </>
                  ),
                },
                {
                  title: "Source",
                  key: "s",
                  render: (_: unknown, r: Row) =>
                    r.url ? (
                      <a href={r.url} target="_blank" rel="noreferrer">
                        {r.source}
                      </a>
                    ) : (
                      r.source
                    ),
                },
                { title: "Checked", dataIndex: "checkedOn", render: (v: string) => formatDate(v) },
                {
                  title: "",
                  key: "f",
                  render: (_: unknown, r: Row) =>
                    r.reviewNeeded ? (
                      <StatusChip tone="warning">Review needed</StatusChip>
                    ) : (
                      <StatusChip tone="success">Official source</StatusChip>
                    ),
                },
                {
                  title: "Used",
                  key: "u",
                  render: (_: unknown, r: Row) =>
                    r.inUse === "DIRECTOR" ? "A director's confirmed value" : "The standard value",
                },
              ]}
            />
            {p.reviewNeeded.length > 0 && (
              <div>
                <Text strong>Review needed ({p.reviewNeeded.length})</Text>
                <ul>
                  {p.reviewNeeded.map((r, i) => (
                    <li key={`${r.key}-${i}`}>
                      <Text strong>{r.label}:</Text> {r.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <ConfirmModal
              open={confirming !== null}
              title={
                confirming === "ACK"
                  ? "I have reviewed the standard values"
                  : "Mark the standard values as reviewed today?"
              }
              description={
                confirming === "ACK"
                  ? "You confirm you have looked at the standard statutory values above, their sources and the ones marked Review needed. Nothing is entered; this is recorded with your name and the date."
                  : "Records that you reviewed them today. The next reminder counts from today."
              }
              confirmLabel={confirming === "ACK" ? "I have reviewed them" : "Mark as reviewed"}
              loading={ack.isPending || review.isPending}
              onCancel={() => setConfirming(null)}
              onConfirm={() => (confirming === "ACK" ? ack.mutate() : review.mutate())}
            />
          </Stack></div>
        </Panel>
      );
}
