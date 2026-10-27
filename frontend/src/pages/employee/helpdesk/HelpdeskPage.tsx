import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Segmented, Select } from "antd";
import type { UploadFile } from "antd";
import { CheckCircleOutlined, ClockCircleOutlined, CustomerServiceOutlined, MessageOutlined, PlusOutlined } from "@ant-design/icons";
import { HELPDESK_PRIORITIES, type HelpdeskPriority } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../../api/helpdesk";
import type { HelpdeskTicketSummary } from "../../../api/helpdesk";
import { AttachmentPicker, StatusTag, priorityLabel } from "../../../components/helpdesk/HelpdeskBits";
import { lifecycleHint, toFiles } from "../../../components/helpdesk/helpdeskUtils";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs, fw, v } from "../../../theme/tokens";
import { CardGrid, DataTable, EmptyState, FilterBar, PageHeader, Panel, SideDrawer, Stack, StatCard, toast } from "../../../ui";

type View = "open" | "closed" | "all";
type RaiseValues = { categoryId: string; subject: string; body: string; priority: HelpdeskPriority };
const FORM_ID = "raise-ticket-form";
const PAGE_SIZE = 20;

function RaiseTicketDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<RaiseValues>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const { data: categories = [], isLoading: loadingCategories } = useQuery({ queryKey: ["helpdesk", "categories"], queryFn: helpdeskApi.listCategories, enabled: open });

  const raise = useMutation({
    mutationFn: (values: RaiseValues) => helpdeskApi.raiseTicket(values, toFiles(files)),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ["helpdesk", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
      toast.success(`Ticket ${ticket.number} raised.`);
      form.resetFields();
      setFiles([]);
      onClose();
      navigate(`/app/helpdesk/${ticket.id}`);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Couldn't raise the ticket.")),
  });

  return (
    <SideDrawer
      open={open}
      onClose={onClose}
      title="Raise a ticket"
      subtitle="Replies from HR appear in the ticket's conversation."
      formId={FORM_ID}
      primaryLabel="Raise ticket"
      primaryLoading={raise.isPending}
    >
      <Form id={FORM_ID} form={form} layout="vertical" requiredMark initialValues={{ priority: "NORMAL" }} onFinish={(values) => raise.mutate(values)}>
        <Form.Item name="categoryId" label="Category" rules={[{ required: true, message: "Choose a category." }]}>
          <Select placeholder="What is it about?" loading={loadingCategories} options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </Form.Item>
        <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 3, max: 200, message: "A short subject (3–200 characters)." }]}>
          <Input maxLength={200} placeholder="e.g. Payslip for August is missing" />
        </Form.Item>
        <Form.Item name="body" label="Describe the issue" rules={[{ required: true, message: "Tell HR what you need." }]}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 10 }} maxLength={5000} showCount />
        </Form.Item>
        <Form.Item name="priority" label="Priority">
          <Segmented block options={HELPDESK_PRIORITIES.map((p) => ({ value: p, label: priorityLabel(p) }))} />
        </Form.Item>
        <Form.Item label="Attachments" extra="PDF, image, Word or Excel. Photos are cleaned of location and camera details before they're stored.">
          <AttachmentPicker files={files} onChange={setFiles} />
        </Form.Item>
      </Form>
    </SideDrawer>
  );
}

// Helpdesk (spec §6): my tickets, newest activity first, and Raise ticket.
// `?raise=1` (the header's "Raise a Helpdesk Ticket" quick link) opens the
// raise drawer straight away. Live: helpdesk.ticket invalidates ["helpdesk","mine"].
export function HelpdeskPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("open");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [raising, setRaising] = useState(params.get("raise") === "1");
  const closeRaise = () => {
    setRaising(false);
    if (params.has("raise")) setParams({}, { replace: true });
  };
  const { data = [], isLoading, error, refetch } = useQuery({ queryKey: ["helpdesk", "mine"], queryFn: () => helpdeskApi.listMyTickets() });

  const counts = useMemo(
    () => ({
      active: data.filter((t) => t.status !== "CLOSED").length,
      waiting: data.filter((t) => t.status === "WAITING_ON_EMPLOYEE").length,
      resolved: data.filter((t) => t.status === "RESOLVED").length,
      closed: data.filter((t) => t.status === "CLOSED").length,
    }),
    [data],
  );
  const q = search.trim().toLowerCase();
  const rows = data
    .filter((t) => (view === "all" ? true : view === "open" ? t.status !== "CLOSED" : t.status === "CLOSED"))
    .filter((t) => !q || t.subject.toLowerCase().includes(q) || t.number.toLowerCase().includes(q) || t.category.name.toLowerCase().includes(q));
  const changeView = (next: View) => {
    setView(next);
    setPage(1);
  };
  const open = (t: HelpdeskTicketSummary) => navigate(`/app/helpdesk/${t.id}`);
  const raiseButton = (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setRaising(true)}>
      Raise ticket
    </Button>
  );

  return (
    <>
      <PageHeader title="Helpdesk" subtitle="Ask HR for help and follow every reply in one place" actions={raiseButton} />
      <Stack>
        <CardGrid min={200}>
          <StatCard variant="compact" label="Active tickets" value={counts.active} loading={isLoading} icon={<MessageOutlined />} tone="info" onClick={() => changeView("open")} />
          <StatCard variant="compact" label="Waiting on you" value={counts.waiting} loading={isLoading} icon={<ClockCircleOutlined />} tone="warning" onClick={() => changeView("open")} />
          <StatCard variant="compact" label="Resolved" value={counts.resolved} loading={isLoading} icon={<CheckCircleOutlined />} tone="accent" onClick={() => changeView("open")} />
          <StatCard variant="compact" label="Closed" value={counts.closed} loading={isLoading} icon={<CustomerServiceOutlined />} tone="neutral" onClick={() => changeView("closed")} />
        </CardGrid>
        <Panel title="My tickets">
          <FilterBar
            onSearch={(s) => {
              setSearch(s);
              setPage(1);
            }}
            searchPlaceholder="Search subject, ticket or category"
            actions={
              <Segmented<View>
                value={view}
                onChange={changeView}
                aria-label="Which tickets"
                options={[
                  { value: "open", label: "Active" },
                  { value: "closed", label: "Closed" },
                  { value: "all", label: "All" },
                ]}
              />
            }
          />
          <DataTable<HelpdeskTicketSummary>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={rows}
            pagination={{ current: page, pageSize: PAGE_SIZE, total: rows.length, onChange: setPage, hideOnSinglePage: true }}
            onRowOpen={open}
            empty={
              q ? (
                <EmptyState kind="empty" illustration="search" title="No tickets match" description="Try a different word, or clear the search." compact />
              ) : (
                <EmptyState
                  illustration="inbox"
                  title={view === "open" ? "No active tickets" : "No tickets here"}
                  description={view === "open" ? "Need something from HR? Raise a ticket." : null}
                  action={view === "open" ? raiseButton : undefined}
                  compact
                />
              )
            }
            columns={[
              { title: "Ticket", dataIndex: "number", width: 120, render: (n: string) => <span style={{ color: v.textSecondary, fontVariantNumeric: "tabular-nums" }}>{n}</span> },
              {
                title: "Subject",
                dataIndex: "subject",
                render: (_: string, t) => (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{t.subject}</div>
                    {lifecycleHint(t) && <div style={{ color: v.textSecondary, fontSize: fs.sm, marginTop: 2 }}>{lifecycleHint(t)}</div>}
                  </div>
                ),
              },
              { title: "Category", key: "category", render: (_: unknown, t) => t.category.name },
              { title: "Status", dataIndex: "status", render: (_: unknown, t) => <StatusTag status={t.status} /> },
              { title: "Last update", dataIndex: "lastActivityAt", render: (d: string) => formatDateTime(d) },
            ]}
            mobile={{
              title: (t) => t.subject,
              subtitle: (t) => `${t.number} · ${t.category.name}`,
              status: (t) => <StatusTag status={t.status} />,
              fields: [
                { label: "Last update", render: (t) => formatDateTime(t.lastActivityAt) },
                { label: "Note", render: (t) => lifecycleHint(t) ?? "—" },
              ],
            }}
          />
        </Panel>
      </Stack>
      <RaiseTicketDrawer open={raising} onClose={closeRaise} />
    </>
  );
}
