import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Card, Form, Input, List, Modal, Space, Tag, Typography, message } from "antd";
import { LockOutlined, SafetyOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { useAuth } from "../../hooks/useAuth";
import * as authApi from "../../api/auth";
import type { Session } from "../../api/auth";
import { fs } from "../../theme/tokens";

const { Title, Text } = Typography;

interface DisableTotpForm {
  password: string;
  code: string;
}

function formatSession(session: Session): string {
  const created = new Date(session.createdAt).toLocaleString();
  return `${session.userAgent ?? "Unknown device"} · ${session.ipAddress ?? "unknown IP"} · signed in ${created}`;
}

export function AccountSecurityPage() {
  const navigate = useNavigate();
  const { user, refreshUser, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disableSubmitting, setDisableSubmitting] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);

  // Re-fetch after a revoke — loadingSessions already starts true for the
  // initial mount, so this only needs to re-set it for that later refetch.
  function reloadSessions(): void {
    setLoadingSessions(true);
    authApi
      .getSessions()
      .then(setSessions)
      .finally(() => setLoadingSessions(false));
  }

  useEffect(() => {
    authApi
      .getSessions()
      .then(setSessions)
      .finally(() => setLoadingSessions(false));
  }, []);

  async function onDisableTotp(values: DisableTotpForm): Promise<void> {
    setDisableSubmitting(true);
    setDisableError(null);
    try {
      await authApi.disableTotp(values.password, values.code);
      setDisableModalOpen(false);
      await refreshUser();
      void message.success("Two-factor authentication disabled.");
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setDisableError(axiosErr.response?.data?.error?.message ?? "Could not disable 2FA.");
    } finally {
      setDisableSubmitting(false);
    }
  }

  async function onRegenerateBackupCodes(): Promise<void> {
    const codes = await authApi.regenerateBackupCodes();
    Modal.info({
      title: "New backup codes",
      width: 440,
      content: (
        <>
          <Text type="secondary">Your old backup codes no longer work. Save these somewhere safe.</Text>
          <Space wrap style={{ marginTop: 12 }}>
            {codes.map((code) => (
              <Tag key={code} style={{ fontFamily: "monospace", fontSize: fs.md, padding: "4px 8px" }}>
                {code}
              </Tag>
            ))}
          </Space>
        </>
      ),
    });
  }

  async function onRevokeSession(id: string): Promise<void> {
    await authApi.revokeSession(id);
    reloadSessions();
  }

  async function onLogoutAll(): Promise<void> {
    await authApi.logoutAll();
    await logout();
    navigate("/login");
  }

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Title level={3} style={{ margin: 0 }}>
        Account &amp; Security
      </Title>

      <Card title="Two-Factor Authentication">
        {user?.totpEnabled ? (
          <Space orientation="vertical">
            <Tag color="green">Enabled</Tag>
            <Space>
              <Button onClick={() => void onRegenerateBackupCodes()}>Regenerate backup codes</Button>
              <Button danger onClick={() => setDisableModalOpen(true)}>
                Disable 2FA
              </Button>
            </Space>
          </Space>
        ) : (
          <Space orientation="vertical">
            <Tag>Not enabled</Tag>
            <Button type="primary" icon={<SafetyOutlined />} onClick={() => navigate("/totp-setup")}>
              Set up 2FA
            </Button>
          </Space>
        )}
      </Card>

      <Card
        title="Active Sessions"
        extra={
          <Button danger size="small" onClick={() => void onLogoutAll()}>
            Log out everywhere
          </Button>
        }
      >
        <List
          loading={loadingSessions}
          dataSource={sessions}
          locale={{ emptyText: "No active sessions" }}
          renderItem={(session) => (
            <List.Item actions={[<a key="revoke" onClick={() => void onRevokeSession(session.id)}>Revoke</a>]}>
              <Text style={{ fontSize: fs.table }}>{formatSession(session)}</Text>
            </List.Item>
          )}
        />
      </Card>

      <Modal
        title="Disable two-factor authentication"
        open={disableModalOpen}
        onCancel={() => setDisableModalOpen(false)}
        footer={null}
        destroyOnHidden
      >
        {disableError && <Alert type="error" showIcon title={disableError} style={{ marginBottom: 16 }} />}
        <Form<DisableTotpForm> layout="vertical" onFinish={(values) => void onDisableTotp(values)} requiredMark={false}>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: "Enter your password" }]}>
            <Input.Password prefix={<LockOutlined />} autoFocus />
          </Form.Item>
          <Form.Item name="code" label="Current authentication code" rules={[{ required: true, message: "Enter your current code" }]}>
            <Input prefix={<SafetyOutlined />} placeholder="123456" />
          </Form.Item>
          <Form.Item style={{ marginBottom: 0, textAlign: "right" }}>
            <Button type="primary" danger htmlType="submit" loading={disableSubmitting}>
              Disable 2FA
            </Button>
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
