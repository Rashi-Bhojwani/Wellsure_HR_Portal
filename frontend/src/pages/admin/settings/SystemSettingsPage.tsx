import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Checkbox, Col, Divider, Form, InputNumber, Row, Select, Space, Typography, message } from "antd";
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
import type { LeaveSettings, PeopleDocumentsSettings, SecuritySettings } from "../../../api/settings";
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
    </Space>
  );
}
