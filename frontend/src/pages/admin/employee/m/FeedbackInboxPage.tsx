import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input, Segmented } from "antd";
import * as api from "../../../../api/feedback";
import { apiErrorMessage } from "../../../../lib/apiError";
import { formatDate } from "../../../../lib/dates";
import { fs, space, v } from "../../../../theme/tokens";
import { EmptyState, PageHeader, Panel, QueryState, Stack, StatusChip, toast } from "../../../../ui";

// M session block 2, SS-13: feedback from employees. Named feedback can be answered; feedback without a name cannot (nothing links it to anyone).
export function FeedbackInboxPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<"OPEN" | "CLOSED">("OPEN");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const q = useQuery({ queryKey: ["feedback", "hr", status], queryFn: () => api.listFeedback(status) });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["feedback", "hr"] });
  const reply = useMutation({ mutationFn: ({ id, message }: { id: string; message: string }) => api.replyFeedback(id, message), onSuccess: (_, { id }) => { toast.success("Replied. The sender is told."); setDrafts((d) => ({ ...d, [id]: "" })); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not reply.")) });
  const close = useMutation({ mutationFn: api.closeFeedback, onSuccess: () => { toast.success("Closed."); refresh(); }, onError: (e) => toast.error(apiErrorMessage(e, "Could not close it.")) });
  return (
    <>
      <PageHeader title="Employee feedback" subtitle="Suggestions and concerns from employees. Feedback without a name cannot be answered." actions={<Segmented value={status} onChange={(x) => setStatus(x as "OPEN" | "CLOSED")} options={[{ value: "OPEN", label: "Open" }, { value: "CLOSED", label: "Closed" }]} aria-label="Which feedback" />} />
      <QueryState isLoading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} isEmpty={(q.data?.length ?? 0) === 0} empty={<EmptyState title={status === "OPEN" ? "No open feedback" : "No closed feedback"} description={null} />}>
        <Stack>
          {q.data?.map((f) => (
            <Panel key={f.id} title={`${api.CATEGORY_LABEL[f.category]} · ${f.from ? `${f.from.fullName} (${f.from.employeeCode})` : "Without a name"}`} subtitle={formatDate(f.createdAt)} extra={f.status === "OPEN" ? <Button onClick={() => close.mutate(f.id)} loading={close.isPending && close.variables === f.id}>Close</Button> : <StatusChip tone="neutral">Closed</StatusChip>}>
              <p style={{ marginTop: 0, whiteSpace: "pre-wrap" }}>{f.message}</p>
              {f.replies.map((r, i) => (
                <div key={i} style={{ borderLeft: `3px solid ${v.borderDefault}`, paddingLeft: space[3], marginTop: space[2] }}>
                  <div style={{ fontSize: fs.sm, color: v.textSecondary }}>Reply · {formatDate(r.at)}</div>
                  <div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>
                </div>
              ))}
              {f.from && f.status === "OPEN" && (
                <div style={{ display: "flex", gap: space[2], marginTop: space[3], flexWrap: "wrap" }}>
                  <Input.TextArea aria-label="Reply" placeholder="Reply (the sender sees it)" rows={2} maxLength={2000} value={drafts[f.id] ?? ""} onChange={(e) => setDrafts((d) => ({ ...d, [f.id]: e.target.value }))} style={{ flex: 1, minWidth: 220 }} />
                  <Button type="primary" disabled={(drafts[f.id] ?? "").trim().length < 2} loading={reply.isPending && reply.variables?.id === f.id} onClick={() => reply.mutate({ id: f.id, message: drafts[f.id]!.trim() })}>Reply</Button>
                </div>
              )}
            </Panel>
          ))}
        </Stack>
      </QueryState>
    </>
  );
}
