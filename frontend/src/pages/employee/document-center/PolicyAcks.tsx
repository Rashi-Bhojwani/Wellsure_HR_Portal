import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { CheckOutlined } from "@ant-design/icons";
import * as acksApi from "../../../api/documentAcks";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDate } from "../../../lib/dates";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, StatusChip, toast, useIsPhone } from "../../../ui";

// M session block 2, ER-18: the policies HR asked this person to read and acknowledge. Shown only when there is at least one.
export function PolicyAcks({ onOpen }: { onOpen?: (id: string) => void }) {
  const phone = useIsPhone();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ["document-acks", "mine"], queryFn: acksApi.myAcks });
  const ack = useMutation({
    mutationFn: acksApi.acknowledge,
    onSuccess: () => { toast.success("Acknowledged. HR can see that you have read it."); void queryClient.invalidateQueries({ queryKey: ["document-acks"] }); },
    onError: (e) => toast.error(apiErrorMessage(e, "Could not record it.")),
  });
  const docs = q.data ?? [];
  const waiting = docs.filter((d) => !d.acknowledgedAt);
  if (!docs.length) return null;
  return (
    <ApprovalBanner
      tone={waiting.length ? "warning" : "success"}
      title={waiting.length ? `${waiting.length} polic${waiting.length === 1 ? "y" : "ies"} to read and acknowledge` : "You have acknowledged every policy asked of you"}
      description={<>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
        {docs.map((d) => (
          <li key={d.id} style={{ display: "flex", gap: space[2], alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{d.title}</span>
            {d.acknowledgedAt ? (
              <StatusChip tone="success">Acknowledged {formatDate(d.acknowledgedAt)}</StatusChip>
            ) : (
              <span style={{ display: "flex", gap: space[2], flexWrap: "wrap", width: phone ? "100%" : undefined }}>
                {onOpen && <Button onClick={() => onOpen(d.id)} block={phone}>Read it</Button>}
                <Button type="primary" icon={<CheckOutlined />} loading={ack.isPending && ack.variables === d.id} onClick={() => ack.mutate(d.id)} block={phone} aria-label={`I have read and acknowledge ${d.title}`}>I have read it</Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {waiting.length > 0 && <p style={{ margin: `${space[2]}px 0 0`, fontSize: fs.sm, color: v.textSecondary }}>Acknowledging records the date and time; it cannot be undone.</p>}
      </>}
      style={{ marginBottom: space[3] }}
    />
  );
}
