import { useState } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Select, Tabs } from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { PlusOutlined } from "@ant-design/icons";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as leaveApi from "../../../api/leave";
import type { HolidayRow } from "../../../api/leave";
import { useAuth } from "../../../hooks/useAuth";
import { RowActionButton } from "../../../components/leave/RowActionButton";
import { fmtHolidayDate, holidayColumns, holidayWeekday } from "../../../components/leave/holidayColumns";
import { space } from "../../../theme/tokens";
import { ConfirmModal, DataTable, EmptyState, PageHeader, Panel, SideDrawer, toast, useIsPhone } from "../../../ui";

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
function HolidayListTab({ api, queryKey, canManage, noun }: { api: HolidayApi; queryKey: string; canManage: boolean; noun: string }) {
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);

  const { data = [], isLoading, isFetching, error, refetch } = useQuery({
    queryKey: [queryKey, year],
    queryFn: () => api.list(year),
    placeholderData: keepPreviousData,
  });

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<HolidayRow | null>(null);
  const [deleting, setDeleting] = useState<HolidayRow | null>(null);
  const [form] = Form.useForm();
  const formId = `holiday-form-${queryKey}`;

  const saveMutation = useMutation({
    mutationFn: (values: { date: Dayjs; name: string }) =>
      editing ? api.update(editing.id, { date: values.date.format("YYYY-MM-DD"), name: values.name }) : api.create({ date: values.date.format("YYYY-MM-DD"), name: values.name }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast.success(editing ? "Updated." : "Created.");
      setDrawerOpen(false);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save.")),
  });
  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.remove(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: [queryKey] });
      toast.success("Deleted.");
      setDeleting(null);
    },
    onError: (err) => toast.error(errorMessage(err, "Could not delete.")),
  });

  function openCreate() {
    setEditing(null);
    form.resetFields();
    setDrawerOpen(true);
  }
  function openEdit(row: HolidayRow) {
    setEditing(row);
    form.setFieldsValue({ name: row.name, date: dayjs(row.date) });
    setDrawerOpen(true);
  }

  const actions = (row: HolidayRow) => (
    <div style={{ display: "flex", gap: space[2], justifyContent: "flex-end" }}>
      <RowActionButton kind="edit" label={`Edit ${row.name}`} onClick={() => openEdit(row)} />
      <RowActionButton kind="delete" label={`Delete ${row.name}`} onClick={() => setDeleting(row)} />
    </div>
  );

  return (
    <>
      <div style={{ display: "flex", flexWrap: "wrap", gap: space[3], alignItems: "center", marginBottom: space[4] }}>
        <Select
          aria-label="Year"
          style={{ width: phone ? undefined : 120, flex: phone ? 1 : undefined }}
          value={year}
          onChange={setYear}
          options={[currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map((y) => ({ value: y, label: String(y) }))}
        />
        {canManage && (
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} style={{ marginLeft: phone ? 0 : "auto", flex: phone ? 1 : undefined }}>
            New {noun}
          </Button>
        )}
      </div>

      <DataTable<HolidayRow>
        rowKey="id"
        loading={isLoading || isFetching}
        error={error}
        onRetry={() => void refetch()}
        dataSource={data}
        pagination={false}
        empty={
          <EmptyState
            compact
            illustration="calendar"
            title={`No ${noun}s for ${year}`}
            description={canManage ? `Add the first ${noun} for ${year}.` : null}
            action={canManage ? <Button icon={<PlusOutlined />} onClick={openCreate}>New {noun}</Button> : undefined}
          />
        }
        columns={[
          ...holidayColumns<HolidayRow>(),
          ...(canManage ? [{ title: "Actions", key: "actions", align: "right" as const, width: 120, render: (_: unknown, row: HolidayRow) => actions(row) }] : []),
        ]}
        mobile={{
          title: (r) => r.name,
          subtitle: (r) => `${fmtHolidayDate(r.date)} · ${holidayWeekday(r.date)}`,
          actions: canManage ? actions : undefined,
        }}
      />

      <SideDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        title={editing ? `Edit ${noun}` : `New ${noun}`}
        formId={formId}
        primaryLabel="Save"
        primaryLoading={saveMutation.isPending}
        destroyOnHidden={false}
      >
        <Form id={formId} form={form} layout="vertical" requiredMark={false} size="large" onFinish={(val: { date: Dayjs; name: string }) => saveMutation.mutate(val)}>
          <Form.Item name="date" label="Date" rules={[{ required: true }]}>
            <DatePicker style={{ width: "100%" }} format="DD MMM YYYY" />
          </Form.Item>
          <Form.Item name="name" label="Occasion" rules={[{ required: true }]}>
            <Input placeholder="e.g. Republic Day" />
          </Form.Item>
        </Form>
      </SideDrawer>

      <ConfirmModal
        open={deleting !== null}
        onCancel={() => setDeleting(null)}
        onConfirm={() => deleting && deleteMutation.mutate(deleting.id)}
        title={`Delete this ${noun}?`}
        description={deleting ? `${deleting.name} on ${fmtHolidayDate(deleting.date)} will be removed from the calendar.` : undefined}
        confirmLabel="Delete"
        danger
        loading={deleteMutation.isPending}
      />
    </>
  );
}

export function HolidayCalendarsAdminPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission("leave.policy.manage");
  return (
    <>
      <PageHeader title="Holiday Calendars" subtitle="Company-wide holidays and restricted holidays, by year" />
      <Panel>
        <Tabs
          items={[
            { key: "holidays", label: "Holidays", children: <HolidayListTab api={HOLIDAY_API} queryKey="admin-holidays" canManage={canManage} noun="holiday" /> },
            {
              key: "restricted",
              label: "Restricted Holidays",
              children: <HolidayListTab api={RESTRICTED_HOLIDAY_API} queryKey="admin-restricted-holidays" canManage={canManage} noun="restricted holiday" />,
            },
          ]}
        />
      </Panel>
    </>
  );
}
