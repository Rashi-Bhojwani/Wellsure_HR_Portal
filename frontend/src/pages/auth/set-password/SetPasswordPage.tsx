import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Alert, Button, Form, Input, Spin, Typography } from "antd";
import { LockOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { useAuth } from "../../../hooks/useAuth";
import * as authApi from "../../../api/auth";
import { isLoginChallenge } from "../../../api/auth";

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
      <AuthShell title="Wellsure HR Portal">
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      </AuthShell>
    );
  }

  if (invitationError || !employee) {
    return (
      <AuthShell title="Wellsure HR Portal">
        <Alert type="error" showIcon title={invitationError ?? "This invitation link is invalid or has expired."} />
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set your password" subtitle={`Welcome, ${employee.fullName} (${employee.employeeCode})`}>
      {submitError && <Alert type="error" showIcon title={submitError} style={{ marginBottom: 20 }} />}

      <Form<SetPasswordForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item
          name="password"
          label="New password"
          rules={[{ required: true, message: "Enter a password" }]}
          extra="At least 8 characters, with an uppercase letter, a lowercase letter and a number."
        >
          <Input.Password prefix={<LockOutlined />} placeholder="New password" size="large" />
        </Form.Item>
        <Form.Item name="confirmPassword" label="Confirm password" rules={[{ required: true, message: "Confirm your password" }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Confirm password" size="large" />
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Set password and sign in
          </Button>
        </Form.Item>
      </Form>
      <Text type="secondary" style={{ fontSize: 12 }}>
        Your Employee Code, <Text strong>{employee.employeeCode}</Text>, is your permanent username.
      </Text>
    </AuthShell>
  );
}
