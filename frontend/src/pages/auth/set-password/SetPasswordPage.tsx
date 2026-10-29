import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Button, Form, Input, Typography } from "antd";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { AuthError, PasswordRules } from "../authParts";
import { requiredMark } from "../authStyles";
import { useAuth } from "../../../hooks/useAuth";
import * as authApi from "../../../api/auth";
import { isLoginChallenge } from "../../../api/auth";
import { Illustration, Skel } from "../../../ui";
import { fs, radius, space, v } from "../../../theme/tokens";

const { Text } = Typography;

interface SetPasswordForm {
  password: string;
  confirmPassword: string;
}

const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN"];

export function SetPasswordPage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { completeLoginWithTokens } = useAuth();
  const [form] = Form.useForm<SetPasswordForm>();
  const password = Form.useWatch("password", form);

  const [loadingInvitation, setLoadingInvitation] = useState(true);
  const [invitationError, setInvitationError] = useState<string | null>(null);
  const [employee, setEmployee] = useState<{ employeeCode: string; fullName: string } | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) return;
    authApi
      .getInvitation(token)
      .then(setEmployee)
      .catch((err: AxiosError<{ error?: { message?: string } }>) => {
        setInvitationError(err.response?.data?.error?.message ?? "This invitation link is invalid or has expired.");
      })
      .finally(() => setLoadingInvitation(false));
  }, [token]);

  const onFinish = async (values: SetPasswordForm): Promise<void> => {
    if (!token) return;
    if (values.password !== values.confirmPassword) {
      setSubmitError("Passwords don't match.");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await authApi.acceptInvitation(token, values.password);
      if (isLoginChallenge(result)) {
        const path = result.status === "requires_totp_setup" ? "/totp-setup" : "/totp-challenge";
        navigate(path, { state: { challengeToken: result.challengeToken } });
        return;
      }
      await completeLoginWithTokens(result);
      const isAdminTier = result.user.roleCodes.some((role) => ADMIN_TIER_ROLES.includes(role));
      navigate(isAdminTier ? "/admin" : "/app/home");
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setSubmitError(axiosErr.response?.data?.error?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loadingInvitation) {
    return (
      <AuthShell title="Set your password" subtitle="Checking your invitation link…">
        <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: space[3] }}>
          <Skel w={120} h={14} />
          <Skel h={48} r={radius.md} />
          <Skel w={140} h={14} style={{ marginTop: space[2] }} />
          <Skel h={48} r={radius.md} />
          <Skel h={48} r={radius.md} style={{ marginTop: space[4] }} />
        </div>
      </AuthShell>
    );
  }

  if (invitationError || !employee) {
    return (
      <AuthShell
        title="This link can't be used"
        hero={<Illustration name="error" size={140} />}
        subtitle={<span role="alert">{invitationError ?? "This invitation link is invalid or has expired."}</span>}
      >
        <Button type="primary" block size="large" onClick={() => navigate("/login")}>
          Go to sign in
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set your password" subtitle={`Welcome, ${employee.fullName} (${employee.employeeCode})`}>
      <AuthError message={submitError} />

      <Form<SetPasswordForm> form={form} layout="vertical" onFinish={onFinish} requiredMark={requiredMark}>
        <Form.Item name="password" label="New password" rules={[{ required: true, message: "Enter a password" }]} extra={<PasswordRules value={password} />}>
          <Input.Password placeholder="New password" size="large" autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="confirmPassword" label="Confirm password" rules={[{ required: true, message: "Confirm your password" }]}>
          <Input.Password placeholder="Confirm password" size="large" autoComplete="new-password" />
        </Form.Item>
        <Form.Item style={{ marginBottom: space[4] }}>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Set password and sign in
          </Button>
        </Form.Item>
      </Form>
      <div style={{ textAlign: "center", fontSize: fs.sm, color: v.textSecondary }}>
        Your Employee Code, <Text strong>{employee.employeeCode}</Text>, is your permanent username.
      </div>
    </AuthShell>
  );
}
