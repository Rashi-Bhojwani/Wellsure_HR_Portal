import { useState } from "react";
import { useLocation } from "react-router-dom";
import dayjs from "dayjs";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Select, Tooltip } from "antd";
import * as adminApi from "../../../api/attendanceAdmin";
import * as employeeApi from "../../../api/employee";
import { ManualOverrideForm } from "../../../components/attendance/ManualOverrideForm";
import type { CarriedSelection } from "../../../components/attendance/targetSelection";
import { apiErrorMessage } from "../../../lib/apiError";
import { ConfirmModal, DataTable, EmptyState, FilterBar, PageHeader, Panel, Stack, StatusChip, toast, useIsPhone } from "../../../ui";
import { space, v } from "../../../theme/tokens";

type Entry = adminApi.OverrideEntry;

function SetToCell({ r }: { r: Entry }) {
  return (
    <span style={{ display: "inline-flex", flexWrap: "wrap", alignItems: "center", gap: space[1] }}>
      <span style={{ marginRight: space[1] }}>{r.what}</span>
      <StatusChip tone={r.origin === "REGULARIZATION" ? "info" : "purple"}>{r.origin === "REGULARIZATION" ? "request approved" : "HR override"}</StatusChip>
      {r.leaveReleased.length > 0 && <StatusChip tone="success">leave returned: {r.leaveReleased.map((l) => `${l.type} ${l.days}`).join(", ")}</StatusChip>}
    </span>
  );
}

// Workforce → Attendance → Manual Override (Phase 3 commit 2): HR sets days directly (including a leave day the person
// worked, which returns the leave balance), and sees every override that was made, who made it and why.
export function ManualOverridePage() {
  const carried = (useLocation().state as { carried?: CarriedSelection } | null)?.carried; // people and dates chosen on the Exceptions queue
  const queryClient = useQueryClient();
  const phone = useIsPhone();
  const [employeeId, setEmployeeId] = useState<string | undefined>();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [removing, setRemoving] = useState<Entry | null>(null);
  const [form] = Form.useForm<{ note: string }>();
  const { data: people } = useQuery({ queryKey: ["employees", "picker", search], queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20 }) });
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["attendance", "overrides", employeeId, page],
    queryFn: () => adminApi.listOverrides({ employeeId, page, pageSize: 15 }),
    placeholderData: keepPreviousData,
  });
  const clear = useMutation({
    mutationFn: (note: string) => adminApi.clearOverride({ employeeId: removing!.employeeId, date: removing!.date, note }),
    onSuccess: () => {
      toast.success("Removed: the day follows the device again.");
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      setRemoving(null);
      form.resetFields();
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not remove this override.")),
  });

  const stateCell = (r: Entry) =>
    r.inForce ? (
      <Tooltip title="Goes back to what the device recorded. Not possible once leave was released on that day.">
        <Button size={phone ? "middle" : "small"} onClick={() => setRemoving(r)}>
          Remove
        </Button>
      </Tooltip>
    ) : (
      <StatusChip tone="neutral">{r.kind === "CLEARED" ? "removal" : "replaced"}</StatusChip>
    );

  return (
    <>
      <PageHeader title="Manual Override" subtitle="Set attendance days directly; every change is kept on record" />
      <Stack>
        <Panel title="Set days">
          <ManualOverrideForm onDone={() => setPage(1)} carried={carried} />
        </Panel>
        <Panel title="Overrides and corrections made" subtitle="Newest first. Approved correction requests are here too.">
          <FilterBar
            activeCount={employeeId ? 1 : 0}
            onClear={() => {
              setEmployeeId(undefined);
              setPage(1);
            }}
            filters={
              <Select
                allowClear
                showSearch={{ filterOption: false, onSearch: setSearch }}
                placeholder="Filter by employee"
                aria-label="Filter by employee"
                style={{ width: phone ? "100%" : 300 }}
                value={employeeId}
                onChange={(x) => {
                  setEmployeeId(x);
                  setPage(1);
                }}
                options={(people?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
              />
            }
          />
          <DataTable<Entry>
            rowKey="id"
            density="compact"
            loading={isLoading || isFetching}
            error={error}
            onRetry={() => void refetch()}
            dataSource={data?.entries ?? []}
            empty={<EmptyState compact title={employeeId ? "No overrides for this person" : "Nothing has been overridden yet."} description={employeeId ? "Clear the filter to see everyone's." : "Days you set above appear here."} />}
            pagination={{ current: page, pageSize: 15, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false }}
            columns={[
              { title: "Employee", key: "e", render: (_, r) => `${r.employeeName} (${r.employeeCode})` },
              { title: "Day", dataIndex: "date", render: (x: string) => dayjs(x).format("ddd, D MMM YYYY") },
              { title: "Set to", key: "what", render: (_, r) => <SetToCell r={r} /> },
              { title: "Why", key: "why", render: (_, r) => r.reason || <span style={{ color: v.textSecondary }}>—</span> },
              { title: "By", dataIndex: "by" },
              { title: "When", dataIndex: "at", render: (x: string) => dayjs(x).format("D MMM YYYY, HH:mm") },
              { title: "", key: "actions", render: (_, r) => stateCell(r) },
            ]}
            mobile={{
              title: (r) => r.employeeName,
              subtitle: (r) => `${r.employeeCode} · ${dayjs(r.date).format("ddd, D MMM YYYY")}`,
              status: (r) => (r.inForce ? <StatusChip tone="success">In force</StatusChip> : null),
              fields: [
                { label: "Set to", render: (r) => <SetToCell r={r} /> },
                { label: "Why", render: (r) => r.reason || "—" },
                { label: "By", render: (r) => r.by },
                { label: "When", render: (r) => dayjs(r.at).format("D MMM YYYY, HH:mm") },
              ],
              actions: stateCell,
            }}
          />
        </Panel>
      </Stack>
      <ConfirmModal
        open={removing !== null}
        onCancel={() => setRemoving(null)}
        title={removing ? `Remove the override: ${removing.employeeName}, ${dayjs(removing.date).format("D MMM")}` : ""}
        description="The day goes back to what the device recorded."
        confirmLabel="Remove"
        danger
        loading={clear.isPending}
        onConfirm={() => form.submit()}
      >
        <Form form={form} layout="vertical" requiredMark={false} onFinish={(val) => clear.mutate(val.note.trim())}>
          <Form.Item name="note" label="Why? (kept on record)" rules={[{ required: true, min: 5, message: "A few words" }]}>
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        </Form>
      </ConfirmModal>
    </>
  );
}
