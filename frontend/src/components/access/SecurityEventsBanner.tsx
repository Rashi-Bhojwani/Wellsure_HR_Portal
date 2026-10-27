import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Tooltip } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import * as accessApi from "../../api/access";
import type { SecurityEvent } from "../../api/access";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { useSocket } from "../../sockets/SocketProvider";
import { radius, space, v } from "../../theme/tokens";
import { ApprovalBanner } from "../../ui/ApprovalBanner";
import { ConfirmModal } from "../../ui/ConfirmModal";
import { KeyValueGrid } from "../../ui/FormSection";
import { toast } from "../../ui/Toast";

// Phase 5 commit E1.1: a break-glass tool (admin:recover / admin:bootstrap)
// was used from a server shell. Every Super Admin sees this on every admin
// page until a Super Admin OTHER than the account's owner acknowledges it,
// saying what they checked. Live via the security.event socket signal.
// Acknowledging is audited: the modal waits for the server before closing.
export function SecurityEventsBanner() {
  const { hasRole } = useAuth();
  const isSuperAdmin = hasRole("SUPER_ADMIN");
  const queryClient = useQueryClient();
  const { socket } = useSocket();
  const { data: events = [] } = useQuery({ queryKey: ["access", "security-events", "open"], queryFn: () => accessApi.listSecurityEvents("open"), enabled: isSuperAdmin, refetchInterval: 60_000 });
  const [open, setOpen] = useState<SecurityEvent | null>(null);
  const [form] = Form.useForm<{ note: string }>();

  useEffect(() => {
    if (!socket || !isSuperAdmin) return;
    const onEvent = () => void queryClient.invalidateQueries({ queryKey: ["access", "security-events"] });
    socket.on("security.event", onEvent);
    return () => {
      socket.off("security.event", onEvent);
    };
  }, [socket, isSuperAdmin, queryClient]);

  const ack = useMutation({
    mutationFn: (vars: { id: string; note: string }) => accessApi.acknowledgeSecurityEvent(vars.id, vars.note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["access", "security-events"] });
      setOpen(null);
      form.resetFields();
      toast.success("Acknowledged — recorded in the audit log.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't acknowledge it.")),
  });

  if (!isSuperAdmin || events.length === 0) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: space[2], marginBottom: space[4] }}>
      {events.map((e) => (
        <ApprovalBanner
          key={e.id}
          tone="danger"
          icon={<SafetyOutlined />}
          title={`Security: ${e.summary}`}
          description={`${formatDateTime(e.createdAt)} · run by "${e.details.operator ?? "?"}" on ${e.details.origin?.hostname ?? "?"} · reason: ${e.details.reason ?? "—"}`}
          actions={
            <Tooltip title={e.youAreTarget ? "This was done to your own account — another Super Admin has to acknowledge it." : undefined}>
              {/* A span keeps the tooltip reachable when the button is disabled. */}
              <span tabIndex={e.youAreTarget ? 0 : -1} style={{ display: "inline-flex" }}>
                <Button danger disabled={e.youAreTarget} onClick={() => { form.resetFields(); setOpen(e); }}>
                  Review & acknowledge
                </Button>
              </span>
            </Tooltip>
          }
        />
      ))}
      <ConfirmModal
        open={open !== null}
        onCancel={() => !ack.isPending && setOpen(null)}
        onConfirm={() => form.submit()}
        title="Acknowledge security event"
        description="Only acknowledge once you've confirmed with the person concerned that this was expected. If it wasn't, treat it as an incident."
        confirmLabel="Acknowledge"
        loading={ack.isPending}
        width={560}
      >
        {open && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
            <div style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: space[4], background: v.bgSubtle }}>
              <KeyValueGrid
                columns={1}
                items={[
                  { label: "What", value: open.summary },
                  { label: "When", value: formatDateTime(open.createdAt) },
                  { label: "Operator (self-declared)", value: open.details.operator ?? "—" },
                  { label: "Machine", value: `${open.details.origin?.hostname ?? "?"} (${open.details.origin?.appEnv ?? "?"})` },
                  { label: "Reason", value: open.details.reason ?? "—" },
                  ...(open.details.justification ? [{ label: "Why not in the app", value: open.details.justification }] : []),
                  { label: "Alert emailed to", value: (open.details.emailed ?? []).join(", ") || "nobody" },
                ]}
              />
            </div>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={(vals) => ack.mutate({ id: open.id, note: vals.note })}>
              <Form.Item name="note" label="What you checked" rules={[{ required: true, min: 3, message: "Say what you checked." }]} style={{ marginBottom: 0 }}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Form>
          </div>
        )}
      </ConfirmModal>
    </div>
  );
}
