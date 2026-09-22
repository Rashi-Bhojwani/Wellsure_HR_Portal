import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button, Card, Form, Input, Typography, Alert } from "antd";
import { LockOutlined, UserOutlined } from "@ant-design/icons";

const { Title, Text } = Typography;

interface LoginForm {
  employeeCode: string;
  password: string;
}

// UI only — real Employee Code + password auth (spec §3) lands in
// Phase 1. Submitting here just simulates a successful login so the
// portals are reachable without a backend; replace with a real
// POST /api/auth/login call and token handling in Phase 1.
export function LoginPage() {
  const navigate = useNavigate();
  const [submitting, setSubmitting] = useState(false);

  const onFinish = (_values: LoginForm): void => {
    setSubmitting(true);
    setTimeout(() => {
      setSubmitting(false);
      navigate("/app/home");
    }, 400);
  };

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#f4f5f7",
        padding: 16,
      }}
    >
      <Card style={{ width: 380, maxWidth: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          {/* Logo placeholder — replace with the real Wellsure logo */}
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 12,
              background: "#2f6fed",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 24,
              margin: "0 auto 16px",
            }}
          >
            W
          </div>
          <Title level={3} style={{ margin: 0 }}>
            Wellsure HR Portal
          </Title>
          <Text type="secondary">Sign in with your Employee Code</Text>
        </div>

        <Alert
          type="info"
          showIcon
          title="Phase 0 preview"
          description="Login is UI only right now — any Employee Code and password will sign you in. Use the dev role switcher (bottom-right) to jump straight to a portal instead."
          style={{ marginBottom: 20 }}
        />

        <Form<LoginForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
          <Form.Item
            name="employeeCode"
            label="Employee Code"
            rules={[{ required: true, message: "Enter your Employee Code" }]}
          >
            <Input prefix={<UserOutlined />} placeholder="e.g. 1042" size="large" autoFocus />
          </Form.Item>
          <Form.Item
            name="password"
            label="Password"
            rules={[{ required: true, message: "Enter your password" }]}
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" size="large" />
          </Form.Item>
          <Form.Item style={{ textAlign: "right", marginBottom: 12 }}>
            <a onClick={(e) => e.preventDefault()}>Forgot password?</a>
          </Form.Item>
          <Form.Item>
            <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
              Sign in
            </Button>
          </Form.Item>
        </Form>
      </Card>
    </div>
  );
}
