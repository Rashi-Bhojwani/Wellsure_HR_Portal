import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { HolidayRow } from "../../../api/leave";
import { useAuth } from "../../../hooks/useAuth";

const { Title } = Typography;

interface HolidayApi {
  list: (year?: number) => Promise<HolidayRow[]>;
  create: (input: { date: string; name: string }) => Promise<HolidayRow>;
  update: (id: string, input: Partial<{ date: string; name: string }>) => Promise<HolidayRow>;
  remove: (id: string) => Promise<void>;
}

const HOLIDAY_API: HolidayApi = {
  list: leaveApi.listHolidays,
  create: leaveApi.createHoliday,
  update: leaveApi.updateHoliday,
  remove: leaveApi.deleteHoliday,
};
const RESTRICTED_HOLIDAY_API: HolidayApi = {
  list: leaveApi.listRestrictedHolidays,
  create: leaveApi.createRestrictedHoliday,
  update: leaveApi.updateRestrictedHoliday,
  remove: leaveApi.deleteRestrictedHoliday,
};

// One company-wide list — holidays don't vary by branch (HR-confirmed
// 2026-09-28; see schema.prisma's comment on the Holiday model).
function HolidayListTab({ api, queryKey, canManage }: { api: HolidayApi; queryKey: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data = [], isLoading } = useQuery({
    queryKey: [queryKey, year],
    queryFn: () => api.list(year),
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [form] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: { date: Dayjs; name: string }) =>
      editing ? api.update(editing.id, { date: values.date.format("YYYY-MM-DD"), name: values.name }) : api.create({ date: values.date.format("YYYY-MM-DD"), name: values.name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      void message.success(editing ? "Updated." : "Created.");
      setModalOpen(false);
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      void message.success("Deleted.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not delete.")),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setModalOpen(true);
  }
  function openEdit(row: HolidayRow) {
    setEditing(row);
    form.setFieldsValue({ name: row.name, date: dayjs(row.date) });
    setModalOpen(true);
  }

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Space wrap>
        <Select style={{ width: 120 }} value={year} onChange={setYear} options={[year - 1, year, year + 1, year + 2].map((y) => ({ value: y, label: String(y) }))} />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add
          </Button>
        )}
      </Space>

      <Table<HolidayRow>
        rowKey="id"
        loading={isLoading}
        dataSource={data}
        pagination={false}
        columns={[
          { title: "Date", dataIndex: "date", render: (v: string) => new Date(v).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "long", year: "numeric" }) },
          { title: "Occasion", dataIndex: "name" },
          ...(canManage
            ? [
                {
                  title: "Actions",
                  key: "actions",
                  render: (_: unknown, row: HolidayRow) => (
                    <Space>
                      <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} />
                      <Popconfirm title="Delete this holiday?" onConfirm={() => deleteMutation.mutate(row.id)}>
                        <Button size="small" danger icon={<DeleteOutlined />} />
                      </Popconfirm>
                    </Space>
                  ),
                },
              ]
            : []),
        ]}
      />

      <Modal title={editing ? "Edit" : "Add"} open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(v: { date: Dayjs; name: string }) => saveMutation.mutate(v)}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="name" label="Occasion" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              Save
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}

export function HolidayCalendarsAdminPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("leave.policy.manage");
  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Holiday Calendars
      </Title>
      <Tabs
        items={[
          { key: "holidays", label: "Holidays", children: <HolidayListTab api={HOLIDAY_API} queryKey="admin-holidays" canManage={canManage} /> },
          { key: "restricted", label: "Restricted Holidays", children: <HolidayListTab api={RESTRICTED_HOLIDAY_API} queryKey="admin-restricted-holidays" canManage={canManage} /> },
        ]}
      />
    </Space>
  );
}
