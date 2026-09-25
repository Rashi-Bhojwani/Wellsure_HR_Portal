import { useState } from "react";
import { Link } from "react-router-dom";
import { Alert, Button, Form, Input, Typography } from "antd";
import { UserOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import * as authApi from "../../../api/auth";

const { Text } = Typography;

interface ForgotPasswordForm {
  employeeCode: string;
}

export function ForgotPasswordPage() {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const onFinish = async (values: ForgotPasswordForm): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      // Always the same outcome regardless of whether the code exists —
      // the backend deliberately responds identically either way.
      await authApi.forgotPassword(values.employeeCode.trim());
      setSent(true);
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setError(axiosErr.response?.data?.error?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (sent) {
    return (
      <AuthShell title="Check your email">
        <Alert
          type="info"
          showIcon
          title="If that Employee Code exists, a reset link has been sent"
          description="Check the personal email on file. The link is valid for 1 hour."
          style={{ marginBottom: 20 }}
        />
        <Link to="/login">Back to sign in</Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" subtitle="Enter your Employee Code and we'll email you a reset link">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />}

      <Form<ForgotPasswordForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="employeeCode" label="Employee Code" rules={[{ required: true, message: "Enter your Employee Code" }]}>
          <Input prefix={<UserOutlined />} placeholder="e.g. 1042" size="large" autoFocus />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Send reset link
          </Button>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 12 }}>
        <Link to="/login">Back to sign in</Link>
      </Text>
    </AuthShell>
  );
}
