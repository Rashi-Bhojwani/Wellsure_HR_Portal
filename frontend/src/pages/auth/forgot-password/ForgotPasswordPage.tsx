import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Form, Input } from "antd";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { AuthError, requiredMark } from "../authParts";
import * as authApi from "../../../api/auth";
import { Illustration } from "../../../ui";
import { fs, space, v } from "../../../theme/tokens";

interface ForgotPasswordForm {
  employeeCode: string;
}

export function ForgotPasswordPage() {
  const navigate = useNavigate();
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
      <AuthShell
        title="Check your email"
        hero={<Illustration name="inbox" size={140} />}
        subtitle={
          <>
            <span style={{ display: "block", color: v.textPrimary }}>If that Employee Code exists, a reset link has been sent</span>
            Check the personal email on file. The link is valid for 1 hour.
          </>
        }
      >
        <Button block size="large" onClick={() => navigate("/login")}>
          Back to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Forgot password" subtitle="Enter your Employee Code and we'll email you a reset link">
      <AuthError message={error} />

      <Form<ForgotPasswordForm> layout="vertical" onFinish={onFinish} requiredMark={requiredMark}>
        <Form.Item name="employeeCode" label="Employee Code" rules={[{ required: true, message: "Enter your Employee Code" }]}>
          <Input placeholder="e.g. 1042" size="large" autoFocus autoComplete="username" />
        </Form.Item>
        <Form.Item style={{ marginBottom: space[4] }}>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Send reset link
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: "center", fontSize: fs.md }}>
        <Link to="/login">Back to sign in</Link>
      </div>
    </AuthShell>
  );
}
