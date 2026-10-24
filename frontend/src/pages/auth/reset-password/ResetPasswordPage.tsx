import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Button, Form, Input } from "antd";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { AuthError, PasswordRules, requiredMark } from "../authParts";
import * as authApi from "../../../api/auth";
import { fs, space } from "../../../theme/tokens";

interface ResetPasswordForm {
  password: string;
  confirmPassword: string;
}

export function ResetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const [form] = Form.useForm<ResetPasswordForm>();
  const password = Form.useWatch("password", form);
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
    <AuthShell title="Reset your password" subtitle="Choose a new password for your account.">
      <AuthError message={error} />

      <Form<ResetPasswordForm> form={form} layout="vertical" onFinish={onFinish} requiredMark={requiredMark}>
        <Form.Item name="password" label="New password" rules={[{ required: true, message: "Enter a password" }]} extra={<PasswordRules value={password} />}>
          <Input.Password placeholder="New password" size="large" autoFocus autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirmPassword" label="Confirm password" rules={[{ required: true, message: "Confirm your password" }]}>
          <Input.Password placeholder="Confirm password" size="large" autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: space[4] }}>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Reset password
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: "center", fontSize: fs.md }}>
        <Link to="/login">Back to sign in</Link>
      </div>
    </AuthShell>
  );
}
