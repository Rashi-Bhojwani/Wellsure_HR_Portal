import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Col, Divider, Form, InputNumber, Row, Select, Space, Typography, message } from "antd";
import { apiErrorMessage as errorMessage } from "../../../lib/apiError";
import * as settingsApi from "../../../api/settings";
import type { SecuritySettings } from "../../../api/settings";
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
    </Space>
  );
}
