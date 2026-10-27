import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Checkbox, DatePicker, Form, Input, Radio, Select } from "antd";
import * as infoApi from "../../api/attendanceInfo";
import type { BulkBody, BulkPreview, ReasonCode, TargetStatus } from "../../api/attendanceInfo";
import * as employeeApi from "../../api/employee";
import * as orgApi from "../../api/org";
import { apiErrorMessage } from "../../lib/apiError";
import { useAuth } from "../../hooks/useAuth";
import type { CarriedSelection } from "./targetSelection";
import { fs, fw, space, v } from "../../theme/tokens";
import { ApprovalBanner, DataTable, FormGroupTitle, KeyValueGrid, SideDrawer, StatusChip, toast, useIsPhone } from "../../ui";

const TIME = /^([01]?\d|2[0-3]):[0-5]\d$/;
const pad = (t?: string) => (t ? t.trim().padStart(5, "0") : undefined);
const FORM_ID = "bulk-correction-form";

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
type PreviewRow = BulkPreview["rows"][number];

/**
 * Correct many employee-days at once (Phase 3 commit 1): typically a whole branch after a device outage. Pick a
 * date range and the people (a branch, a department, or a list), one reason and one correction; PREVIEW shows
 * exactly which employee-days change and from what to what, and what can't be corrected and why; CONFIRM applies
 * only that set. Raise it for an approver, or raise and approve in one go. One audit row per employee-day.
 * A wide SideDrawer (full-screen sheet on phones); the footer's primary is "Preview" until a preview with
 * something to change is showing, then the confirm (gated by the "I have looked" tick, waits for the server).
 */
export function BulkCorrectionModal({ open, onClose, carried }: { open: boolean; onClose: () => void; carried?: CarriedSelection }) {
  const [form] = Form.useForm<Values>();
  const phone = useIsPhone();
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

  const bodyOf = (val: Values): BulkBody => ({
    selection: val.who === "LIST" ? { employeeIds: val.employeeIds } : { locationId: val.locationId, departmentId: val.departmentId },
    from: val.range![0].format("YYYY-MM-DD"),
    to: val.range![1].format("YYYY-MM-DD"),
    reasonCode: val.reasonCode,
    note: (val.note ?? "").trim(),
    action: val.action,
    ...(val.mode === "STATUS" ? { status: val.status } : { inTime: pad(val.inTime), outTime: pad(val.outTime) }),
  });

  const previewMutation = useMutation({
    mutationFn: (val: Values) => infoApi.previewBulkCorrection(bodyOf(val)).then((data) => ({ data, body: bodyOf(val) })),
    onSuccess: (r) => {
      setPreview(r);
      setLooked(false);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not preview this correction.")),
  });
  const confirm = useMutation({
    mutationFn: () => infoApi.confirmBulkCorrection(preview!.body, preview!.data.fingerprint),
    onSuccess: (r) => {
      toast.success(r.approved ? `${r.requests} employee-days corrected for ${r.employees} people.` : `${r.requests} requests raised for ${r.employees} people; they wait for an approver.`);
      void queryClient.invalidateQueries({ queryKey: ["attendance"] });
      void queryClient.invalidateQueries({ queryKey: ["tasks"] });
      setPreview(null);
      form.resetFields();
      onClose();
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err, "Could not apply this correction."));
      setPreview(null); // the set may have changed: look again
      setLooked(false);
    },
  });

  const data = preview?.data;
  const rows = useMemo(() => data?.rows ?? [], [data]);
  const canConfirm = !!data && data.count > 0;
  const fieldWidth = (w: number) => (phone ? "100%" : w);

  return (
    <SideDrawer
      open={open}
      onClose={() => !confirm.isPending && onClose()}
      title="Correct attendance in bulk"
      subtitle="For when a device was down, or a group was away on duty"
      size="wide"
      {...(canConfirm
        ? {
            onPrimary: () => confirm.mutate(),
            primaryLabel: data.action === "RAISE" ? `Raise ${data.count} requests` : `Correct ${data.count} employee-days`,
            primaryDisabled: !looked,
            primaryLoading: confirm.isPending,
          }
        : { formId: FORM_ID, primaryLabel: "Preview what will change", primaryLoading: previewMutation.isPending })}
    >
      <Form
        id={FORM_ID}
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ who: "GROUP", reasonCode: "DEVICE_DOWN", mode: "TIMES", action: "RAISE_AND_APPROVE" }}
        onValuesChange={() => {
          setPreview(null);
          setLooked(false);
        }}
        onFinish={(val) => {
          if (val.who === "GROUP" && !val.locationId && !val.departmentId) return form.setFields([{ name: "locationId", errors: ["Choose a branch, a department, or switch to specific employees."] }]);
          if (val.who === "LIST" && !(val.employeeIds ?? []).length) return form.setFields([{ name: "employeeIds", errors: ["Choose at least one employee."] }]);
          if (val.mode === "TIMES" && !val.inTime && !val.outTime) return form.setFields([{ name: "inTime", errors: ["Give the time in, the time out, or both."] }]);
          previewMutation.mutate(val);
        }}
      >
        <p style={{ color: v.textSecondary, fontSize: fs.md, margin: `0 0 ${space[4]}px` }}>
          You will see exactly what changes before anything is applied. The device's own punches never change, and your own days are left out: someone else corrects those.
        </p>

        <FormGroupTitle>Who and when</FormGroupTitle>
        <Form.Item name="who" label="Who?">
          <Radio.Group options={[{ value: "GROUP", label: "Everyone at a branch or department" }, { value: "LIST", label: "Specific employees" }]} />
        </Form.Item>
        {who === "GROUP" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: `0 ${space[4]}px` }}>
            <Form.Item name="locationId" label="Branch" style={{ width: fieldWidth(260) }}>
              <Select allowClear placeholder="Any branch" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
            </Form.Item>
            <Form.Item name="departmentId" label="Department" style={{ width: fieldWidth(260) }}>
              <Select allowClear placeholder="Any department" options={departments.map((d) => ({ value: d.id, label: d.name }))} />
            </Form.Item>
          </div>
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
        <div style={{ display: "flex", flexWrap: "wrap", gap: `0 ${space[4]}px`, alignItems: "flex-start" }}>
          <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]} style={{ width: fieldWidth(300) }}>
            <DatePicker.RangePicker style={{ width: "100%" }} format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs().subtract(1, "day"), "day")} />
          </Form.Item>
          <Form.Item name="reasonCode" label="Why?" style={{ width: fieldWidth(220) }}>
            <Select options={infoApi.REASON_OPTIONS} />
          </Form.Item>
        </div>

        <FormGroupTitle>The correction</FormGroupTitle>
        <Form.Item name="mode" label="What should be corrected?">
          <Radio.Group options={[{ value: "TIMES", label: "The times" }, { value: "STATUS", label: "The day's status" }]} />
        </Form.Item>
        {mode === "TIMES" ? (
          <Form.Item extra="Both times replace the device's for the day; one adds to it. A day with no punches needs both." style={{ marginBottom: space[4] }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: `0 ${space[4]}px` }}>
              <Form.Item name="inTime" label="Time in" rules={[{ pattern: TIME, message: "HH:MM, e.g. 10:00" }]} style={{ width: 140, marginBottom: space[2] }}>
                <Input placeholder="10:00" inputMode="numeric" />
              </Form.Item>
              <Form.Item name="outTime" label="Time out" rules={[{ pattern: TIME, message: "HH:MM, e.g. 19:00" }]} style={{ width: 140, marginBottom: space[2] }}>
                <Input placeholder="19:00" inputMode="numeric" />
              </Form.Item>
            </div>
          </Form.Item>
        ) : (
          <Form.Item name="status" label="The days should be" rules={[{ required: true, message: "Choose a status" }]} style={{ width: fieldWidth(300) }}>
            <Select options={infoApi.STATUS_OPTIONS} placeholder="Choose" />
          </Form.Item>
        )}
        <Form.Item name="note" label="Why? (required, kept with every change)" rules={[{ required: true, min: 5, message: "A few words, e.g. the branch device was down 15–16 September" }]}>
          <Input.TextArea rows={2} maxLength={500} showCount />
        </Form.Item>
        <Form.Item name="action" label="Then">
          <Radio.Group
            style={{ display: "flex", flexDirection: "column", gap: space[2] }}
            options={[
              { value: "RAISE", label: "Raise requests for an approver to decide" },
              { value: "RAISE_AND_APPROVE", label: "Raise and approve now", disabled: !canApprove },
            ]}
          />
        </Form.Item>
      </Form>

      {data && (
        <section aria-label="Preview" aria-live="polite" style={{ display: "flex", flexDirection: "column", gap: space[4], marginTop: space[2] }}>
          <FormGroupTitle>Preview</FormGroupTitle>
          {data.count === 0 ? (
            <ApprovalBanner tone="warning" title="Nothing in that selection can be corrected." description="See why below, then change the dates, people or correction." />
          ) : (
            <KeyValueGrid
              items={[
                { label: "Employee-days", value: <span className="ws-num">{data.count}</span> },
                { label: "People", value: <span className="ws-num">{data.employees}</span> },
                { label: "Correction", value: data.correction, wide: true },
                { label: "Then", value: data.action === "RAISE" ? "Requests are raised and wait for an approver" : "Raised and approved now; the days are worked out again", wide: true },
              ]}
            />
          )}
          {data.ownLeftOut > 0 && <ApprovalBanner tone="info" title={`${data.ownLeftOut} of your own days are left out.`} description="Nobody corrects their own attendance. Another HR admin does those." />}
          {data.cannotCorrect.length > 0 && (
            <div>
              <div style={{ fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[2] }}>Not corrected, and why</div>
              <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: space[2] }}>
                {data.cannotCorrect.map((g) => (
                  <li key={g.code} style={{ display: "flex", gap: space[2], alignItems: "baseline", flexWrap: "wrap" }}>
                    <StatusChip tone="warning">{g.count}</StatusChip>
                    <span style={{ color: v.textBody }}>{g.label}</span>
                    <span style={{ fontSize: fs.sm, color: v.textSecondary }}>e.g. {g.examples.map((e) => `${e.name} ${dayjs(e.date).format("D MMM")}`).join(", ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {data.count > 0 && (
            <>
              <DataTable<PreviewRow>
                density="compact"
                rowKey={(r) => `${r.employeeId}|${r.date}`}
                dataSource={rows}
                pagination={{ pageSize: 10, showSizeChanger: false }}
                showTotal={false}
                mobile={{
                  title: (r) => `${r.name} (${r.employeeCode})`,
                  subtitle: (r) => dayjs(r.date).format("ddd, D MMM"),
                  fields: [
                    { label: "Now", render: (r) => r.before ?? "—" },
                    { label: "After", render: (r) => <strong>{r.after ?? "—"}</strong> },
                  ],
                }}
                columns={[
                  { title: "Employee", key: "e", render: (_, r) => `${r.name} (${r.employeeCode})` },
                  { title: "Day", dataIndex: "date", render: (d: string) => <span className="ws-num">{dayjs(d).format("ddd, D MMM")}</span> },
                  { title: "Now", dataIndex: "before", render: (val: string | null) => val ?? "—" },
                  { title: "After", dataIndex: "after", render: (val: string | null) => <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{val ?? "—"}</span> },
                ]}
              />
              <Checkbox checked={looked} onChange={(e) => setLooked(e.target.checked)}>
                I have looked at these {data.count} employee-days and want them {data.action === "RAISE" ? "raised" : "corrected"}.
              </Checkbox>
            </>
          )}
        </section>
      )}
    </SideDrawer>
  );
}
