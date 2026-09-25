import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Form, Input } from "antd";
import { LockOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import * as authApi from "../../../api/auth";

interface ResetPasswordForm {
  password: string;
  confirmPassword: string;
}

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: ResetPasswordForm): Promise<void> => {
    if (!token) return;
    if (values.password !== values.confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authApi.resetPassword(token, values.password);
      navigate("/login", { state: { passwordReset: true } });
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setError(axiosErr.response?.data?.error?.message ?? "This reset link is invalid or has expired.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Reset your password">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />}

      <Form<ResetPasswordForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="password"
          label="New password"
          rules={[{ required: true, message: "Enter a password" }]}
          extra="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
        >
          <Input.Password prefix={<LockOutlined />} placeholder="New password" size="large" autoFocus />
        </Form.Item>
        <Form.Item name="confirmPassword" label="Confirm password" rules={[{ required: true, message: "Confirm your password" }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Confirm password" size="large" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Reset password
          </Button>
        </Form.Item>
      </Form>
      <Link to="/login" style={{ fontSize: 12 }}>
        Back to sign in
      </Link>
    </AuthShell>
  );
}
