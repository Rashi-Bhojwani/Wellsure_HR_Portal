import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Checkbox, Col, Divider, Form, Input, InputNumber, Row, Select, Space, Switch, Typography, message } from "antd";
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
import { EmptyState } from "../../../components/common/EmptyState";

const { Title, Text } = Typography;

const ROLE_OPTIONS = ["SUPER_ADMIN", "HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "MANAGER", "APPROVER", "EMPLOYEE"].map((r) => ({ value: r, label: r }));

const RATE_LIMIT_LABELS: Record<keyof SecuritySettings["rateLimits"], string> = {
  login: "Login",
  totpVerify: "2FA verify",
  inviteAccept: "Accept invitation",
  forgotPassword: "Forgot password",
  resetPassword: "Reset password",
};

// Separate card + independent save, matching the two separate backend
// endpoints (GET/PUT /api/settings/security vs /leave) rather than one
// combined form — the Leave section is deliberately small: a closed
// catalog of typed settings (see settings/service.ts's comment), not a
// generic key-value editor, so this is exactly as small as it should be.
function LeaveSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "leave"], queryFn: settingsApi.getLeaveSettings });
  const [form] = Form.useForm<LeaveSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: LeaveSettings) => settingsApi.updateLeaveSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "leave"], updated);
      void message.success("Leave settings saved.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });

  if (isLoading || !data) return <EmptyState message="Loading…" />;

  return (
    <Card>
      <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
        <Title level={5}>Year-end PL encashment</Title>
        <Text type="secondary">
          One flat rupee amount per encashed leave day, used by Year End Process — pending CA confirmation of both the rate and its tax treatment (spec §5.2).
        </Text>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="encashmentDefaultDailyRate" label="Default daily rate (₹)">
              <InputNumber min={0} step={1} style={{ width: "100%" }} placeholder="Not configured" />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save changes
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// Phase 2 P2-H — Attendance → Device alerts: how long a device or agent may go
// quiet before it is an incident, the morning check, and who is told.
function DeviceAlertSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "device-alerts"], queryFn: settingsApi.getDeviceAlertSettings });
  const [form] = Form.useForm<DeviceAlertSettings>();
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const save = useMutation({
    mutationFn: (values: DeviceAlertSettings) => settingsApi.updateDeviceAlertSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "device-alerts"], updated);
      void message.success("Device alert settings saved. The next check (within a minute) uses them.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });
  if (isLoading || !data) return <EmptyState message="Loading…" />;
  return (
    <Card>
      <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => save.mutate(values)} requiredMark={false}>
        <Title level={5}>Device alerts</Title>
        <Text type="secondary">
          Every minute the system checks each device and sync agent. A device not heard from for the time below <em>during its working hours</em> (taken from the shifts of the people
          expected at its branch; never on a holiday or week-off) becomes an incident, as does an agent whose heartbeat is late during those hours (plus the margin below, so a
          PC switched off overnight is not an alert every night), a morning with no punches at all from a reachable device, a wrong clock, or a log at risk. HR is told once when it opens, once more if it is still open at the start of the next working day, and once when it closes
          (saying how long it lasted and how many punches arrived afterwards).
        </Text>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="deviceSilentMinutes" label="Device quiet for (minutes)" rules={[{ required: true }]}>
              <InputNumber min={5} max={480} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="agentSilentMinutes" label="Agent heartbeat late by (minutes)" rules={[{ required: true }]}>
              <InputNumber min={2} max={240} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="agentWindowMarginMinutes" label="Agent hours margin (minutes)" rules={[{ required: true }]} extra="The agent is expected up this long before the shift starts and after it ends.">
              <InputNumber min={0} max={240} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="morningCheckTime" label="Morning check at (HH:MM)" rules={[{ required: true, pattern: /^([01]\d|2[0-3]):[0-5]\d$/, message: "24-hour HH:MM, e.g. 10:30" }]} extra="Never earlier than the window start plus the quiet time.">
              <Input placeholder="10:30" style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="recoverySettleSeconds" label="Recovery notice waits (seconds)" extra="So a catching-up agent's backlog arrives first." rules={[{ required: true }]}>
              <InputNumber min={0} max={900} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col xs={24} md={8}>
            <Form.Item name="alertSuperAdmins" label="Email every Super Admin" valuePropName="checked" extra="Resolved when an alert is sent, so it stays right when Super Admins change.">
              <Switch />
            </Form.Item>
          </Col>
          <Col xs={24} md={16}>
            <Form.Item name="alertEmails" label="Also email these addresses" extra="In addition to everyone who can manage devices (who also get an in-app notification).">
              <Select mode="tags" tokenSeparators={[",", " "]} placeholder="Type an address and press Enter" open={false} />
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Save
        </Button>
      </Form>
    </Card>
  );
}

// Phase 3 commit 1 — Attendance → Regularization: how far back a correction may reach and the caps on a
// bulk correction, so a mistake can't rewrite a quarter.
function RegularizationSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "regularization"], queryFn: settingsApi.getRegularizationSettings });
  const [form] = Form.useForm<RegularizationSettings>();
  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);
  const save = useMutation({
    mutationFn: (values: RegularizationSettings) => settingsApi.updateRegularizationSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "regularization"], updated);
      void message.success("Regularization settings saved.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });
  if (isLoading || !data) return <EmptyState message="Loading…" />;
  return (
    <Card>
      <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => save.mutate(values)} requiredMark={false}>
        <Title level={5}>Regularization</Title>
        <Text type="secondary">
          An employee, or HR in bulk, can ask for a correction to a past day: missing punches, wrong times or a wrong status. A correction never reaches into a finalised period. The caps below stop a mistake from rewriting
          a quarter: a bulk correction must fit inside both.
        </Text>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} md={8}>
            <Form.Item name="backdateCycles" label="Reach back (attendance cycles before the current one)" extra="1 = this cycle and the one before; 0 = this cycle only." rules={[{ required: true }]}>
              <InputNumber min={0} max={3} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="bulkMaxRangeDays" label="Bulk correction: longest date range (days)" rules={[{ required: true }]}>
              <InputNumber min={1} max={92} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={8}>
            <Form.Item name="bulkMaxEmployeeDays" label="Bulk correction: most employee-days at once" rules={[{ required: true }]}>
              <InputNumber min={1} max={5000} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Save
        </Button>
      </Form>
    </Card>
  );
}

// Phase 2 P2-F — Attendance → Device health. Sent to every sync agent in its
// heartbeat, and used for the warnings on the Devices screen and Admin Home.
// The silence and morning-check settings are the Device alerts card below.
function DeviceHealthSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "device-health"], queryFn: settingsApi.getDeviceHealthSettings });
  const [form] = Form.useForm<DeviceHealthThresholds>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: DeviceHealthThresholds) => settingsApi.updateDeviceHealthSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "device-health"], updated);
      void queryClient.invalidateQueries({ queryKey: ["biometric"] });
      void message.success("Device health settings saved. Each sync agent picks them up at its next heartbeat.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });

  if (isLoading || !data) return <EmptyState message="Loading…" />;

  return (
    <Card>
      <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
        <Title level={5}>Device health</Title>
        <Text type="secondary">
          A device&apos;s log holds only so many punches (set per device on the Devices screen). If it isn&apos;t read for a share of that window, HR is warned, then
          alarmed, before punches can be overwritten. A device clock further than the drift limit from the server&apos;s is a warning: every punch on it carries the
          wrong time until someone sets it from the device&apos;s own menu (the system never changes it).
        </Text>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="retentionWarningPercent" label="Warning at (% of window)" rules={[{ required: true }]}>
              <InputNumber min={1} max={99} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item
              name="retentionAlarmPercent"
              label="Alarm at (% of window)"
              dependencies={["retentionWarningPercent"]}
              rules={[
                { required: true },
                ({ getFieldValue }) => ({
                  validator: (_, v: number) => (v > getFieldValue("retentionWarningPercent") ? Promise.resolve() : Promise.reject(new Error("Must be above the warning."))),
                }),
              ]}
            >
              <InputNumber min={2} max={100} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="logNearlyFullPercent" label="Log nearly full at (%)" rules={[{ required: true }]}>
              <InputNumber min={50} max={100} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="clockDriftWarningSeconds" label="Clock drift warning (seconds)" rules={[{ required: true }]}>
              <InputNumber min={10} max={3600} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save changes
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// Phase 5 commit D — Helpdesk. Employees see the exact dates these produce
// on every resolved ticket ("closes automatically on …", "reopen until …").
function HelpdeskSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "helpdesk"], queryFn: settingsApi.getHelpdeskSettings });
  const [form] = Form.useForm<HelpdeskSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: HelpdeskSettings) => settingsApi.updateHelpdeskSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "helpdesk"], updated);
      void queryClient.invalidateQueries({ queryKey: ["helpdesk"] });
      void message.success("Helpdesk settings saved.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });

  if (isLoading || !data) return <EmptyState message="Loading…" />;

  return (
    <Card>
      <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
        <Title level={5}>Helpdesk</Title>
        <Text type="secondary">
          A resolved ticket closes by itself after this many quiet days unless the employee replies, and can be reopened within the reopen window. Employees always
          see both dates on the ticket. Changes apply to existing resolved tickets too.
        </Text>
        <Row gutter={16} style={{ marginTop: 12 }}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="autoCloseDays" label="Auto-close after (days)" rules={[{ required: true }]}>
              <InputNumber min={1} max={90} step={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="reopenWindowDays" label="Reopen window (days)" rules={[{ required: true }]}>
              <InputNumber min={1} max={90} step={1} precision={0} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save changes
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

// Phase 5 commit C — who sees what in the People directory, and upload
// limits for photos and documents. One company-wide setting (no per-employee
// opt-out); the always-shown core (name, photo, code, designation,
// department, branch) isn't listed because it can't be turned off.
function PeopleDocumentsSettingsCard() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "people-documents"], queryFn: settingsApi.getPeopleDocumentsSettings });
  const [form] = Form.useForm<PeopleDocumentsSettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: PeopleDocumentsSettings) => settingsApi.updatePeopleDocumentsSettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "people-documents"], updated);
      void queryClient.invalidateQueries({ queryKey: ["people"] });
      void message.success("People & Documents settings saved.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });

  if (isLoading || !data) return <EmptyState message="Loading…" />;

  return (
    <Card>
      <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
        <Title level={5}>People directory</Title>
        <Text type="secondary">
          Everyone always sees a colleague's name, photo, employee code, designation, department and branch. Choose what else is shown — this applies company-wide.
          The org chart always shows reporting lines.
        </Text>
        <Form.Item name="directoryVisibleFields" style={{ marginTop: 12 }}>
          <Checkbox.Group options={DIRECTORY_TOGGLEABLE_FIELDS.map((f) => ({ value: f, label: DIRECTORY_FIELD_LABELS[f] }))} />
        </Form.Item>
        <Divider />
        <Title level={5}>Uploads</Title>
        <Row gutter={16}>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="photoMaxUploadMb" label="Photo size limit (MB)" rules={[{ required: true }]} extra="Photos are resized and re-encoded, so stored files stay small.">
              <InputNumber min={0.1} max={MAX_PHOTO_UPLOAD_MB_CEILING} step={0.5} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} sm={12} md={6}>
            <Form.Item name="documentMaxUploadMb" label="Document size limit (MB)" rules={[{ required: true }]}>
              <InputNumber min={0.1} max={MAX_DOCUMENT_UPLOAD_MB_CEILING} step={1} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
          <Col xs={24} md={12}>
            <Form.Item name="documentAllowedMimeTypes" label="Allowed document types" rules={[{ required: true, type: "array", min: 1, message: "Allow at least one type." }]}>
              <Select mode="multiple" options={SUPPORTED_DOCUMENT_MIME_TYPES.map((m) => ({ value: m, label: DOCUMENT_MIME_TYPES[m].label }))} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
            Save changes
          </Button>
        </Form.Item>
      </Form>
    </Card>
  );
}

export function SystemSettingsPage() {
  const { hasPermission } = useAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["settings", "security"], queryFn: settingsApi.getSecuritySettings });
  const [form] = Form.useForm<SecuritySettings>();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const saveMutation = useMutation({
    mutationFn: (values: SecuritySettings) => settingsApi.updateSecuritySettings(values),
    onSuccess: (updated) => {
      queryClient.setQueryData(["settings", "security"], updated);
      void message.success("Security settings saved.");
    },
    onError: (err) => void message.error(errorMessage(err, "Could not save settings.")),
  });

  if (isLoading || !data) return <EmptyState message="Loading…" />;

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        System Settings
      </Title>
      <Text type="secondary">Security policy for Phase 1 — lockout, password rules, invitation validity, 2FA and auth rate limits.</Text>

      <Card>
        <Form form={form} layout="vertical" initialValues={data} onFinish={(values) => saveMutation.mutate(values)} requiredMark={false}>
          <Title level={5}>Account lockout</Title>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="lockoutMaxAttempts" label="Failed attempts before lockout" rules={[{ required: true }]}>
                <InputNumber min={1} max={20} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="lockoutMinutes" label="Lockout duration (minutes)" rules={[{ required: true }]}>
                <InputNumber min={1} max={1440} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider />
          <Title level={5}>Password &amp; invitations</Title>
          <Row gutter={16}>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="passwordMinLength" label="Minimum password length" rules={[{ required: true }]}>
                <InputNumber min={6} max={64} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} md={6}>
              <Form.Item name="invitationTtlHours" label="Invitation link validity (hours)" rules={[{ required: true }]}>
                <InputNumber min={1} max={336} style={{ width: "100%" }} />
              </Form.Item>
            </Col>
          </Row>

          <Divider />
          <Title level={5}>Two-factor authentication</Title>
          <Form.Item name="require2faRoles" label="Roles required to set up 2FA">
            <Select mode="multiple" options={ROLE_OPTIONS} placeholder="No role requires 2FA" style={{ maxWidth: 560 }} />
          </Form.Item>

          <Divider />
          <Title level={5}>Auth endpoint rate limits</Title>
          <Text type="secondary">Per-IP limits on sensitive, unauthenticated endpoints — stops the endpoint itself being hammered.</Text>
          {(Object.keys(RATE_LIMIT_LABELS) as (keyof SecuritySettings["rateLimits"])[]).map((key) => (
            <Row gutter={16} key={key} style={{ marginTop: 12 }}>
              <Col xs={24} sm={8} md={4} style={{ paddingTop: 6 }}>
                <Text strong>{RATE_LIMIT_LABELS[key]}</Text>
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Form.Item name={["rateLimits", key, "maxAttempts"]} label="Max attempts" rules={[{ required: true }]}>
                  <InputNumber min={1} max={1000} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
              <Col xs={12} sm={8} md={6}>
                <Form.Item name={["rateLimits", key, "windowSeconds"]} label="Window (seconds)" rules={[{ required: true }]}>
                  <InputNumber min={1} max={86400} style={{ width: "100%" }} />
                </Form.Item>
              </Col>
            </Row>
          ))}

          <Form.Item style={{ marginTop: 8, marginBottom: 0 }}>
            <Button type="primary" htmlType="submit" loading={saveMutation.isPending}>
              Save changes
            </Button>
          </Form.Item>
        </Form>
      </Card>

      <Title level={4} style={{ margin: 0 }}>
        Leave
      </Title>
      <LeaveSettingsCard />
      <PeopleDocumentsSettingsCard />
      <HelpdeskSettingsCard />
      {hasPermission("letters.template.manage") && <LettersSettingsCard />}

      <Title level={4} style={{ margin: 0 }}>
        Attendance
      </Title>
      <DeviceHealthSettingsCard />
      <DeviceAlertSettingsCard />
      <RegularizationSettingsCard />
    </Space>
  );
}
