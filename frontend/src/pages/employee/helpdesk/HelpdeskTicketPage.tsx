import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Descriptions, Flex, Result, Space, Typography, message } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import * as helpdeskApi from "../../../api/helpdesk";
import { EmptyState } from "../../../components/common/EmptyState";
import { LifecycleNotice, PriorityTag, ReplyBox, StatusTag, Thread } from "../../../components/helpdesk/HelpdeskBits";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";

const { Title, Text } = Typography;

// One of my tickets: the conversation, its status, and — whenever it's
// resolved or closed — exactly when it closes / until when it can be reopened.
export function HelpdeskTicketPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, isError } = useQuery({ queryKey: ["helpdesk", "ticket", id], queryFn: () => helpdeskApi.getTicket(id), retry: false });

  const refreshAfter = (updated: helpdeskApi.HelpdeskTicket) => {
    queryClient.setQueryData(["helpdesk", "ticket", id], updated);
    void queryClient.invalidateQueries({ queryKey: ["helpdesk", "mine"] });
    void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
  };
  const send = useMutation({
    mutationFn: (input: { body: string; files: File[] }) => helpdeskApi.addMessage(id, { body: input.body }, input.files),
    onSuccess: refreshAfter,
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't send your reply.")),
  });
  const reopen = useMutation({
    mutationFn: () => helpdeskApi.reopenTicket(id),
    onSuccess: (t) => {
      refreshAfter(t);
      void message.success("Ticket reopened.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't reopen the ticket.")),
  });

  if (isLoading) return <EmptyState message="Loading…" />;
  if (isError || !ticket) return <Result status="404" title="Ticket not found" extra={<Link to="/app/helpdesk">Back to Helpdesk</Link>} />;

  const closedReason =
    ticket.status === "CLOSED"
      ? "This ticket is closed, so it can't take replies. Reopen it above if you still can, or raise a new ticket."
      : ticket.status === "RESOLVED" && ticket.reopenUntil && new Date(ticket.reopenUntil) < new Date()
        ? "The reopen window has passed — please raise a new ticket."
        : null;

  return (
    <Flex vertical gap={16}>
      <Link to="/app/helpdesk">
        <ArrowLeftOutlined /> All tickets
      </Link>
      <Card>
        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <div>
            <Text type="secondary">{ticket.number}</Text>
            <Title level={4} style={{ margin: 0 }}>
              {ticket.subject}
            </Title>
          </div>
          <Descriptions size="small" column={{ xs: 1, sm: 2, md: 4 }}>
            <Descriptions.Item label="Status">
              <StatusTag status={ticket.status} />
            </Descriptions.Item>
            <Descriptions.Item label="Category">{ticket.category.name}</Descriptions.Item>
            <Descriptions.Item label="Priority">
              <PriorityTag priority={ticket.priority} />
            </Descriptions.Item>
            <Descriptions.Item label="Raised">{formatDateTime(ticket.createdAt)}</Descriptions.Item>
          </Descriptions>
          <LifecycleNotice ticket={ticket} viewer="raiser" onReopen={() => reopen.mutate()} reopening={reopen.isPending} />
        </Space>
      </Card>
      <Card>
        <Thread messages={ticket.messages} viewer="raiser" />
      </Card>
      <Card>
        <ReplyBox allowInternal={false} disabledReason={closedReason} submitting={send.isPending} onSubmit={(input) => send.mutateAsync(input)} />
      </Card>
    </Flex>
  );
}
