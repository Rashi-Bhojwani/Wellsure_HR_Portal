import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, DatePicker, Form, Input, Modal, Popconfirm, Select, Space, Table, Tabs, Typography, message } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { DeleteOutlined, EditOutlined, PlusOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { HolidayRow } from "../../../api/leave";
import * as orgApi from "../../../api/org";
import { useAuth } from "../../../hooks/useAuth";

const { Title } = Typography;

interface HolidayApi {
  list: (locationId?: string, year?: number) => Promise<{ holidays: HolidayRow[]; locationId: string | null }>;
  create: (input: { locationId: string; date: string; name: string }) => Promise<HolidayRow>;
  update: (id: string, input: Partial<{ date: string; name: string }>) => Promise<HolidayRow>;
  remove: (id: string) => Promise<void>;
  bulkCreate: (input: { locationIds: string[]; date: string; name: string }) => Promise<{ locationId: string; status: string; error?: string }[]>;
}

const HOLIDAY_API: HolidayApi = {
  list: leaveApi.listHolidays,
  create: leaveApi.createHoliday,
  update: leaveApi.updateHoliday,
  remove: leaveApi.deleteHoliday,
  bulkCreate: leaveApi.bulkCreateHolidays,
};
const RESTRICTED_HOLIDAY_API: HolidayApi = {
  list: leaveApi.listRestrictedHolidays,
  create: leaveApi.createRestrictedHoliday,
  update: leaveApi.updateRestrictedHoliday,
  remove: leaveApi.deleteRestrictedHoliday,
  bulkCreate: leaveApi.bulkCreateRestrictedHolidays,
};

function HolidayListTab({ api, queryKey, canManage }: { api: HolidayApi; queryKey: string; canManage: boolean }) {
  const queryClient = useQueryClient();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations", "all"], queryFn: () => orgApi.listLocations(true) });
  const [locationId, setLocationId] = useState<string | undefined>(undefined);

  const { data, isLoading } = useQuery({
    queryKey: [queryKey, locationId, year],
    queryFn: () => api.list(locationId, year),
    enabled: !!locationId,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [bulkForm] = Form.useForm();

  const saveMutation = useMutation({
    mutationFn: (values: { date: Dayjs; name: string }) =>
      editing ? api.update(editing.id, { date: values.date.format("YYYY-MM-DD"), name: values.name }) : api.create({ locationId: locationId!, date: values.date.format("YYYY-MM-DD"), name: values.name }),
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
  const bulkMutation = useMutation({
    mutationFn: (values: { locationIds: string[]; date: Dayjs; name: string }) => api.bulkCreate({ locationIds: values.locationIds, date: values.date.format("YYYY-MM-DD"), name: values.name }),
    onSuccess: (results) => {
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      const created = results.filter((r) => r.status === "created").length;
      const skipped = results.filter((r) => r.status === "skipped").length;
      if (skipped === 0) void message.success(`Added to ${created} branch(es).`);
      else void message.warning(`Added to ${created} branch(es), skipped ${skipped} (already had a holiday that date).`);
      setBulkModalOpen(false);
      bulkForm.resetFields();
    },
    onError: (err) => void message.error(errorMessage(err, "Could not bulk-add.")),
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
        <Select style={{ width: 240 }} placeholder="Select a branch" showSearch optionFilterProp="label" value={locationId} onChange={setLocationId} options={locations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))} />
        <Select style={{ width: 120 }} value={year} onChange={setYear} options={[year - 1, year, year + 1, year + 2].map((y) => ({ value: y, label: String(y) }))} />
        {canManage && locationId && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            Add
          </Button>
        )}
        {canManage && (
          <Button icon={<PlusOutlined />} onClick={() => setBulkModalOpen(true)}>
            Add to Multiple Branches
          </Button>
        )}
      </Space>

      {!locationId ? (
        <Alert type="info" showIcon message="Select a branch to view or edit its calendar." />
      ) : (
        <Table<HolidayRow>
          rowKey="id"
          loading={isLoading}
          dataSource={data?.holidays ?? []}
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
      )}

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

      <Modal title="Add to Multiple Branches" open={bulkModalOpen} onCancel={() => setBulkModalOpen(false)} footer={null} destroyOnHidden width={520}>
        <Form form={bulkForm} layout="vertical" requiredMark={false} onFinish={(v: { locationIds: string[]; date: Dayjs; name: string }) => bulkMutation.mutate(v)}>
          <Form.Item name="locationIds" label="Branches" rules={[{ required: true }]}>
            <Select mode="multiple" showSearch optionFilterProp="label" options={locations.map((l) => ({ value: l.id, label: `${l.name} (${l.code})` }))} placeholder="Select one or more branches" />
          </Form.Item>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="name" label="Occasion" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" htmlType="submit" loading={bulkMutation.isPending}>
              Add
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
