import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as helpdeskApi from "../../../api/helpdesk";
import type { HelpdeskCategoryAdmin } from "../../../api/helpdesk";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;

// Admin Tools → Helpdesk Categories. The sensitive flag is per category and
// editable any time (user decision 4): a sensitive category's tickets are
// visible only to holders of helpdesk.sensitive.view (HR_ADMIN by default),
// and flipping it applies to existing tickets immediately. Categories are
// deactivated, never deleted. Every change is audit-logged.
export function HelpdeskCategoriesPage() {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ code: string; name: string; isSensitive: boolean; sortOrder?: number; defaultAssigneeEmployeeId?: string }>();
  const { data = [], isLoading } = useQuery({ queryKey: ["helpdesk", "categories", "all"], queryFn: helpdeskApi.listAllCategories });
  const { data: assignees = [] } = useQuery({ queryKey: ["helpdesk", "assignees"], queryFn: helpdeskApi.listAssignees });
  const assigneeOptions = assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.employeeCode})` }));

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Parameters<typeof helpdeskApi.updateCategory>[1] }) => helpdeskApi.updateCategory(id, input),
    onSuccess: () => {
      refresh();
      void message.success("Category updated.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't update the category.")),
  });
  const create = useMutation({
    mutationFn: helpdeskApi.createCategory,
    onSuccess: () => {
      refresh();
      setCreating(false);
      form.resetFields();
      void message.success("Category created.");
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't create the category.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Title level={3} style={{ margin: 0 }}>
          Helpdesk Categories
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          Add category
        </Button>
      </Space>
      <Alert
        type="info"
        showIcon
        title="Sensitive categories"
        description="Tickets in a sensitive category are hidden from HR Executives and visible only to roles with the sensitive-ticket permission (HR Admin by default). Changing the flag applies to existing tickets straight away."
      />
      <Table<HelpdeskCategoryAdmin>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        locale={{ emptyText: <EmptyState message="No categories yet." /> }}
        columns={[
          { title: "Name", dataIndex: "name", render: (v: string, c) => (<div><Text strong>{v}</Text><div><Text type="secondary" style={{ fontSize: fs.sm }}>{c.code}</Text></div></div>) },
          {
            title: "Sensitive",
            dataIndex: "isSensitive",
            render: (v: boolean, c) => <Switch checked={v} aria-label={`Sensitive: ${c.name}`} onChange={(isSensitive) => update.mutate({ id: c.id, input: { isSensitive } })} />,
          },
          {
            title: "Default assignee",
            key: "defaultAssignee",
            render: (_: unknown, c) => (
              <Select
                allowClear
                style={{ minWidth: 220 }}
                placeholder="Nobody (queue)"
                value={c.defaultAssignee?.id}
                options={assigneeOptions}
                onChange={(v) => update.mutate({ id: c.id, input: { defaultAssigneeEmployeeId: v ?? null } })}
              />
            ),
          },
          { title: "Tickets", dataIndex: "ticketCount" },
          {
            title: "Active",
            dataIndex: "isActive",
            render: (v: boolean, c) => <Switch checked={v} aria-label={`Active: ${c.name}`} onChange={(isActive) => update.mutate({ id: c.id, input: { isActive } })} />,
          },
        ]}
      />
      <Modal title="Add category" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false} initialValues={{ isSensitive: false }} onFinish={(values) => create.mutate(values)}>
          <Form.Item name="name" label="Name" rules={[{ required: true, max: 80 }]}>
            <Input />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Z0-9_]+$/, message: "Capital letters, digits and underscores." }]}>
            <Input placeholder="e.g. TRAVEL" />
          </Form.Item>
          <Form.Item name="isSensitive" label="Sensitive" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item name="defaultAssigneeEmployeeId" label="Default assignee">
            <Select allowClear placeholder="Nobody (queue)" options={assigneeOptions} />
          </Form.Item>
          <Form.Item name="sortOrder" label="Sort order">
            <InputNumber min={0} max={999} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
