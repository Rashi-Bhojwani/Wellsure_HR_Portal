import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button, Form, Input } from "antd";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { AuthError } from "../authParts";
import { useAuth } from "../../../hooks/useAuth";
import * as authApi from "../../../api/auth";
import { fs, fw, space, v } from "../../../theme/tokens";

interface TotpForm {
  code: string;
}

/** One large centred code field (auth-08's OTP boxes, as a single input so paste, autofill and backup codes keep working). */
export const codeInputStyle = { textAlign: "center", fontSize: fs.h1, fontWeight: fw.semibold, letterSpacing: "0.3em", fontVariantNumeric: "tabular-nums" } as const;

// Reached from LoginPage when login() returns { status: "requires_totp" }
// — the account already has 2FA enrolled, this just verifies a code
// (device code or a backup code) to finish signing in.
export function TotpChallengePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeLoginWithTokens } = useAuth();
  const [form] = Form.useForm<TotpForm>();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [useBackup, setUseBackup] = useState(false);

  const challengeToken = (location.state as { challengeToken?: string } | null)?.challengeToken;

  if (!challengeToken) return <Navigate to="/login" replace />;

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

  const toggle = () => {
    setUseBackup((b) => !b);
    form.resetFields();
    setError(null);
  };

  return (
    <AuthShell
      title="Two-step sign-in"
      subtitle={useBackup ? "Enter one of your backup codes. Each code works once." : "Enter the 6-digit code from your authenticator app"}
    >
      <AuthError message={error} />

      <Form<TotpForm> form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="code"
          label={<span className="ws-sr-only">{useBackup ? "Backup code" : "Authentication code"}</span>}
          rules={[{ required: true, message: useBackup ? "Enter a backup code" : "Enter your 6-digit code" }]}
        >
          <Input
            placeholder={useBackup ? "XXXXXXXXXX" : "123456"}
            size="large"
            maxLength={10}
            autoFocus
            autoComplete="one-time-code"
            inputMode={useBackup ? "text" : "numeric"}
            style={codeInputStyle}
          />
        </Form.Item>
        <Form.Item style={{ marginBottom: space[4] }}>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Verify
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: "center", fontSize: fs.md, color: v.textSecondary }}>
        {useBackup ? "Have your phone? " : "Lost your device? "}
        <Button type="link" onClick={toggle} style={{ padding: 0, height: "auto", fontSize: fs.md }}>
          {useBackup ? "Use your authenticator app" : "Use a backup code instead"}
        </Button>
      </div>
    </AuthShell>
  );
}
