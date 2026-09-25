import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input, Typography } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { useAuth } from "../../../hooks/useAuth";
import * as authApi from "../../../api/auth";

const { Text } = Typography;

interface TotpForm {
  code: string;
}

// Reached from LoginPage when login() returns { status: "requires_totp" }
// — the account already has 2FA enrolled, this just verifies a code
// (device code or a backup code) to finish signing in.
export function TotpChallengePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeLoginWithTokens } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const challengeToken = (location.state as { challengeToken?: string } | null)?.challengeToken;

  if (!challengeToken) {
    navigate("/login", { replace: true });
    return null;
  }

  const onFinish = async (values: TotpForm): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const tokens = await authApi.loginTotp(challengeToken, values.code.trim());
      await completeLoginWithTokens(tokens);
      const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN"];
      navigate(tokens.user.roleCodes.some((role) => ADMIN_TIER_ROLES.includes(role)) ? "/admin" : "/app/home");
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setError(axiosErr.response?.data?.error?.message ?? "Invalid code. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Two-factor authentication" subtitle="Enter the 6-digit code from your authenticator app">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />}

      <Form<TotpForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="code" label="Authentication code" rules={[{ required: true, message: "Enter your 6-digit code" }]}>
          <Input prefix={<SafetyOutlined />} placeholder="123456" size="large" maxLength={10} autoFocus />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Verify
          </Button>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Lost your device? Enter one of your backup codes instead.
      </Text>
    </AuthShell>
  );
}
