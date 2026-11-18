import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Button, Form, Input, Alert } from "antd";
import { apiErrorMessage } from "../../../lib/apiError";
import { AuthShell } from "../AuthShell";
import { AuthError } from "../authParts";
import { requiredMark } from "../authStyles";
import { fs, space, v } from "../../../theme/tokens";
import { useAuth } from "../../../hooks/useAuth";
import { isLoginChallenge } from "../../../api/auth";

interface LoginForm {
  employeeCode: string;
  password: string;
}

// Where to land after a successful login — anyone holding an HR/Admin/
// Payroll-tier role goes to the HR/Admin portal; everyone else (plain
// EMPLOYEE, or MANAGER — who still works day to day from the employee
// portal) goes to the employee portal.
const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN"];

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const passwordReset = Boolean((location.state as { passwordReset?: boolean } | null)?.passwordReset);
  const { login } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFinish = async (values: LoginForm): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const result = await login(values.employeeCode.trim(), values.password);
      if (isLoginChallenge(result)) {
        const path = result.status === "requires_totp_setup" ? "/totp-setup" : "/totp-challenge";
        navigate(path, { state: { challengeToken: result.challengeToken } });
        return;
      }
      const isAdminTier = result.user.roleCodes.some((role) => ADMIN_TIER_ROLES.includes(role));
      navigate(isAdminTier ? "/admin" : "/app/home");
    } catch (err) {
      setError(apiErrorMessage(err, "Something went wrong. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell layout="split" title="Sign in to your account" subtitle="Use your employee number and password.">
      {passwordReset && !error && <Alert type="success" showIcon title="Password updated. Sign in with your new password." style={{ marginBottom: space[5] }} />}
      <AuthError message={error} />

      <Form<LoginForm> layout="vertical" onFinish={onFinish} requiredMark={requiredMark}>
        <Form.Item
          name="employeeCode"
          label="Employee number"
          extra="The same number as on the attendance machine."
          rules={[{ required: true, whitespace: true, message: "Enter your employee number" }]}
        >
          <Input placeholder="e.g. 1042" size="large" autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, message: "Enter your password" }]} style={{ marginBottom: space[3] }}>
          <Input.Password placeholder="Password" size="large" autoComplete="current-password" />
        </Form.Item>
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: space[3] }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        {/* Always shown: the sign-in reply is the same for every failure (it never says an account is waiting to be set up), so the first-time route lives here. */}
        <p style={{ margin: 0, marginBottom: space[6], color: v.textSecondary, fontSize: fs.md }} data-testid="login-first-time-hint">
          First time, or forgot your password? Use Forgot password with your employee number.
        </p>
        <Form.Item style={{ marginBottom: 0 }}>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Sign in
          </Button>
        </Form.Item>
      </Form>
    </AuthShell>
  );
}
