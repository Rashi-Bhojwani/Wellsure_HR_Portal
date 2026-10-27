import { useState } from "react";
import dayjs, { type Dayjs } from "dayjs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, DatePicker, Form, Input, Progress, Radio, Select } from "antd";
import { PlayCircleOutlined } from "@ant-design/icons";
import * as attendanceApi from "../../../api/attendance";
import type { ProcessRun, ProcessRunDetail } from "../../../api/attendance";
import * as orgApi from "../../../api/org";
import { EmployeePicker } from "../../../components/letters/LetterFields";
import { HelpStrip } from "../../../components/common/HelpStrip";
import { apiErrorMessage } from "../../../lib/apiError";
import { fs, fw, space, v } from "../../../theme/tokens";
import { ApprovalBanner, DataTable, EmptyState, KeyValueGrid, PageHeader, Panel, QueryState, SideDrawer, SkeletonTable, Stack, StatusChip, toast, useIsPhone, type ChipTone } from "../../../ui";
import { FinalisationReadinessCard } from "./FinalisationReadinessCard";

const long = (d: string) => dayjs(d).format("D MMM YYYY");
const STATUS: Record<string, { tone: ChipTone; label: string }> = {
  QUEUED: { tone: "neutral", label: "Queued" },
  RUNNING: { tone: "info", label: "Running" },
  COMPLETED: { tone: "success", label: "Completed" },
  FAILED: { tone: "danger", label: "Failed" },
};
const pct = (r: ProcessRun) => (r.totalDays ? Math.round((r.processedDays / r.totalDays) * 100) : 0);
const RUN_FORM = "process-attendance-form";

interface FormValues {
  range: [Dayjs, Dayjs];
  scope: "ALL" | "BRANCH" | "EMPLOYEE";
  locationId?: string;
  employeeId?: string;
  reason: string;
}

function RunStatus({ r }: { r: ProcessRun }) {
  const s = STATUS[r.status] ?? { tone: "neutral" as ChipTone, label: r.status };
  return <StatusChip tone={s.tone}>{s.label}</StatusChip>;
}

const noRecord = <span style={{ color: v.textSecondary }}>no record</span>;
type Change = ProcessRunDetail["changes"][number];

function RunDetail({ runId, onClose }: { runId: string | null; onClose: () => void }) {
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["attendance", "process", runId], queryFn: () => attendanceApi.getProcessRun(runId!), enabled: !!runId });
  return (
    <SideDrawer
      open={!!runId}
      onClose={onClose}
      size="wide"
      footer={null}
      title={data ? `${long(data.fromDate)} – ${long(data.toDate)}` : "What changed"}
      status={data ? <RunStatus r={data} /> : undefined}
    >
      <QueryState isLoading={isLoading} error={error} onRetry={() => void refetch()} skeleton={<SkeletonTable rows={8} columns={4} />}>
        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: space[5] }}>
            <KeyValueGrid
              columns={1}
              items={[
                { label: "Why", value: data.reason },
                { label: "Processed", value: <span className="ws-num">{data.processedDays} employee-days</span> },
                { label: "Changed", value: <span className="ws-num" style={{ fontWeight: fw.semibold }}>{data.changedDays}</span> },
                ...(data.lockedDays ? [{ label: "Left alone (finalised)", value: <span className="ws-num">{data.lockedDays}</span> }] : []),
              ]}
            />
            {data.error && <ApprovalBanner tone="danger" title="This run failed" description={data.error} />}
            <div>
              <div style={{ fontWeight: fw.semibold, color: v.textPrimary, fontSize: fs.lg, marginBottom: space[3] }}>
                {data.changedDays > data.changes.length ? `The first ${data.changes.length} changes` : "Changes"}
              </div>
              <DataTable<Change>
                density="compact"
                rowKey={(r) => `${r.employeeId}-${r.date}`}
                dataSource={data.changes}
                pagination={{ pageSize: 50, showSizeChanger: false }}
                empty={<EmptyState compact title="Nothing changed." description="Every day in the range already matched the rules and data." />}
                mobile={{
                  title: (r) => r.employeeCode ?? "—",
                  subtitle: (r) => long(r.date),
                  fields: [
                    { label: "Before", render: (r) => r.before ?? noRecord },
                    { label: "After", render: (r) => r.after ?? noRecord },
                  ],
                }}
                columns={[
                  { title: "Employee", dataIndex: "employeeCode" },
                  { title: "Date", dataIndex: "date", render: (d: string) => <span className="ws-num">{long(d)}</span> },
                  { title: "Before", dataIndex: "before", render: (val: string | null) => val ?? noRecord },
                  { title: "After", dataIndex: "after", render: (val: string | null) => (val ? <span style={{ fontWeight: fw.semibold, color: v.textPrimary }}>{val}</span> : noRecord) },
                ]}
              />
            </div>
          </div>
        )}
      </QueryState>
    </SideDrawer>
  );
}

// Workforce → Attendance → Process Attendance (Phase 2 P2-C, docs/plans/
// PHASE_2.md §3.1): re-run the rules engine for a range — after HR confirms a
// rule value, for instance. Finalised days are never touched.
export function ProcessAttendancePage() {
  const qc = useQueryClient();
  const phone = useIsPhone();
  const [form] = Form.useForm<FormValues>();
  const scope = Form.useWatch("scope", form);
  const [detail, setDetail] = useState<string | null>(null);
  const { data: locations = [] } = useQuery({ queryKey: ["org", "locations"], queryFn: () => orgApi.listLocations() });
  const {
    data: runs = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ["attendance", "process"],
    queryFn: attendanceApi.listProcessRuns,
    refetchInterval: (q) => ((q.state.data as ProcessRun[] | undefined)?.some((r) => r.status === "QUEUED" || r.status === "RUNNING") ? 2000 : false),
  });
  const start = useMutation({
    mutationFn: (val: FormValues) =>
      attendanceApi.startProcessRun({
        fromDate: val.range[0].format("YYYY-MM-DD"),
        toDate: val.range[1].format("YYYY-MM-DD"),
        locationId: val.scope === "BRANCH" ? val.locationId : null,
        employeeIds: val.scope === "EMPLOYEE" && val.employeeId ? [val.employeeId] : undefined,
        reason: val.reason,
      }),
    onSuccess: () => {
      toast.success("Processing started. Progress shows below.");
      void qc.invalidateQueries({ queryKey: ["attendance", "process"] });
      form.resetFields(["reason"]);
    },
    onError: (err) => toast.error(apiErrorMessage(err, "Could not start processing.")),
  });

  const progress = (r: ProcessRun) => (
    <Progress size="small" percent={pct(r)} status={r.status === "FAILED" ? "exception" : r.status === "RUNNING" ? "active" : undefined} style={{ width: phone ? "100%" : 140, margin: 0 }} aria-label={`${pct(r)}% processed`} />
  );
  const whatChanged = (r: ProcessRun) => (
    <Button size={phone ? "middle" : "small"} onClick={() => setDetail(r.id)}>
      What changed
    </Button>
  );

  return (
    <>
      <PageHeader title="Process Attendance" subtitle="Work attendance days out again from punches, entries, leave, holidays and the rules" />
      <Stack>
        <HelpStrip storageKey="process-attendance-help">
          Every attendance day is worked out from raw punches, manual entries, leave, holidays and the attendance rules. When a rule value changes — say HR confirms the
          half-day hours — process the affected range here and every day is recomputed. Days already finalised are never changed.
        </HelpStrip>

        <Panel title="Process a range" subtitle="Finalised days in the range are skipped">
          <Form
            id={RUN_FORM}
            form={form}
            layout="vertical"
            requiredMark={false}
            initialValues={{ scope: "ALL", range: [dayjs().startOf("month"), dayjs()] }}
            onFinish={(val) => start.mutate(val)}
            style={{ maxWidth: 640 }}
          >
            <Form.Item name="range" label="Dates" rules={[{ required: true, message: "Choose the dates" }]}>
              <DatePicker.RangePicker style={{ width: phone ? "100%" : undefined }} format="D MMM YYYY" disabledDate={(d) => d.isAfter(dayjs(), "day")} allowClear={false} />
            </Form.Item>
            <Form.Item name="scope" label="Who">
              <Radio.Group options={[{ value: "ALL", label: "Everyone" }, { value: "BRANCH", label: "A branch" }, { value: "EMPLOYEE", label: "One employee" }]} />
            </Form.Item>
            {scope === "BRANCH" && (
              <Form.Item name="locationId" label="Branch" rules={[{ required: true, message: "Choose a branch" }]}>
                <Select placeholder="Choose a branch" options={locations.map((l) => ({ value: l.id, label: l.name }))} />
              </Form.Item>
            )}
            {scope === "EMPLOYEE" && (
              <Form.Item name="employeeId" label="Employee" rules={[{ required: true, message: "Choose an employee" }]}>
                <EmployeePicker />
              </Form.Item>
            )}
            <Form.Item name="reason" label="Why" rules={[{ required: true, min: 5, message: "Say why, e.g. HR confirmed the half-day hours" }]}>
              <Input placeholder="e.g. HR confirmed the half-day hours" />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<PlayCircleOutlined />} loading={start.isPending} block={phone}>
              Process
            </Button>
          </Form>
        </Panel>

        <Panel title="Runs" subtitle="Newest first. Progress updates on its own while a run is going.">
          {runs.some((r) => r.status === "FAILED") && (
            <ApprovalBanner tone="danger" style={{ marginBottom: space[4] }} title="A run failed. The error is shown on the run; the days it hadn't reached are unchanged." />
          )}
          <DataTable<ProcessRun>
            rowKey="id"
            loading={isLoading}
            error={error}
            onRetry={() => void refetch()}
            dataSource={runs}
            pagination={false}
            onRowOpen={(r) => setDetail(r.id)}
            empty={<EmptyState compact illustration="calendar" title="No runs yet." description="Process a range above and the run shows here with its progress." />}
            mobile={{
              title: (r) => `${long(r.fromDate)} – ${long(r.toDate)}`,
              subtitle: (r) => `Requested ${dayjs(r.requestedAt).format("D MMM YYYY, HH:mm")}`,
              status: (r) => <RunStatus r={r} />,
              fields: [
                { label: "Why", render: (r) => r.reason },
                { label: "Progress", render: progress },
                { label: "Changed", render: (r) => <span className="ws-num">{r.changedDays}</span> },
                { label: "Finalised (skipped)", render: (r) => <span className="ws-num">{r.lockedDays}</span> },
              ],
              actions: whatChanged,
            }}
            columns={[
              { title: "Requested", dataIndex: "requestedAt", render: (val: string) => <span className="ws-num">{dayjs(val).format("D MMM YYYY, HH:mm")}</span> },
              { title: "Range", key: "range", render: (_, r) => <span className="ws-num">{`${long(r.fromDate)} – ${long(r.toDate)}`}</span> },
              { title: "Why", dataIndex: "reason" },
              {
                title: "Status",
                dataIndex: "status",
                render: (_: string, r) => (
                  <div style={{ display: "flex", flexDirection: "column", gap: space[1], alignItems: "flex-start" }}>
                    <RunStatus r={r} />
                    {r.error && <span style={{ fontSize: fs.sm, color: v.danger, maxWidth: 240 }}>{r.error}</span>}
                  </div>
                ),
              },
              { title: "Progress", key: "progress", render: (_, r) => progress(r) },
              { title: "Changed", dataIndex: "changedDays", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
              { title: "Finalised (skipped)", dataIndex: "lockedDays", align: "right", render: (n: number) => <span className="ws-num">{n}</span> },
              { title: "", key: "view", align: "right", render: (_, r) => whatChanged(r) },
            ]}
          />
        </Panel>

        <FinalisationReadinessCard />
      </Stack>
      <RunDetail runId={detail} onClose={() => setDetail(null)} />
    </>
  );
}
