import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import * as asksApi from "../../../../api/letterAsks";
import { apiErrorMessage } from "../../../../lib/apiError";
import { formatDate } from "../../../../lib/dates";
import { fs, fw, space, v } from "../../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, Panel, toast, useIsPhone } from "../../../../ui";

// LT-08 (M session): letters employees asked for, for the templates this person may prepare (the server decides: a director, or a template grant).
// Prepare the letter as usual ("Prepare letters"), then mark the ask done naming it, or decline with a reason; the employee is told either way.
export function LetterAsksPanel() {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const [acting, setActing] = useState<{ ask: asksApi.PreparerAsk; kind: "done" | "decline" } | null>(null);
  const [reason, setReason] = useState("");
  const [letterId, setLetterId] = useState<string | undefined>();
  const q = useQuery({ queryKey: ["letter-asks", "preparer"], queryFn: () => asksApi.preparerAsks("ASKED") });
  const act = useMutation({
    mutationFn: () => (acting!.kind === "done" ? asksApi.markAskDone(acting!.ask.id, letterId!) : asksApi.declineAsk(acting!.ask.id, reason.trim())),
    onSuccess: () => {
      toast.success(acting?.kind === "done" ? "Marked done. The employee is told." : "Declined. The employee is told why.");
      setActing(null);
      setReason("");
      setLetterId(undefined);
      void queryClient.invalidateQueries({ queryKey: ["letter-asks"] });
    },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")),
  });
  if (q.isError || (q.data && q.data.length === 0)) return null;

  const actions = (a: asksApi.PreparerAsk) => (
    <div style={{ display: "flex", gap: space[2], flexWrap: "wrap", justifyContent: phone ? "stretch" : "flex-end" }}>
      <Button danger icon={<CloseOutlined />} onClick={() => setActing({ ask: a, kind: "decline" })} block={phone}>Decline</Button>
      <Button type="primary" icon={<CheckOutlined />} disabled={a.candidates.length === 0} onClick={() => { setLetterId(a.candidates[0]?.id); setActing({ ask: a, kind: "done" }); }} block={phone}>Mark done</Button>
    </div>
  );

  return (
    <Panel title="Asked for by employees" subtitle="Prepare the letter with Prepare letters, then mark the ask done. Mark done is available once a letter for that person and template exists.">
      <DataTable<asksApi.PreparerAsk>
        rowKey="id"
        loading={q.isLoading}
        dataSource={q.data ?? []}
        pagination={false}
        empty={<EmptyState compact title="Nothing asked for" description={null} />}
        columns={[
          { title: "Employee", key: "e", render: (_, a) => <span><span style={{ fontWeight: fw.semibold }}>{a.employee.fullName}</span><span style={{ display: "block", fontSize: fs.sm, color: v.textSecondary }}>{a.employee.employeeCode}</span></span> },
          { title: "Letter", key: "t", render: (_, a) => a.template.name },
          { title: "For", dataIndex: "purpose" },
          { title: "Asked on", dataIndex: "createdAt", render: (d: string) => formatDate(d) },
          { title: "", key: "a", align: "right", render: (_, a) => actions(a) },
        ]}
        mobile={{ title: (a) => a.employee.fullName, subtitle: (a) => `${a.template.name} · ${a.purpose}`, fields: [{ label: "Asked on", render: (a) => formatDate(a.createdAt) }], actions }}
      />
      <ConfirmModal
        open={!!acting}
        onCancel={() => !act.isPending && setActing(null)}
        onConfirm={() => act.mutate()}
        loading={act.isPending}
        danger={acting?.kind === "decline"}
        confirmDisabled={acting?.kind === "decline" ? reason.trim().length < 3 : !letterId}
        title={acting?.kind === "done" ? "Mark this ask done" : "Decline this ask"}
        confirmLabel={acting?.kind === "done" ? "Mark done" : "Decline"}
        description={acting ? `${acting.ask.employee.fullName}: ${acting.ask.template.name} (${acting.ask.purpose}).` : undefined}
      >
        {acting?.kind === "done" ? (
          <Select aria-label="The letter" style={{ width: "100%" }} value={letterId} onChange={setLetterId} options={acting.ask.candidates.map((c) => ({ value: c.id, label: `${c.serial ?? "No serial yet"} · ${c.status === "ISSUED" ? "issued" : "in progress"} · ${formatDate(c.preparedAt)}` }))} />
        ) : (
          <Input.TextArea aria-label="Reason (the employee sees it)" placeholder="Reason (the employee sees it)" rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
      </ConfirmModal>
    </Panel>
  );
}
