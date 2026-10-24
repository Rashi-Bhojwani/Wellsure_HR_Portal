import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Space, Switch, Table, Tag, Typography, message } from "antd";
import { PlusOutlined } from "@ant-design/icons";
import * as lettersApi from "../../../api/letters";
import type { LetterTemplateSummary } from "../../../api/letters";
import { EmptyState } from "../../../components/common/EmptyState";
import { apiErrorMessage } from "../../../lib/apiError";
import { formatDateTime } from "../../../lib/dates";
import { fs } from "../../../theme/tokens";

const { Title, Text } = Typography;

// Admin Tools → Email & Letter Templates (Phase 5 commit D2). Letters only
// for now; making the system emails editable is its own later commit.
export function LetterTemplatesPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm<{ code: string; name: string; description?: string }>();
  const { data = [], isLoading } = useQuery({ queryKey: ["letters", "templates"], queryFn: lettersApi.listTemplates });

  const toggle = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => lettersApi.updateTemplate(id, { isActive }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["letters", "templates"] }),
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't update the template.")),
  });
  const create = useMutation({
    mutationFn: (values: { code: string; name: string; description?: string }) =>
      lettersApi.createTemplate({ ...values, bodyHtml: "<p>Dear {{employee.fullName}},</p><p></p><p>{{signatory.name}}<br>{{signatory.designation}}</p>", extraFields: [] }),
    onSuccess: (t) => {
      void queryClient.invalidateQueries({ queryKey: ["letters", "templates"] });
      setCreating(false);
      form.resetFields();
      navigate(`/admin/admin-tools/templates/${t.id}`);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Couldn't create the template.")),
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Space style={{ width: "100%", justifyContent: "space-between" }} wrap>
        <Title level={3} style={{ margin: 0 }}>
          Email & Letter Templates
        </Title>
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
          New letter template
        </Button>
      </Space>
      <Alert
        type="info"
        showIcon
        title="Letters are legal documents"
        description="Every edit saves a new version; letters already issued keep the exact wording, values and date they were issued with, and are never overwritten. System emails (invitations, password resets) will become editable in a later update."
      />
      <Table<LetterTemplateSummary>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        scroll={{ x: true }}
        locale={{ emptyText: <EmptyState message="No letter templates yet." /> }}
        onRow={(t) => ({ onClick: () => navigate(`/admin/admin-tools/templates/${t.id}`), style: { cursor: "pointer" } })}
        columns={[
          {
            title: "Letter",
            dataIndex: "name",
            render: (v: string, t) => (
              <div>
                <Text strong>{v}</Text>
                <div>
                  <Text type="secondary" style={{ fontSize: fs.sm }}>
                    {t.description ?? t.code}
                  </Text>
                </div>
              </div>
            ),
          },
          { title: "Version", dataIndex: "currentVersion", render: (v: number) => `v${v}` },
          { title: "Typed fields", key: "fields", render: (_: unknown, t) => (t.extraFields.length ? t.extraFields.map((f) => <Tag key={f.key}>{f.label}</Tag>) : "—") },
          { title: "Employee sees it", dataIndex: "visibleToEmployeeDefault", render: (v: boolean) => (v ? "By default" : "Only if ticked") },
          { title: "Last edited", dataIndex: "lastEditedAt", render: (v: string) => formatDateTime(v) },
          {
            title: "Active",
            dataIndex: "isActive",
            render: (v: boolean, t) => (
              <span onClick={(e) => e.stopPropagation()}>
                <Switch checked={v} aria-label={`Active: ${t.name}`} onChange={(isActive) => toggle.mutate({ id: t.id, isActive })} />
              </span>
            ),
          },
        ]}
      />
      <Modal title="New letter template" open={creating} onCancel={() => setCreating(false)} onOk={() => form.submit()} confirmLoading={create.isPending} destroyOnHidden okText="Create and edit">
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => create.mutate(v)}>
          <Form.Item name="name" label="Name" rules={[{ required: true, max: 120 }]}>
            <Input placeholder="e.g. Salary Certificate" />
          </Form.Item>
          <Form.Item name="code" label="Code" rules={[{ required: true, pattern: /^[A-Z0-9_]+$/, message: "Capital letters, digits and underscores." }]}>
            <Input placeholder="e.g. SALARY_CERTIFICATE" />
          </Form.Item>
          <Form.Item name="description" label="Description">
            <Input maxLength={500} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
