import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Flex, Form, Input, Modal, Segmented, Select, Table, Typography, message } from "antd";
import type { UploadFile } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import { HELPDESK_PRIORITIES, type HelpdeskPriority } from "@shared/constants/helpdesk";
import * as helpdeskApi from "../../../api/helpdesk";
import type { HelpdeskTicketSummary } from "../../../api/helpdesk";
import { EmptyState } from "../../../components/common/EmptyState";
import { AttachmentPicker, StatusTag } from "../../../components/helpdesk/HelpdeskBits";
import { lifecycleHint, toFiles } from "../../../components/helpdesk/helpdeskUtils";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs } from "../../../theme/tokens";

const { Text } = Typography;

type View = "open" | "closed" | "all";

function RaiseTicketModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<{ categoryId: string; subject: string; body: string; priority: HelpdeskPriority }>();
  const [files, setFiles] = useState<UploadFile[]>([]);
  const { data: categories = [] } = useQuery({ queryKey: ["helpdesk", "categories"], queryFn: helpdeskApi.listCategories, enabled: open });

  const raise = useMutation({
    mutationFn: (values: { categoryId: string; subject: string; body: string; priority: HelpdeskPriority }) => helpdeskApi.raiseTicket(values, toFiles(files)),
    onSuccess: (ticket) => {
      void queryClient.invalidateQueries({ queryKey: ["helpdesk", "mine"] });
      void queryClient.invalidateQueries({ queryKey: ["request-hub"] });
      void message.success(`Ticket ${ticket.number} raised.`);
      form.resetFields();
      setFiles([]);
      onClose();
      navigate(`/app/helpdesk/${ticket.id}`);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't raise the ticket.")),
  });

  return (
    <Modal title="Raise a ticket" open={open} onCancel={onClose} onOk={() => form.submit()} okText="Raise ticket" confirmLoading={raise.isPending} destroyOnHidden>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ priority: "NORMAL" }} onFinish={(values) => raise.mutate(values)}>
        <Form.Item name="categoryId" label="Category" rules={[{ required: true, message: "Choose a category." }]}>
          <Select placeholder="What is it about?" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        </Form.Item>
        <Form.Item name="subject" label="Subject" rules={[{ required: true, min: 3, max: 200, message: "A short subject (3–200 characters)." }]}>
          <Input maxLength={200} />
        </Form.Item>
        <Form.Item name="body" label="Describe the issue" rules={[{ required: true, message: "Tell HR what you need." }]}>
          <Input.TextArea rows={4} maxLength={5000} />
        </Form.Item>
        <Form.Item name="priority" label="Priority">
          <Select options={HELPDESK_PRIORITIES.map((p) => ({ value: p, label: p.charAt(0) + p.slice(1).toLowerCase() }))} style={{ maxWidth: 200 }} />
        </Form.Item>
        <Form.Item label="Attachments" extra="PDF, image, Word or Excel. Photos are cleaned of location and camera details before they're stored.">
          <AttachmentPicker files={files} onChange={setFiles} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

// Helpdesk (spec §6): my tickets, newest activity first, and Raise ticket.
// `?raise=1` (the header's "Raise a Helpdesk Ticket" quick link) opens the
// raise dialog straight away.
export function HelpdeskPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<View>("open");
  const [raising, setRaising] = useState(params.get("raise") === "1");
  const closeRaise = () => {
    setRaising(false);
    if (params.has("raise")) setParams({}, { replace: true });
  };
  const { data = [], isLoading } = useQuery({ queryKey: ["helpdesk", "mine"], queryFn: () => helpdeskApi.listMyTickets() });

  const rows = data.filter((t) => (view === "all" ? true : view === "open" ? t.status !== "CLOSED" : t.status === "CLOSED"));

  return (
    <Card>
      <Flex justify="space-between" align="center" wrap gap={12} style={{ marginBottom: 16 }}>
        <Segmented<View>
          value={view}
          onChange={setView}
          options={[
            { value: "open", label: "Active" },
            { value: "closed", label: "Closed" },
            { value: "all", label: "All" },
          ]}
        />
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setRaising(true)}>
          Raise ticket
        </Button>
      </Flex>
      <Table<HelpdeskTicketSummary>
        rowKey="id"
        loading={isLoading}
        dataSource={rows}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
        scroll={{ x: true }}
        onRow={(t) => ({ onClick: () => navigate(`/app/helpdesk/${t.id}`), style: { cursor: "pointer" } })}
        locale={{ emptyText: <EmptyState message={view === "open" ? "No active tickets. Need something from HR? Raise a ticket." : "No tickets here."} /> }}
        columns={[
          { title: "Ticket", dataIndex: "number", width: 110 },
          {
            title: "Subject",
            dataIndex: "subject",
            render: (_: string, t) => (
              <div>
                <Text strong>{t.subject}</Text>
                {lifecycleHint(t) && (
                  <div>
                    <Text type="secondary" style={{ fontSize: fs.sm }}>
                      {lifecycleHint(t)}
                    </Text>
                  </div>
                )}
              </div>
            ),
          },
          { title: "Category", key: "category", render: (_: unknown, t) => t.category.name },
          { title: "Status", dataIndex: "status", render: (_: unknown, t) => <StatusTag status={t.status} /> },
          { title: "Last update", dataIndex: "lastActivityAt", render: (v: string) => formatDateTime(v) },
        ]}
      />
      <RaiseTicketModal open={raising} onClose={closeRaise} />
    </Card>
  );
}
