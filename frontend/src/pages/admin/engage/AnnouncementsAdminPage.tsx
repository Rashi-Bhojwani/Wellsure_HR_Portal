import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Modal, Select, Space, Switch, Table, Tag, Typography, message } from "antd";
import dayjs from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import * as announcementsApi from "../../../api/announcements";
import * as orgApi from "../../../api/org";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title } = Typography;
const { RangePicker } = DatePicker;

function AnnouncementModal({ open, editing, onClose }: { open: boolean; editing: announcementsApi.AnnouncementRow | null; onClose: () => void }) {
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: orgApi.departments.list });

  const saveMutation = useMutation({
    mutationFn: (values: {
      title: string;
      body: string;
      linkLabel?: string;
      linkUrl?: string;
      scopeLocationId?: string;
      scopeDepartmentId?: string;
      range: [dayjs.Dayjs, dayjs.Dayjs];
      isActive?: boolean;
    }) => {
      const input = {
        title: values.title,
        body: values.body,
        linkLabel: values.linkLabel || undefined,
        linkUrl: values.linkUrl || undefined,
        scopeLocationId: values.scopeLocationId ?? null,
        scopeDepartmentId: values.scopeDepartmentId ?? null,
        activeFrom: values.range[0].format("YYYY-MM-DD"),
        activeTo: values.range[1].format("YYYY-MM-DD"),
        ...(editing && { isActive: values.isActive }),
      };
      return editing ? announcementsApi.updateAnnouncement(editing.id, input) : announcementsApi.createAnnouncement(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["announcements", "all"] });
      void message.success(editing ? "Announcement updated." : "Announcement created.");
      onClose();
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not save this announcement.")),
  });

  return (
    <Modal
      title={editing ? "Edit Announcement" : "Add Announcement"}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnHidden
      width={600}
      afterOpenChange={(isOpen) =>
        isOpen &&
        form.setFieldsValue(
          editing
            ? { ...editing, linkLabel: editing.linkLabel ?? undefined, linkUrl: editing.linkUrl ?? undefined, scopeLocationId: editing.scopeLocationId ?? undefined, scopeDepartmentId: editing.scopeDepartmentId ?? undefined, range: [dayjs(editing.activeFrom), dayjs(editing.activeTo)] }
            : { isActive: true },
        )
      }
    >
      <Form form={form} layout="vertical" requiredMark={false} onFinish={(v) => saveMutation.mutate(v)}>
        <Form.Item name="title" label="Title" rules={[{ required: true, max: 200 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="body" label="Body" rules={[{ required: true, max: 2000 }]}>
          <Input.TextArea rows={3} />
        </Form.Item>
        <Space style={{ width: "100%" }}>
          <Form.Item name="linkLabel" label="Link Label">
            <Input style={{ width: 250 }} />
          </Form.Item>
          <Form.Item name="linkUrl" label="Link URL">
            <Input style={{ width: 250 }} />
          </Form.Item>
        </Space>
        <Space style={{ width: "100%" }}>
          <Form.Item name="scopeLocationId" label="Location (blank = all)">
            <Select allowClear style={{ width: 250 }} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
          </Form.Item>
          <Form.Item name="scopeDepartmentId" label="Department (blank = all)">
            <Select allowClear style={{ width: 250 }} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
          </Form.Item>
        </Space>
        <Form.Item name="range" label="Active window" rules={[{ required: true }]}>
          <RangePicker style={{ width: "100%" }} />
        </Form.Item>
        {editing && (
          <Form.Item name="isActive" label="Active" valuePropName="checked">
            <Switch />
          </Form.Item>
        )}
        <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save
          </Button>
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function AnnouncementsAdminPage() {
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<announcementsApi.AnnouncementRow | null>(null);
  const { data: announcements = [], isLoading } = useQuery({ queryKey: ["announcements", "all"], queryFn: announcementsApi.listAnnouncements });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <HelpStrip storageKey="engage-announcements">
        Announcements show on the Employee Home banner, replacing greytHR's product ads. When more than one active announcement matches an employee, the most specific scope wins (both location and department beats one beats org-wide), and ties break on the most recent start date.
      </HelpStrip>

      <Space style={{ width: "100%", justifyContent: "space-between" }}>
        <Title level={4} style={{ margin: 0 }}>
          Announcements
        </Title>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setModalOpen(true);
          }}
        >
          Add Announcement
        </Button>
      </Space>

      <Table
        rowKey="id"
        loading={isLoading}
        dataSource={announcements}
        columns={[
          { title: "Title", dataIndex: "title" },
          {
            title: "Scope",
            key: "scope",
            render: (_: unknown, row: announcementsApi.AnnouncementRow) =>
              row.scopeLocationId || row.scopeDepartmentId ? <Tag color="blue">Scoped</Tag> : <Tag>Org-wide</Tag>,
          },
          { title: "Active From", dataIndex: "activeFrom" },
          { title: "Active To", dataIndex: "activeTo" },
          {
            title: "Status",
            dataIndex: "isActive",
            render: (v: boolean) => <Tag color={v ? "green" : "default"}>{v ? "Active" : "Paused"}</Tag>,
          },
          {
            title: "",
            key: "actions",
            render: (_: unknown, row: announcementsApi.AnnouncementRow) => (
              <a
                onClick={() => {
                  setEditing(row);
                  setModalOpen(true);
                }}
              >
                Edit
              </a>
            ),
          },
        ]}
      />

      <AnnouncementModal open={modalOpen} editing={editing} onClose={() => setModalOpen(false)} />
    </Space>
  );
}
