import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, Col, Descriptions, Flex, Form, Result, Row, Select, Tag, Typography, message } from "antd";
import { ArrowLeftOutlined, LockOutlined } from "@ant-design/icons";
import { HELPDESK_PRIORITIES, HELPDESK_STATUSES, type HelpdeskPriority, type HelpdeskStatus } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../../api/helpdesk";
import { EmptyState } from "../../../components/common/EmptyState";
import { LifecycleNotice, ReplyBox, StatusTag, Thread } from "../../../components/helpdesk/HelpdeskBits";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";

const { Title, Text } = Typography;
const STATUS_LABEL: Record<HelpdeskStatus, string> = { OPEN: "Open", IN_PROGRESS: "In progress", WAITING_ON_EMPLOYEE: "Waiting on employee", RESOLVED: "Resolved", CLOSED: "Closed" };

// HR's view of one ticket: the full thread including internal notes, and
// assignment / status / priority. Opening a sensitive-category ticket is
// audit-logged by the server.
export function AdminHelpdeskTicketPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const { data: ticket, isLoading, isError } = useQuery({ queryKey: ["helpdesk", "ticket", id], queryFn: () => helpdeskApi.getTicket(id), retry: false });
  const { data: assignees = [] } = useQuery({ queryKey: ["helpdesk", "assignees"], queryFn: helpdeskApi.listAssignees });

  const applied = (t: helpdeskApi.HelpdeskTicket) => {
    queryClient.setQueryData(["helpdesk", "ticket", id], t);
    void queryClient.invalidateQueries({ queryKey: ["helpdesk", "queue"] });
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
  };
  const update = useMutation({
    mutationFn: (input: { status?: HelpdeskStatus; priority?: HelpdeskPriority; assigneeEmployeeId?: string | null }) => helpdeskApi.updateTicket(id, input),
    onSuccess: (t) => {
      applied(t);
      void message.success("Ticket updated.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't update the ticket.")),
  });
  const send = useMutation({
    mutationFn: (input: { body: string; isInternalNote: boolean; files: File[] }) => helpdeskApi.addMessage(id, input, input.files),
    onSuccess: applied,
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't send.")),
  });

  if (isLoading) return <EmptyState message="Loading…" />;
  if (isError || !ticket) return <Result status="404" title="Ticket not found" extra={<Link to="/admin/employee/helpdesk">Back to the queue</Link>} />;
  // Your own ticket opens in the raiser's view (the server never lets you
  // handle it) — send you to where you can see it.
  if (ticket.viewerRole === "raiser") {
    return <Result status="info" title="This is your own ticket" subTitle="Another HR colleague handles it." extra={<Link to={`/app/helpdesk/${ticket.id}`}>Open it in your Helpdesk</Link>} />;
  }

  return (
    <Flex vertical gap={16}>
      <Link to="/admin/employee/helpdesk">
        <ArrowLeftOutlined /> Helpdesk queue
      </Link>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={16}>
          <Flex vertical gap={16}>
            <Card>
              <Text type="secondary">{ticket.number}</Text>
              <Title level={4} style={{ margin: "0 0 8px" }}>
                {ticket.subject}
              </Title>
              <Descriptions size="small" column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="Employee">
                  <Link to={`/admin/employee/profile/${ticket.raisedBy.id}`}>
                    {ticket.raisedBy.name} ({ticket.raisedBy.employeeCode})
                  </Link>
                </Descriptions.Item>
                <Descriptions.Item label="Category">
                  {ticket.category.name}
                  {ticket.category.isSensitive && (
                    <Tag icon={<LockOutlined />} style={{ marginLeft: 6 }}>
                      Sensitive
                    </Tag>
                  )}
                </Descriptions.Item>
                <Descriptions.Item label="Raised">{formatDateTime(ticket.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="Status">
                  <StatusTag status={ticket.status} viewer="hr" />
                </Descriptions.Item>
              </Descriptions>
              <div style={{ marginTop: 12 }}>
                <LifecycleNotice ticket={ticket} viewer="hr" />
              </div>
            </Card>
            <Card>
              <Thread messages={ticket.messages} viewer="hr" />
            </Card>
            <Card>
              <ReplyBox allowInternal submitting={send.isPending} onSubmit={(input) => send.mutateAsync(input)} />
            </Card>
          </Flex>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="Manage">
            <Form layout="vertical">
              <Form.Item label="Status" extra={ticket.status === "RESOLVED" ? undefined : "Resolving starts the auto-close countdown the employee sees."}>
                <Select
                  value={ticket.status}
                  loading={update.isPending}
                  onChange={(status) => update.mutate({ status })}
                  options={HELPDESK_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
                />
              </Form.Item>
              <Form.Item label="Priority">
                <Select
                  value={ticket.priority}
                  loading={update.isPending}
                  onChange={(priority) => update.mutate({ priority })}
                  options={HELPDESK_PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))}
                />
              </Form.Item>
              <Form.Item label="Assignee" style={{ marginBottom: 0 }}>
                <Select
                  allowClear
                  showSearch={{ optionFilterProp: "label" }}
                  placeholder="Unassigned"
                  value={ticket.assignee?.id}
                  loading={update.isPending}
                  onChange={(assigneeEmployeeId) => update.mutate({ assigneeEmployeeId: assigneeEmployeeId ?? null })}
                  options={assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.employeeCode})` }))}
                />
              </Form.Item>
            </Form>
          </Card>
        </Col>
      </Row>
    </Flex>
  );
}
