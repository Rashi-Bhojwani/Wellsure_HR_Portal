import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import * as loansApi from "../../../api/loans";
import type { LoanType, LoanView } from "../../../api/loans";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatRupees } from "../../../lib/money";
import { DataTable, PageHeader, Panel, Stack, StatusChip, toast } from "../../../ui";
import { space } from "../../../theme/tokens";

// Payroll > Loans (P7-4), directors only: each loan's state and the sanction (one director asks, a different director decides; nobody on their own loan), and the
// loan types with what each still lacks. Types and changes are set through the API in this release; the screen shows what is Not set.
export function LoansAdminPage() {
  const queryClient = useQueryClient();
  const loans = useQuery({ queryKey: ["loans", "all"], queryFn: loansApi.allLoans });
  const types = useQuery({ queryKey: ["loans", "types"], queryFn: loansApi.loanTypes });
  const [busy, setBusy] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: async ({ l, what }: { l: LoanView; what: "ASK" | "APPROVE" | "REJECT" }) => (what === "ASK" ? loansApi.requestSanction(l.id, l.fingerprint) : loansApi.decideSanction(l.id, l.fingerprint, what)),
    onMutate: ({ l }) => setBusy(l.id),
    onSettled: () => setBusy(null),
    onSuccess: () => {
      toast.success("Done.");
      void queryClient.invalidateQueries({ queryKey: ["loans"] });
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not do it.")),
  });
  return (
    <>
      <PageHeader title="Loans" subtitle="Sanctioned by a different director; paid and recovered only through payroll runs" />
      <Stack>
        <Panel title="Loans">
          <DataTable<LoanView>
            rowKey="id"
            loading={loans.isLoading}
            error={loans.error}
            onRetry={() => void loans.refetch()}
            dataSource={loans.data ?? []}
            empty="No loans."
            pagination={{ pageSize: 20 }}
            columns={[
              { title: "Employee", dataIndex: "name" },
              { title: "Kind", dataIndex: "typeKey" },
              { title: "Amount", dataIndex: "principal", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "Balance", dataIndex: "balance", align: "right", render: (x: string) => formatRupees(x, 2) },
              { title: "From", dataIndex: "firstMonth", render: (x: string) => dayjs(x).format("MMM YYYY") },
              { title: "State", dataIndex: "status", render: (x: string) => <StatusChip status={x} /> },
              {
                title: "",
                key: "act",
                render: (_, l) =>
                  l.status === "DRAFT" ? (
                    <Button loading={busy === l.id} onClick={() => act.mutate({ l, what: "ASK" })}>Ask for sanction</Button>
                  ) : l.status === "WAITING" && !l.waiting?.mine ? (
                    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap" }}>
                      <Button type="primary" loading={busy === l.id} onClick={() => act.mutate({ l, what: "APPROVE" })}>Sanction</Button>
                      <Button danger loading={busy === l.id} onClick={() => act.mutate({ l, what: "REJECT" })}>Reject</Button>
                    </div>
                  ) : null,
              },
            ]}
          />
        </Panel>
        <Panel title="Loan types" subtitle="A type is Not set until every value is chosen; until then no loan of it can be sanctioned.">
          <DataTable<LoanType>
            rowKey="typeKey"
            loading={types.isLoading}
            error={types.error}
            dataSource={types.data ?? []}
            empty="No loan types. None is preset."
            pagination={false}
            columns={[
              { title: "Type", key: "t", render: (_, t) => `${t.name} (${t.typeKey})` },
              { title: "Up to", dataIndex: "maxAmount", render: (x: string | null) => (x ? formatRupees(x, 0) : "Not set") },
              { title: "Rate a year", dataIndex: "ratePercent", render: (x: string | null) => (x !== null ? `${x}%` : "Not set") },
              { title: "Still needs", dataIndex: "gaps", render: (g: string[]) => (g.length ? g.join(", ") : "Ready") },
            ]}
          />
        </Panel>
      </Stack>
    </>
  );
}
