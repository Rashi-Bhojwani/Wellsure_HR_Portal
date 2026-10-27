import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Row } from "antd";
import * as helpdeskApi from "../../../api/helpdesk";
import { Conversation, LifecycleNotice, PriorityTag, ReplyBox, StatusTag, TicketSkeleton } from "../../../components/helpdesk/HelpdeskBits";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { EmptyState, KeyValueGrid, PageHeader, Panel, Stack, errorStatus, isForbidden, toast } from "../../../ui";

// One of my tickets: the conversation, its status, and — whenever it's
// resolved or closed — exactly when it closes / until when it can be reopened.
// Live: helpdesk.ticket invalidates ["helpdesk","ticket",id], so HR's replies appear without a reload.
export function HelpdeskTicketPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, error, refetch } = useQuery({ queryKey: ["helpdesk", "ticket", id], queryFn: () => helpdeskApi.getTicket(id), retry: false });

  const refreshAfter = (updated: helpdeskApi.HelpdeskTicket) => {
    queryClient.setQueryData(["helpdesk", "ticket", id], updated);
    void queryClient.invalidateQueries({ queryKey: ["helpdesk", "mine"] });
    void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
  };
  const send = useMutation({
    mutationFn: (input: { body: string; files: File[] }) => helpdeskApi.addMessage(id, { body: input.body }, input.files),
    onSuccess: refreshAfter,
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't send your reply.")),
  });
  const reopen = useMutation({
    mutationFn: () => helpdeskApi.reopenTicket(id),
    onSuccess: (t) => {
      refreshAfter(t);
      toast.success("Ticket reopened.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't reopen the ticket.")),
  });

  if (isLoading) return <TicketSkeleton />;
  if (error || !ticket) {
    const back = <Button onClick={() => navigate("/app/helpdesk")}>Back to Helpdesk</Button>;
    if (isForbidden(error)) return <EmptyState kind="forbidden" action={back} />;
    if (errorStatus(error) === 404 || !error) return <EmptyState illustration="search" title="Ticket not found" description="It may have been removed, or the link is wrong." action={back} />;
    return <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load this ticket.")} onRetry={() => void refetch()} action={back} />;
  }

  const closedReason =
    ticket.status === "CLOSED"
      ? "This ticket is closed, so it can't take replies. Reopen it above if you still can, or raise a new ticket."
      : ticket.status === "RESOLVED" && ticket.reopenUntil && new Date(ticket.reopenUntil) < new Date()
        ? "The reopen window has passed — please raise a new ticket."
        : null;

  return (
    <>
      <PageHeader
        back="/app/helpdesk"
        title={ticket.subject}
        subtitle={`${ticket.number} · ${ticket.category.name}`}
        tags={
          <>
            <StatusTag status={ticket.status} />
            <PriorityTag priority={ticket.priority} />
          </>
        }
      />
      <Row gutter={[space[6], space[6]]}>
        <Col xs={24} lg={16}>
          <Stack>
            <LifecycleNotice ticket={ticket} viewer="raiser" onReopen={() => reopen.mutate()} reopening={reopen.isPending} />
            <Conversation
              messages={ticket.messages}
              viewer="raiser"
              composer={<ReplyBox allowInternal={false} disabledReason={closedReason} submitting={send.isPending} onSubmit={(input) => send.mutateAsync(input)} />}
            />
          </Stack>
        </Col>
        <Col xs={24} lg={8}>
          <Panel title="Details">
            <KeyValueGrid
              columns={1}
              items={[
                { label: "Ticket", value: ticket.number },
                { label: "Status", value: <StatusTag status={ticket.status} /> },
                { label: "Category", value: ticket.category.name },
                { label: "Priority", value: <PriorityTag priority={ticket.priority} /> },
                { label: "Raised", value: formatDateTime(ticket.createdAt) },
                { label: "Last update", value: formatDateTime(ticket.lastActivityAt) },
              ]}
            />
          </Panel>
        </Col>
      </Row>
    </>
  );
}
