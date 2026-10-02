import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Descriptions, Flex, Form, Input, Modal, Tooltip, Typography, message } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import * as accessApi from "../../api/access";
import type { SecurityEvent } from "../../api/access";
import { useAuth } from "../../hooks/useAuth";
import { apiErrorMessage } from "../../lib/apiError";
import { formatDateTime } from "../../lib/dates";
import { useSocket } from "../../sockets/SocketProvider";

const { Text } = Typography;

// Phase 5 commit E1.1: a break-glass tool (admin:recover / admin:bootstrap)
// was used from a server shell. Every Super Admin sees this on every admin
// page until a Super Admin OTHER than the account's owner acknowledges it,
// saying what they checked. Live via the security.event socket signal.
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
    mutationFn: (v: { id: string; note: string }) => accessApi.acknowledgeSecurityEvent(v.id, v.note),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["access", "security-events"] });
      setOpen(null);
      form.resetFields();
      void message.success("Acknowledged — recorded in the audit log.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't acknowledge it.")),
  });

  if (!isSuperAdmin || events.length === 0) return null;
  return (
    <Flex vertical gap={8} style={{ marginBottom: 16 }}>
      {events.map((e) => (
        <Alert
          key={e.id}
          type="error"
          showIcon
          icon={<SafetyOutlined />}
          title={`Security: ${e.summary}`}
          description={`${formatDateTime(e.createdAt)} · run by "${e.details.operator ?? "?"}" on ${e.details.origin?.hostname ?? "?"} · reason: ${e.details.reason ?? "—"}`}
          action={
            <Tooltip title={e.youAreTarget ? "This was done to your own account — another Super Admin has to acknowledge it." : undefined}>
              <Button size="small" danger disabled={e.youAreTarget} onClick={() => setOpen(e)}>
                Review & acknowledge
              </Button>
            </Tooltip>
          }
        />
      ))}
      <Modal title="Acknowledge security event" open={open !== null} okText="Acknowledge" onOk={() => form.submit()} confirmLoading={ack.isPending} onCancel={() => setOpen(null)} destroyOnHidden>
        {open && (
          <>
            <Descriptions size="small" column={1} bordered>
              <Descriptions.Item label="What">{open.summary}</Descriptions.Item>
              <Descriptions.Item label="When">{formatDateTime(open.createdAt)}</Descriptions.Item>
              <Descriptions.Item label="Operator (self-declared)">{open.details.operator ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="Machine">{`${open.details.origin?.hostname ?? "?"} (${open.details.origin?.appEnv ?? "?"})`}</Descriptions.Item>
              <Descriptions.Item label="Reason">{open.details.reason ?? "—"}</Descriptions.Item>
              {open.details.justification && <Descriptions.Item label="Why not in the app">{open.details.justification}</Descriptions.Item>}
              <Descriptions.Item label="Alert emailed to">{(open.details.emailed ?? []).join(", ") || "nobody"}</Descriptions.Item>
            </Descriptions>
            <Text type="secondary" style={{ display: "block", margin: "12px 0" }}>
              Only acknowledge once you've confirmed with the person concerned that this was expected. If it wasn't, treat it as an incident.
            </Text>
            <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => ack.mutate({ id: open.id, note: v.note })}>
              <Form.Item name="note" label="What you checked" rules={[{ required: true, min: 3, message: "Say what you checked." }]}>
                <Input.TextArea rows={2} maxLength={500} />
              </Form.Item>
            </Form>
          </>
        )}
      </Modal>
    </Flex>
  );
}
