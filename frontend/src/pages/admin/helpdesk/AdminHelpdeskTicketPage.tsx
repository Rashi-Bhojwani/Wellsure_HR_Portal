import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Form, Row, Select } from "antd";
import { HELPDESK_PRIORITIES, HELPDESK_STATUSES, type HelpdeskPriority, type HelpdeskStatus } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../../api/helpdesk";
import { Conversation, LifecycleNotice, PriorityTag, ReplyBox, SensitiveChip, StatusTag, TicketSkeleton, priorityLabel } from "../../../components/helpdesk/HelpdeskBits";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { space } from "../../../theme/tokens";
import { EmptyState, KeyValueGrid, PageHeader, Panel, Stack, errorStatus, isForbidden, toast } from "../../../ui";

const STATUS_LABEL: Record<HelpdeskStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_ON_EMPLOYEE: "Waiting on employee", RESOLVED: "Resolved", CLOSED: "Closed" };

// HR's view of one ticket: the full thread including internal notes, and
// assignment / status / priority. Opening a sensitive-category ticket is
// audit-logged by the server. Live: helpdesk.queue / helpdesk.ticket invalidate ["helpdesk","ticket"].
export function AdminHelpdeskTicketPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, error, refetch } = useQuery({ queryKey: ["helpdesk", "ticket", id], queryFn: () => helpdeskApi.getTicket(id), retry: false });
  const { data: assignees = [], isLoading: loadingAssignees } = useQuery({ queryKey: ["helpdesk", "assignees"], queryFn: helpdeskApi.listAssignees });

  const applied = (t: helpdeskApi.HelpdeskTicket) => {
    queryClient.setQueryData(["helpdesk", "ticket", id], t);
    void queryClient.invalidateQueries({ queryKey: ["helpdesk", "queue"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const update = useMutation({
    mutationFn: (input: { status?: HelpdeskStatus; priority?: HelpdeskPriority; assigneeEmployeeId?: string | null }) => helpdeskApi.updateTicket(id, input),
    onSuccess: (t) => {
      applied(t);
      toast.success("Ticket updated.");
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't update the ticket.")),
  });
  const send = useMutation({
    mutationFn: (input: { body: string; isInternalNote: boolean; files: File[] }) => helpdeskApi.addMessage(id, input, input.files),
    onSuccess: applied,
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't send.")),
  });

  if (isLoading) return <TicketSkeleton />;
  if (error || !ticket) {
    const back = <Button onClick={() => navigate("/admin/employee/helpdesk")}>Back to the queue</Button>;
    if (isForbidden(error)) return <EmptyState kind="forbidden" action={back} />;
    if (errorStatus(error) === 404 || !error) return <EmptyState illustration="search" title="Ticket not found" description="It may have been removed, or the link is wrong." action={back} />;
    return <EmptyState kind="error" description={apiErrorMessage(error, "We couldn't load this ticket.")} onRetry={() => void refetch()} action={back} />;
  }
  // Your own ticket opens in the raiser's view (the server never lets you
  // handle it) — send you to where you can see it.
  if (ticket.viewerRole === "raiser") {
    return (
      <EmptyState
        illustration="inbox"
        title="This is your own ticket"
        description="Another HR colleague handles it."
        action={
          <Button type="primary" onClick={() => navigate(`/app/helpdesk/${ticket.id}`)}>
            Open it in your Helpdesk
          </Button>
        }
      />
    );
  }

  // Which control is saving (so only that select spins).
  const saving = update.isPending ? update.variables : undefined;

  return (
    <>
      <PageHeader
        back="/admin/employee/helpdesk"
        title={ticket.subject}
        subtitle={`${ticket.number} · raised by ${ticket.raisedBy.name}`}
        tags={
          <>
            <StatusTag status={ticket.status} viewer="hr" />
            <PriorityTag priority={ticket.priority} />
            {ticket.category.isSensitive && <SensitiveChip />}
          </>
        }
      />
      <Row gutter={[space[6], space[6]]}>
        <Col xs={24} lg={16}>
          <Stack>
            <LifecycleNotice ticket={ticket} viewer="hr" />
            <Conversation messages={ticket.messages} viewer="hr" composer={<ReplyBox allowInternal submitting={send.isPending} onSubmit={(input) => send.mutateAsync(input)} />} />
          </Stack>
        </Col>
        <Col xs={24} lg={8}>
          <Stack>
            <Panel title="Manage">
              <Form layout="vertical" requiredMark={false}>
                <Form.Item label="Status" extra={ticket.status === "RESOLVED" ? undefined : "Resolving starts the auto-close countdown the employee sees."}>
                  <Select
                    aria-label="Status"
                    value={ticket.status}
                    loading={saving?.status !== undefined}
                    disabled={update.isPending}
                    onChange={(status) => update.mutate({ status })}
                    options={HELPDESK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                  />
                </Form.Item>
                <Form.Item label="Priority">
                  <Select
                    aria-label="Priority"
                    value={ticket.priority}
                    loading={saving?.priority !== undefined}
                    disabled={update.isPending}
                    onChange={(priority) => update.mutate({ priority })}
                    options={HELPDESK_PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) }))}
                  />
                </Form.Item>
                <Form.Item label="Assignee" style={{ marginBottom: 0 }}>
                  <Select
                    aria-label="Assignee"
                    allowClear
                    showSearch={{ optionFilterProp: "label" }}
                    placeholder="Unassigned"
                    value={ticket.assignee?.id}
                    loading={loadingAssignees || (saving !== undefined && "assigneeEmployeeId" in saving)}
                    disabled={update.isPending}
                    onChange={(assigneeEmployeeId) => update.mutate({ assigneeEmployeeId: assigneeEmployeeId ?? null })}
                    options={assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.employeeCode})` }))}
                  />
                </Form.Item>
              </Form>
            </Panel>
            <Panel title="Details">
              <KeyValueGrid
                columns={1}
                items={[
                  {
                    label: "Employee",
                    value: (
                      <Link to={`/admin/employee/profile/${ticket.raisedBy.id}`}>
                        {ticket.raisedBy.name} ({ticket.raisedBy.employeeCode})
                      </Link>
                    ),
                  },
                  {
                    label: "Category",
                    value: (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: space[2], flexWrap: "wrap" }}>
                        {ticket.category.name}
                        {ticket.category.isSensitive && <SensitiveChip />}
                      </span>
                    ),
                  },
                  { label: "Raised", value: formatDateTime(ticket.createdAt) },
                  { label: "Last update", value: formatDateTime(ticket.lastActivityAt) },
                ]}
              />
            </Panel>
          </Stack>
        </Col>
      </Row>
    </>
  );
}
