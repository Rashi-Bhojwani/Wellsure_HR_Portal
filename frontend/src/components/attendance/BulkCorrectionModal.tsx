import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Checkbox, DatePicker, Descriptions, Form, Input, Modal, Radio, Select, Space, Table, Tag, Typography, message } from "antd";
import * as infoApi from "../../api/attendanceInfo";
import type { BulkBody, BulkPreview, ReasonCode, TargetStatus } from "../../api/attendanceInfo";
import * as employeeApi from "../../api/employee";
import * as orgApi from "../../api/org";
import { apiErrorMessage } from "../../lib/apiError";
import { useAuth } from "../../hooks/useAuth";
import type { CarriedSelection } from "./targetSelection";

const { Text } = Typography;
const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t?: string) => (t ? t.trim().padStart(5, "0") : undefined);

interface Values {
  who: "GROUP" | "LIST";
  locationId?: string;
  departmentId?: string;
  employeeIds?: string[];
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  reasonCode: ReasonCode;
  mode: "TIMES" | "STATUS";
  inTime?: string;
  outTime?: string;
  status?: TargetStatus;
  note?: string;
  action: "RAISE" | "RAISE_AND_APPROVE";
}

/**
 * Correct many employee-days at once (Phase 3 commit 1): typically a whole branch after a device outage. Pick a
 * date range and the people (a branch, a department, or a list), one reason and one correction; PREVIEW shows
 * exactly which employee-days change and from what to what, and what can't be corrected and why; CONFIRM applies
 * only that set. Raise it for an approver, or raise and approve in one go. One audit row per employee-day.
 */
export function BulkCorrectionModal({ open, onClose, carried }: { open: boolean; onClose: () => void; carried?: CarriedSelection }) {
  const [form] = Form.useForm<Values>();
  useEffect(() => {
    if (open && carried) form.setFieldsValue({ who: "LIST", employeeIds: carried.employeeIds, range: [dayjs(carried.from), dayjs(carried.to)] });
  }, [open, carried, form]);
  const queryClient = useQueryClient();
  const { hasPermission } = useAuth();
  const canApprove = hasPermission("attendance.regularization.approve");
  const [preview, setPreview] = useState<{ data: BulkPreview; body: BulkBody } | null>(null);
  const [looked, setLooked] = useState(false);
  const [search, setSearch] = useState("");
  const who = Form.useWatch("who", form) ?? "GROUP";
  const mode = Form.useWatch("mode", form) ?? "TIMES";
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations(), enabled: open });
  const { data: departments = [] } = useQuery({ queryKey: ["org", "departments"], queryFn: () => orgApi.departments.list(), enabled: open });
  const { data: people } = useQuery({
    queryKey: ["employees", "picker", search],
    queryFn: () => employeeApi.listEmployees({ search: search || undefined, pageSize: 20, status: "ACTIVE" }),
    enabled: open && who === "LIST",
  });

  const bodyOf = (v: Values): BulkBody => ({
    selection: v.who === "LIST" ? { employeeIds: v.employeeIds } : { locationId: v.locationId, departmentId: v.departmentId },
    from: v.range![0].format("YYYY-MM-DD"),
    to: v.range![1].format("YYYY-MM-DD"),
    reasonCode: v.reasonCode,
    note: (v.note ?? "").trim(),
    action: v.action,
    ...(v.mode === "STATUS" ? { status: v.status } : { inTime: pad(v.inTime), outTime: pad(v.outTime) }),
  });

  const previewMutation = useMutation({
    mutationFn: (v: Values) => infoApi.previewBulkCorrection(bodyOf(v)).then((data) => ({ data, body: bodyOf(v) })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => void message.error(apiErrorMessage(err, "Could not preview this correction.")),
  });
  const confirm = useMutation({
    mutationFn: () => infoApi.confirmBulkCorrection(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      void message.success(r.approved ? `${r.requests} employee-days corrected for ${r.employees} people.` : `${r.requests} requests raised for ${r.employees} people; they wait for an approver.`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setPreview(null);
      form.resetFields();
      onClose();
    },
    onError: (err) => {
      void message.error(apiErrorMessage(err, "Could not apply this correction."));
      setPreview(null); // the set may have changed: look again
      setLooked(false);
    },
  });

  const data = preview?.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  return (
    <Modal title="Correct attendance in bulk" open={open} onCancel={onClose} footer={null} width={900} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ who: "GROUP", reasonCode: "DEVICE_DOWN", mode: "TIMES", action: "RAISE_AND_APPROVE" }}
        onValuesChange={() => {
          setPreview(null);
          setLooked(false);
        }}
        onFinish={(v) => {
          if (v.who === "GROUP" && !v.locationId && !v.departmentId) return void message.error("Choose a branch, a department, or switch to specific employees.");
          if (v.who === "LIST" && !(v.employeeIds ?? []).length) return void message.error("Choose at least one employee.");
          if (v.mode === "TIMES" && !v.inTime && !v.outTime) return void message.error("Give the time in, the time out, or both.");
          previewMutation.mutate(v);
        }}
      >
        <Space orientation="vertical" size={4} style={{ width: "100%", marginBottom: 12 }}>
          <Text type="secondary">
            For when a device was down, or a group was away on duty. You will see exactly what changes before anything is applied. The device's own punches never change, and your own days are left out: someone else corrects those.
          </Text>
        </Space>
        <Form.Item name="who" label="Who?">
          <Radio.Group options={[{ value: "GROUP", label: "Everyone at a branch or department" }, { value: "LIST", label: "Specific employees" }]} />
        </Form.Item>
        {who === "GROUP" ? (
          <Space wrap>
            <Form.Item name="locationId" label="Branch">
              <Select allowClear placeholder="Any branch" style={{ width: 240 }} options={locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Form.Item>
            <Form.Item name="departmentId" label="Department">
              <Select allowClear placeholder="Any department" style={{ width: 240 }} options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            </Form.Item>
          </Space>
        ) : (
          <Form.Item name="employeeIds" label="Employees">
            <Select
              mode="multiple"
              showSearch={{ filterOption: false, onSearch: setSearch }}
              placeholder="Search by name or code"
              options={[...(carried?.people ?? []), ...(people?.rows ?? []).filter((e) => !(carried?.people ?? []).some((k) => k.value === e.id)).map((e) => ({ value: e.id, label: `${e.fullName} (${e.employeeCode})` }))]}
            />
          </Form.Item>
        )}
        <Space wrap align="start">
          <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]}>
            <DatePicker.RangePicker format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs().subtract(1, "day"), "day")} />
          </Form.Item>
          <Form.Item name="reasonCode" label="Why?">
            <Select style={{ width: 200 }} options={infoApi.REASON_OPTIONS} />
          </Form.Item>
        </Space>
        <Form.Item name="mode" label="What should be corrected?">
          <Radio.Group options={[{ value: "TIMES", label: "The times" }, { value: "STATUS", label: "The day's status" }]} />
        </Form.Item>
        {mode === "TIMES" ? (
          <Space wrap align="start">
            <Form.Item name="inTime" label="Time in" rules={[{ pattern: TIME, message: "HH:MM, e.g. 10:00" }]}>
              <Input placeholder="10:00" style={{ width: 120 }} />
            </Form.Item>
            <Form.Item name="outTime" label="Time out" rules={[{ pattern: TIME, message: "HH:MM, e.g. 19:00" }]}>
              <Input placeholder="19:00" style={{ width: 120 }} />
            </Form.Item>
            <Text type="secondary" style={{ display: "block", marginTop: 30 }}>
              Both times replace the device's for the day; one adds to it. A day with no punches needs both.
            </Text>
          </Space>
        ) : (
          <Form.Item name="status" label="The days should be" rules={[{ required: true, message: "Choose a status" }]}>
            <Select style={{ width: 280 }} options={infoApi.STATUS_OPTIONS} placeholder="Choose" />
          </Form.Item>
        )}
        <Form.Item name="note" label="Why? (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. the branch device was down 15–16 September" }]}>
          <Input.TextArea rows={2} maxLength={500} />
        </Form.Item>
        <Form.Item name="action" label="Then">
          <Radio.Group
            options={[
              { value: "RAISE", label: "Raise requests for an approver to decide" },
              { value: "RAISE_AND_APPROVE", label: "Raise and approve now", disabled: !canApprove },
            ]}
          />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={previewMutation.isPending}>
          Preview what will change
        </Button>
      </Form>

      {data && (
        <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 16 }}>
          {data.count === 0 ? (
            <Alert type="warning" showIcon title="Nothing in that selection can be corrected." description="See why below, then change the dates, people or correction." />
          ) : (
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="Employee-days">{data.count}</Descriptions.Item>
              <Descriptions.Item label="People">{data.employees}</Descriptions.Item>
              <Descriptions.Item label="Correction" span={2}>{data.correction}</Descriptions.Item>
              <Descriptions.Item label="Then" span={2}>{data.action === "RAISE" ? "Requests are raised and wait for an approver" : "Raised and approved now; the days are worked out again"}</Descriptions.Item>
            </Descriptions>
          )}
          {data.ownLeftOut > 0 && <Alert type="info" showIcon title={`${data.ownLeftOut} of your own days are left out.`} description="Nobody corrects their own attendance. Another HR admin does those." />}
          {data.cannotCorrect.length > 0 && (
            <div>
              <Text strong>Not corrected, and why</Text>
              <div style={{ marginTop: 4 }}>
                {data.cannotCorrect.map((g) => (
                  <div key={g.code}>
                    <Tag color="orange">{g.count}</Tag>
                    {g.label}
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {" "}
                      e.g. {g.examples.map((e) => `${e.name} ${dayjs(e.date).format("D MMM")}`).join(", ")}
                    </Text>
                  </div>
                ))}
              </div>
            </div>
          )}
          {data.count > 0 && (
            <>
              <Table
                size="small"
                rowKey={(r) => `${r.employeeId}|${r.date}`}
                dataSource={rows}
                pagination={{ pageSize: 10, size: "small", showSizeChanger: false }}
                columns={[
                  { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                  { title: "Day", dataIndex: "date", render: (d: string) => dayjs(d).format("ddd, D MMM") },
                  { title: "Now", dataIndex: "before", render: (v: string | null) => v ?? "—" },
                  { title: "After", dataIndex: "after", render: (v: string | null) => <Text strong>{v ?? "—"}</Text> },
                ]}
              />
              <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
                I have looked at these {data.count} employee-days and want them {data.action === "RAISE" ? "raised" : "corrected"}.
              </Checkbox>
              <Button type="primary" disabled={!looked} loading={confirm.isPending} onClick={() => confirm.mutate()}>
                {data.action === "RAISE" ? `Raise ${data.count} requests` : `Correct ${data.count} employee-days`}
              </Button>
            </>
          )}
        </Space>
      )}
    </Modal>
  );
}
