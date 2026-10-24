import { useEffect, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Col, Form, Input, InputNumber, Row, Select, Switch } from "antd";
import {
  AlertOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  CustomerServiceOutlined,
  EditOutlined,
  FileTextOutlined,
  HeartOutlined,
  LockOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import {
  DIRECTORY_FIELD_LABELS,
  DIRECTORY_TOGGLEABLE_FIELDS,
  DOCUMENT_MIME_TYPES,
  MAX_DOCUMENT_UPLOAD_MB_CEILING,
  MAX_PHOTO_UPLOAD_MB_CEILING,
  SUPPORTED_DOCUMENT_MIME_TYPES,
} from "@shared/constants/peopleDocuments";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as settingsApi from "../../../api/settings";
import type { DeviceAlertSettings, DeviceHealthThresholds, HelpdeskSettings, LeaveSettings, PeopleDocumentsSettings, RegularizationSettings, SecuritySettings } from "../../../api/settings";
import { LettersSettingsCard } from "../../../components/letters/LettersSettingsCard";
import { useAuth } from "../../../hooks/useAuth";
import { FormGroupTitle, PageHeader, Panel, QueryState, Skel, toast } from "../../../ui";
import { fs, fw, radius, space, v } from "../../../theme/tokens";
import { SectionIntro, SectionNav, SettingsLayout, SwitchList, ToggleRow, type SectionNavItem } from "./SettingsNav";

const ROLE_OPTIONS = ["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "APPROVER", "EMPLOYEE"].map((r) => ({ value: r, label: r }));

const RATE_LIMIT_LABELS: Record<keyof SecuritySettings["rateLimits"], string> = {
  login: "Login",
  totpVerify: "2FA verify",
  inviteAccept: "Accept invitation",
  forgotPassword: "Forgot password",
  resetPassword: "Reset password",
};

// Two fields per row on desktop (settings-01), one on phones.
const half = { xs: 24, md: 12 } as const;

/** Form skeleton shaped like a settings panel: label + input pairs in two columns, then the Save button. */
function SettingsSkeleton({ fields = 4 }: { fields?: number }) {
  return (
    <Panel>
      <Skel w={220} h={22} />
      <Skel w="70%" h={14} style={{ marginTop: space[3] }} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(260px, 100%), 1fr))", gap: space[5], marginTop: space[6] }}>
        {Array.from({ length: fields }, (_, i) => (
          <div key={i}>
            <Skel w={160} h={14} />
            <Skel h={48} r={radius.md} style={{ marginTop: space[2] }} />
          </div>
        ))}
      </div>
      <Skel w={140} h={48} r={radius.md} style={{ marginTop: space[6] }} />
    </Panel>
  );
}

function SaveButton({ loading, label = "Save changes" }: { loading: boolean; label?: string }) {
  return (
    <Form.Item style={{ marginTop: space[2], marginBottom: 0 }}>
      <Button type="primary" htmlType="submit" size="large" loading={loading} style={{ minWidth: 140 }}>
        {label}
      </Button>
    </Form.Item>
  );
}

/** Loading / error / content for one settings section, in the board's right-hand panel. */
function SettingsSection({ title, isLoading, error, onRetry, fields, children }: { title: string; isLoading: boolean; error: unknown; onRetry: () => void; fields?: number; children: ReactNode }) {
  return (
    <QueryState isLoading={isLoading} error={error} onRetry={onRetry} skeleton={<SettingsSkeleton fields={fields} />}>
      <Panel title={title}>{children}</Panel>
    </QueryState>
  );
}

// Separate card + independent save, matching the two separate backend
// endpoints (GET/PUT /api/settings/security vs /leave) rather than one
// combined form — the Leave section is deliberately small: a closed
// catalog of typed settings (see settings/service.ts's comment), not a
// generic key-value editor, so this is exactly as small as it should be.
function LeaveSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "leave"], queryFn: settingsApi.getLeaveSettings });
  const [form] = Form.useForm<LeaveSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: LeaveSettings) => settingsApi.updateLeaveSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "leave"], updated);
      toast.success("Leave settings saved.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });

  return (
    <SettingsSection title="Year-end PL encashment" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={1}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <SectionIntro>One flat rupee amount per encashed leave day, used by Year End Process — pending CA confirmation of both the rate and its tax treatment (spec §5.2).</SectionIntro>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="encashmentDefaultDailyRate" label="Default daily rate (₹)">
                <InputNumber min={0} step={1} style={{ width: "100%" }} placeholder="Not configured" />
              </Form.Item>
            </Col>
          </Row>
          <SaveButton loading={saveMutation.isPending} />
        </Form>
      )}
    </SettingsSection>
  );
}

// Phase 2 P2-H — Attendance → Device alerts: how long a device or agent may go
// quiet before it is an incident, the morning check, and who is told.
function DeviceAlertSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "device-alerts"], queryFn: settingsApi.getDeviceAlertSettings });
  const [form] = Form.useForm<DeviceAlertSettings>();
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const save = useMutation({
    mutationFn: (values: DeviceAlertSettings) => settingsApi.updateDeviceAlertSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "device-alerts"], updated);
      toast.success("Device alert settings saved. The next check (within a minute) uses them.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });
  return (
    <SettingsSection title="Device alerts" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={6}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => save.mutate(values)} requiredMark={false}>
          <SectionIntro>
            Every minute the system checks each device and sync agent. A device not heard from for the time below <em>during its working hours</em> (taken from the shifts of the people
            expected at its branch; never on a holiday or week-off) becomes an incident, as does an agent whose heartbeat is late during those hours (plus the margin below, so a
            PC switched off overnight is not an alert every night), a morning with no punches at all from a reachable device, a wrong clock, or a log at risk. HR is told once when it opens, once more if it is still open at the start of the next working day, and once when it closes
            (saying how long it lasted and how many punches arrived afterwards).
          </SectionIntro>
          <FormGroupTitle>When something is an incident</FormGroupTitle>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="deviceSilentMinutes" label="Device quiet for (minutes)" rules={[{ required: true }]}>
                <InputNumber min={5} max={480} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="agentSilentMinutes" label="Agent heartbeat late by (minutes)" rules={[{ required: true }]}>
                <InputNumber min={2} max={240} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="agentWindowMarginMinutes" label="Agent hours margin (minutes)" rules={[{ required: true }]} extra="The agent is expected up this long before the shift starts and after it ends.">
                <InputNumber min={0} max={240} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="morningCheckTime" label="Morning check at (HH:MM)" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "24-hour HH:MM, e.g. 10:30" }]} extra="Never earlier than the window start plus the quiet time.">
                <Input placeholder="10:30" style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="recoverySettleSeconds" label="Recovery notice waits (seconds)" extra="So a catching-up agent's backlog arrives first." rules={[{ required: true }]}>
                <InputNumber min={0} max={900} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <FormGroupTitle>Who is told</FormGroupTitle>
          <div style={{ marginBottom: space[5] }}>
            <ToggleRow
              htmlFor="device-alerts-super-admins"
              title="Email every Super Admin"
              description="Resolved when an alert is sent, so it stays right when Super Admins change."
              control={
                <Form.Item name="alertSuperAdmins" valuePropName="checked" noStyle>
                  <Switch id="device-alerts-super-admins" />
                </Form.Item>
              }
            />
          </div>
          <Form.Item name="alertEmails" label="Also email these addresses" extra="In addition to everyone who can manage devices (who also get an in-app notification).">
            <Select mode="tags" tokenSeparators={[",", " "]} placeholder="Type an address and press Enter" open={false} />
          </Form.Item>
          <SaveButton loading={save.isPending} label="Save" />
        </Form>
      )}
    </SettingsSection>
  );
}

// Phase 3 commit 1 — Attendance → Regularization: how far back a correction may reach and the caps on a
// bulk correction, so a mistake can't rewrite a quarter.
function RegularizationSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "regularization"], queryFn: settingsApi.getRegularizationSettings });
  const [form] = Form.useForm<RegularizationSettings>();
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const save = useMutation({
    mutationFn: (values: RegularizationSettings) => settingsApi.updateRegularizationSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "regularization"], updated);
      toast.success("Regularization settings saved.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });
  return (
    <SettingsSection title="Regularization" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={3}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => save.mutate(values)} requiredMark={false}>
          <SectionIntro>
            An employee, or HR in bulk, can ask for a correction to a past day: missing punches, wrong times or a wrong status. A correction never reaches into a finalised period. The caps below stop a mistake from rewriting
            a quarter: a bulk correction must fit inside both.
          </SectionIntro>
          <Row gutter={[24, 0]}>
            <Col xs={24}>
              <Form.Item name="backdateCycles" label="Reach back (attendance cycles before the current one)" extra="1 = this cycle and the one before; 0 = this cycle only." rules={[{ required: true }]}>
                <InputNumber min={0} max={3} precision={0} style={{ width: "100%", maxWidth: 360 }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="bulkMaxRangeDays" label="Bulk correction: longest date range (days)" rules={[{ required: true }]}>
                <InputNumber min={1} max={92} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="bulkMaxEmployeeDays" label="Bulk correction: most employee-days at once" rules={[{ required: true }]}>
                <InputNumber min={1} max={5000} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <SaveButton loading={save.isPending} label="Save" />
        </Form>
      )}
    </SettingsSection>
  );
}

// Phase 3 commit 4 — Attendance → Excess hours: the smallest excess the Excess hours report lists. There is no overtime
// policy yet; the report says so, and these hours are not payable overtime.
function ExcessHoursSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "excess-hours"], queryFn: settingsApi.getExcessHoursSettings });
  const [form] = Form.useForm<{ minMinutes: number }>();
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const save = useMutation({
    mutationFn: (values: { minMinutes: number }) => settingsApi.updateExcessHoursSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "excess-hours"], updated);
      toast.success("Excess hours setting saved.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save the setting.")),
  });
  return (
    <SettingsSection title="Excess hours" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={1}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => save.mutate(values)} requiredMark={false}>
          <SectionIntro>
            The Excess hours report lists the minutes people worked beyond the end of their shift. Overtime is not defined yet (no rate, no eligibility, no approval), so these hours are not payable overtime: the report only shows them.
            Days with less excess than the number below are left out.
          </SectionIntro>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="minMinutes" label="Smallest excess to list (minutes)" extra="0 lists every minute beyond the shift end." rules={[{ required: true }]}>
                <InputNumber min={0} max={600} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <SaveButton loading={save.isPending} label="Save" />
        </Form>
      )}
    </SettingsSection>
  );
}

// Phase 2 P2-F — Attendance → Device health. Sent to every sync agent in its
// heartbeat, and used for the warnings on the Devices screen and Admin Home.
// The silence and morning-check settings are the Device alerts section.
function DeviceHealthSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "device-health"], queryFn: settingsApi.getDeviceHealthSettings });
  const [form] = Form.useForm<DeviceHealthThresholds>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: DeviceHealthThresholds) => settingsApi.updateDeviceHealthSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "device-health"], updated);
      void queryClient.invalidateQueries({ queryKey: ["biometric"] });
      toast.success("Device health settings saved. Each sync agent picks them up at its next heartbeat.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });

  return (
    <SettingsSection title="Device health" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={4}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <SectionIntro>
            A device&apos;s log holds only so many punches (set per device on the Devices screen). If it isn&apos;t read for a share of that window, HR is warned, then
            alarmed, before punches can be overwritten. A device clock further than the drift limit from the server&apos;s is a warning: every punch on it carries the
            wrong time until someone sets it from the device&apos;s own menu (the system never changes it).
          </SectionIntro>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="retentionWarningPercent" label="Warning at (% of window)" rules={[{ required: true }]}>
                <InputNumber min={1} max={99} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item
                name="retentionAlarmPercent"
                label="Alarm at (% of window)"
                dependencies={["retentionWarningPercent"]}
                rules={[
                  { required: true },
                  ({ getFieldValue }) => ({
                    validator: (_, val: number) => (val > getFieldValue("retentionWarningPercent") ? Promise.resolve() : Promise.reject(new Error("Must be above the warning."))),
                  }),
                ]}
              >
                <InputNumber min={2} max={100} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="logNearlyFullPercent" label="Log nearly full at (%)" rules={[{ required: true }]}>
                <InputNumber min={50} max={100} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="clockDriftWarningSeconds" label="Clock drift warning (seconds)" rules={[{ required: true }]}>
                <InputNumber min={10} max={3600} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <SaveButton loading={saveMutation.isPending} />
        </Form>
      )}
    </SettingsSection>
  );
}

// Phase 5 commit D — Helpdesk. Employees see the exact dates these produce
// on every resolved ticket ("closes automatically on …", "reopen until …").
function HelpdeskSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "helpdesk"], queryFn: settingsApi.getHelpdeskSettings });
  const [form] = Form.useForm<HelpdeskSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: HelpdeskSettings) => settingsApi.updateHelpdeskSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "helpdesk"], updated);
      void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
      toast.success("Helpdesk settings saved.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });

  return (
    <SettingsSection title="Helpdesk" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={2}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <SectionIntro>
            A resolved ticket closes by itself after this many quiet days unless the employee replies, and can be reopened within the reopen window. Employees always
            see both dates on the ticket. Changes apply to existing resolved tickets too.
          </SectionIntro>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="autoCloseDays" label="Auto-close after (days)" rules={[{ required: true }]}>
                <InputNumber min={1} max={90} step={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="reopenWindowDays" label="Reopen window (days)" rules={[{ required: true }]}>
                <InputNumber min={1} max={90} step={1} precision={0} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>
          <SaveButton loading={saveMutation.isPending} />
        </Form>
      )}
    </SettingsSection>
  );
}

// Phase 5 commit C — who sees what in the People directory, and upload
// limits for photos and documents. One company-wide setting (no per-employee
// opt-out); the always-shown core (name, photo, code, designation,
// department, branch) isn't listed because it can't be turned off.
function PeopleDocumentsSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "people-documents"], queryFn: settingsApi.getPeopleDocumentsSettings });
  const [form] = Form.useForm<PeopleDocumentsSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: PeopleDocumentsSettings) => settingsApi.updatePeopleDocumentsSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "people-documents"], updated);
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      toast.success("People & Documents settings saved.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });

  return (
    <SettingsSection title="People directory" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={4}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <SectionIntro>
            Everyone always sees a colleague's name, photo, employee code, designation, department and branch. Choose what else is shown — this applies company-wide.
            The org chart always shows reporting lines.
          </SectionIntro>
          <Form.Item name="directoryVisibleFields">
            <SwitchList id="directory-fields" options={DIRECTORY_TOGGLEABLE_FIELDS.map((f) => ({ value: f, label: DIRECTORY_FIELD_LABELS[f] }))} />
          </Form.Item>
          <FormGroupTitle>Uploads</FormGroupTitle>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="photoMaxUploadMb" label="Photo size limit (MB)" rules={[{ required: true }]} extra="Photos are resized and re-encoded, so stored files stay small.">
                <InputNumber min={0.1} max={MAX_PHOTO_UPLOAD_MB_CEILING} step={0.5} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="documentMaxUploadMb" label="Document size limit (MB)" rules={[{ required: true }]}>
                <InputNumber min={0.1} max={MAX_DOCUMENT_UPLOAD_MB_CEILING} step={1} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24}>
              <Form.Item name="documentAllowedMimeTypes" label="Allowed document types" rules={[{ required: true, type: "array", min: 1, message: "Allow at least one type." }]}>
                <Select mode="multiple" options={SUPPORTED_DOCUMENT_MIME_TYPES.map((m) => ({ value: m, label: DOCUMENT_MIME_TYPES[m].label }))} />
              </Form.Item>
            </Col>
          </Row>
          <SaveButton loading={saveMutation.isPending} />
        </Form>
      )}
    </SettingsSection>
  );
}

function SecuritySettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ["settings", "security"], queryFn: settingsApi.getSecuritySettings });
  const [form] = Form.useForm<SecuritySettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: SecuritySettings) => settingsApi.updateSecuritySettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "security"], updated);
      toast.success("Security settings saved.");
    },
    onError: (err) => toast.error(errorMessage(err, "Could not save settings.")),
  });

  return (
    <SettingsSection title="Security" isLoading={isLoading || (!data && !error)} error={error} onRetry={() => void refetch()} fields={6}>
      {data && (
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <SectionIntro>Security policy for Phase 1 — lockout, password rules, invitation validity, 2FA and auth rate limits.</SectionIntro>
          <FormGroupTitle>Account lockout</FormGroupTitle>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="lockoutMaxAttempts" label="Failed attempts before lockout" rules={[{ required: true }]}>
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="lockoutMinutes" label="Lockout duration (minutes)" rules={[{ required: true }]}>
                <InputNumber min={1} max={1440} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>

          <FormGroupTitle>Password &amp; invitations</FormGroupTitle>
          <Row gutter={[24, 0]}>
            <Col {...half}>
              <Form.Item name="passwordMinLength" label="Minimum password length" rules={[{ required: true }]}>
                <InputNumber min={6} max={64} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col {...half}>
              <Form.Item name="invitationTtlHours" label="Invitation link validity (hours)" rules={[{ required: true }]}>
                <InputNumber min={1} max={336} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>

          <FormGroupTitle>Two-factor authentication</FormGroupTitle>
          <Form.Item name="require2faRoles" label="Roles required to set up 2FA">
            <Select mode="multiple" options={ROLE_OPTIONS} placeholder="No role requires 2FA" />
          </Form.Item>

          <FormGroupTitle>Auth endpoint rate limits</FormGroupTitle>
          <SectionIntro>Per-IP limits on sensitive, unauthenticated endpoints — stops the endpoint itself being hammered.</SectionIntro>
          <div style={{ display: "flex", flexDirection: "column", gap: space[3], marginBottom: space[5] }}>
            {(Object.keys(RATE_LIMIT_LABELS) as (keyof SecuritySettings["rateLimits"])[]).map((key) => (
              <div key={key} style={{ border: `1px solid ${v.borderDefault}`, borderRadius: radius.md, padding: `${space[4]}px ${space[5]}px 0` }}>
                <div style={{ fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary, marginBottom: space[2] }}>{RATE_LIMIT_LABELS[key]}</div>
                <Row gutter={[24, 0]}>
                  <Col xs={12}>
                    <Form.Item name={["rateLimits", key, "maxAttempts"]} label="Max attempts" rules={[{ required: true }]}>
                      <InputNumber min={1} max={1000} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col xs={12}>
                    <Form.Item name={["rateLimits", key, "windowSeconds"]} label="Window (seconds)" rules={[{ required: true }]}>
                      <InputNumber min={1} max={86400} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
            ))}
          </div>

          <SaveButton loading={saveMutation.isPending} />
        </Form>
      )}
    </SettingsSection>
  );
}

function LettersSection() {
  // LettersSettingsCard (components/letters) brings its own card and save.
  return <LettersSettingsCard />;
}

export function SystemSettingsPage() {
  const { hasPermission } = useAuth();
  const canLetters = hasPermission("letters.template.manage");
  const [params, setParams] = useSearchParams();

  const sections: (SectionNavItem & { render: () => ReactNode })[] = [
    { key: "security", label: "Security", icon: <LockOutlined />, group: "General", render: () => <SecuritySettingsCard /> },
    { key: "leave", label: "Leave encashment", icon: <CalendarOutlined />, group: "Leave & people", render: () => <LeaveSettingsCard /> },
    { key: "people", label: "People & documents", icon: <TeamOutlined />, group: "Leave & people", render: () => <PeopleDocumentsSettingsCard /> },
    { key: "helpdesk", label: "Helpdesk", icon: <CustomerServiceOutlined />, group: "Leave & people", render: () => <HelpdeskSettingsCard /> },
    ...(canLetters ? [{ key: "letters", label: "Letters", icon: <FileTextOutlined />, group: "Leave & people", render: () => <LettersSection /> }] : []),
    { key: "device-health", label: "Device health", icon: <HeartOutlined />, group: "Attendance", render: () => <DeviceHealthSettingsCard /> },
    { key: "device-alerts", label: "Device alerts", icon: <AlertOutlined />, group: "Attendance", render: () => <DeviceAlertSettingsCard /> },
    { key: "regularization", label: "Regularization", icon: <EditOutlined />, group: "Attendance", render: () => <RegularizationSettingsCard /> },
    { key: "excess-hours", label: "Excess hours", icon: <ClockCircleOutlined />, group: "Attendance", render: () => <ExcessHoursSettingsCard /> },
  ];
  const requested = params.get("section");
  const active = sections.find((s) => s.key === requested) ?? sections[0]!;

  return (
    <>
      <PageHeader title="System Settings" subtitle="Company-wide policies: security, leave, people, helpdesk and attendance." />
      <SettingsLayout
        nav={
          <SectionNav
            label="Settings sections"
            items={sections}
            active={active.key}
            onChange={(key) => {
              const next = new URLSearchParams(params);
              next.set("section", key);
              setParams(next, { replace: true });
            }}
          />
        }
      >
        <div key={active.key}>{active.render()}</div>
      </SettingsLayout>
    </>
  );
}
