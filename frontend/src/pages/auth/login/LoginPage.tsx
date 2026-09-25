import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Button, Form, Input, Alert } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
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
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setError(axiosErr.response?.data?.error?.message ?? "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell title="Wellsure HR Portal" subtitle="Sign in with your Employee Code">
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />}

      <Form<LoginForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="employeeCode" label="Employee Code" rules={[{ required: true, message: "Enter your Employee Code" }]}>
          <Input prefix={<UserOutlined />} placeholder="e.g. 1042" size="large" autoFocus />
        </Form.Item>
        <Form.Item name="password" label="Password" rules={[{ required: true, message: "Enter your password" }]}>
          <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
        </Form.Item>
        <Form.Item style={{ textAlign: "right", marginBottom: 12 }}>
          <Link to="/forgot-password">Forgot password?</Link>
        </Form.Item>
        <Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
            Sign in
          </Button>
        </Form.Item>
      </Form>
    </AuthShell>
  );
}
