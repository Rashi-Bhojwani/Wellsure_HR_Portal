import { useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Checkbox, DatePicker, Flex, Select, Table, Tag, Tooltip, Typography, message } from "antd";
import { DownloadOutlined } from "@ant-design/icons";
import * as adminApi from "../../../api/attendanceAdmin";
import type { Swipe, SwipeQuery } from "../../../api/attendanceAdmin";
import * as employeeApi from "../../../api/employee";
import * as musterApi from "../../../api/muster";
import { EmptyState } from "../../../components/common/EmptyState";
import { useAuth } from "../../../hooks/useAuth";
import { apiErrorMessage } from "../../../lib/apiError";

const { Title, Text } = Typography;

// Workforce → Attendance → Employee Swipes (Phase 3 commit 2): the raw punch log exactly as the device sent it, for
// finding out what happened on a day. Read-only. Company-wide for HR (including punches that match nobody); a manager
// who has been given this sees their team's punches only.
export function EmployeeSwipesPage() {
  const { hasPermission, user } = useAuth();
  const [range, setRange] = useState<[dayjs.Dayjs, dayjs.Dayjs]>([dayjs().subtract(6, "day"), dayjs()]);
  const [filters, setFilters] = useState<Omit<SwipeQuery, "from" | "to" | "page" | "pageSize">>({});
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const query: SwipeQuery = { ...filters, from: range[0].format("YYYY-MM-DD"), to: range[1].format("YYYY-MM-DD") };
  const { data: options } = useQuery({ queryKey: ["attendance", "swipes", "options"], queryFn: adminApi.swipeOptions });
  const { data: people } = useQuery({ queryKey: ["employees", "picker", search], queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20 }) });
  const { data, isLoading, error } = useQuery({ queryKey: ["attendance", "swipes", query, page], queryFn: () => adminApi.listSwipes({ ...query, page, pageSize: 50 }), retry: false });
  const exportMutation = useMutation({
    mutationFn: () => adminApi.exportSwipes(query),
    onSuccess: (blob) => musterApi.saveBlob(blob, `employee-swipes-${query.from}-to-${query.to}.xlsx`),
    onError: (err) => void message.error(apiErrorMessage(err, "Could not export.")),
  });
  const set = (patch: Partial<typeof filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  };
  const companyWide = user?.dataScope === "ALL" || hasPermission("attendance.override.manage");

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" wrap gap={8}>
        <Title level={3} style={{ margin: 0 }}>
          Employee Swipes
        </Title>
        <Button icon={<DownloadOutlined />} loading={exportMutation.isPending} onClick={() => exportMutation.mutate()}>
          Export to Excel
        </Button>
      </Flex>
      <Text type="secondary">
        Every punch exactly as the device sent it, newest first. A punch can be unused: a near-duplicate, one still waiting for a decision or discarded, or one outside every shift's window. {companyWide ? "You see the whole company, including punches that match no employee." : "You see your team's punches."}
      </Text>
      <Flex gap={8} wrap align="center">
        <DatePicker.RangePicker
          allowClear={false}
          format="D MMM YYYY"
          value={range}
          onChange={(v) => {
            if (v?.[0] && v[1]) {
              setRange([v[0], v[1]]);
              setPage(1);
            }
          }}
        />
        <Select allowClear placeholder="Any device" style={{ width: 200 }} value={filters.deviceId} onChange={(v) => set({ deviceId: v })} options={(options?.devices ?? []).map((d) => ({ value: d.id, label: `${d.name} (${d.branch})` }))} />
        <Select
          allowClear
          showSearch={{ filterOption: false, onSearch: setSearch }}
          placeholder="Any employee"
          style={{ width: 220 }}
          value={filters.employeeId}
          onChange={(v) => set({ employeeId: v })}
          options={(people?.rows ?? []).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))}
        />
        <Select allowClear placeholder="Any route" style={{ width: 130 }} value={filters.route} onChange={(v) => set({ route: v })} options={(options?.routes ?? []).map((r) => ({ value: r as SwipeQuery["route"], label: r }))} />
        <Select
          allowClear
          placeholder="Used or not"
          style={{ width: 140 }}
          value={filters.used}
          onChange={(v) => set({ used: v })}
          options={[{ value: "yes", label: "Used in a day" }, { value: "no", label: "Not used" }]}
        />
        <Select
          allowClear
          placeholder="Flags"
          style={{ width: 170 }}
          value={filters.flagged}
          onChange={(v) => set({ flagged: v })}
          options={[
            { value: "any", label: "Flagged" },
            { value: "pending", label: "Waiting for a decision" },
            { value: "accepted", label: "Accepted" },
            { value: "discarded", label: "Discarded" },
            { value: "none", label: "Not flagged" },
          ]}
        />
        {companyWide && (
          <Checkbox checked={!!filters.unmapped} onChange={(e) => set({ unmapped: e.target.checked || undefined })}>
            Matching no employee
          </Checkbox>
        )}
      </Flex>
      {error && <Alert type="error" showIcon title={apiErrorMessage(error, "Could not load the punch log.")} />}
      <Table<Swipe>
        size="small"
        rowKey="id"
        loading={isLoading}
        dataSource={data?.entries ?? []}
        locale={{ emptyText: <EmptyState message="No punches for these filters." compact /> }}
        scroll={{ x: "max-content" }}
        pagination={{ current: page, pageSize: 50, total: data?.total ?? 0, onChange: setPage, showSizeChanger: false, size: "small", showTotal: (t) => `${t.toLocaleString("en-IN")} punches` }}
        columns={[
          { title: "Time", key: "t", render: (_, r) => <Tooltip title={`The device recorded: ${r.deviceTime}`}>{dayjs(r.time).format("ddd D MMM, HH:mm:ss")}</Tooltip> },
          { title: "Device", key: "d", render: (_, r) => (r.branch ? `${r.device} (${r.branch})` : r.device) },
          { title: "Device user ID", dataIndex: "deviceUserId" },
          { title: "Employee", key: "e", render: (_, r) => (r.employeeId ? `${r.employeeName ?? ""} (${r.employeeCode ?? ""})` : <Tag color="red">matches nobody</Tag>) },
          { title: "Arrived by", dataIndex: "route", render: (v: string) => <Tag>{v}</Tag> },
          {
            title: "Flag",
            key: "f",
            render: (_, r) =>
              r.flag ? (
                <Tooltip title={r.decisionReason ?? undefined}>
                  <Tag color={r.decision === "ACCEPTED" ? "green" : r.decision === "DISCARDED" ? "default" : "orange"}>
                    {r.flagLabel}: {r.decision === "ACCEPTED" ? "accepted" : r.decision === "DISCARDED" ? "discarded" : "waiting"}
                  </Tag>
                </Tooltip>
              ) : (
                <Text type="secondary">—</Text>
              ),
          },
          { title: "Used", dataIndex: "used", render: (v: boolean, r) => (r.employeeId ? v ? <Tag color="green">used</Tag> : <Tag>not used</Tag> : <Text type="secondary">n/a</Text>) },
        ]}
      />
    </Flex>
  );
}
