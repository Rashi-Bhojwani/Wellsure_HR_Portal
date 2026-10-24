import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Alert, Button, Form, Input, Tooltip } from "antd";
import { DesktopOutlined, KeyOutlined, LogoutOutlined, MobileOutlined, SafetyOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { useAuth } from "../../hooks/useAuth";
import * as authApi from "../../api/auth";
import type { Session } from "../../api/auth";
import { apiErrorMessage } from "../../lib/apiError";
import { BackupCodeGrid } from "../auth/totp/BackupCodeGrid";
import { ConfirmModal, EmptyState, KeyValueGrid, PageHeader, Panel, Skel, Stack, StatusChip, toast, useIsPhone } from "../../ui";
import { fs, fw, radius, space, v } from "../../theme/tokens";

interface DisableTotpForm {
  password: string;
  code: string;
}

const DISABLE_FORM_ID = "disable-totp-form";

function isMobileAgent(ua: string | null): boolean {
  return !!ua && /mobile|android|iphone|ipad/i.test(ua);
}

function sessionMeta(session: Session): string {
  const created = new Date(session.createdAt).toLocaleString();
  return `${session.ipAddress ?? "unknown IP"} · signed in ${created}`;
}

export function AccountSecurityPage() {
  const navigate = useNavigate();
  const phone = useIsPhone();
  const { user, refreshUser, logout } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(true);
  const [sessionsError, setSessionsError] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [logoutAllOpen, setLogoutAllOpen] = useState(false);
  const [loggingOutAll, setLoggingOutAll] = useState(false);
  const [disableModalOpen, setDisableModalOpen] = useState(false);
  const [disableSubmitting, setDisableSubmitting] = useState(false);
  const [disableError, setDisableError] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [disableForm] = Form.useForm<DisableTotpForm>();

  function reloadSessions(): void {
    setLoadingSessions(true);
    setSessionsError(false);
    authApi
      .getSessions()
      .then(setSessions)
      .catch(() => setSessionsError(true))
      .finally(() => setLoadingSessions(false));
  }

  useEffect(() => {
    authApi
      .getSessions()
      .then(setSessions)
      .catch(() => setSessionsError(true))
      .finally(() => setLoadingSessions(false));
  }, []);

  async function onDisableTotp(values: DisableTotpForm): Promise<void> {
    setDisableSubmitting(true);
    setDisableError(null);
    try {
      await authApi.disableTotp(values.password, values.code);
      setDisableModalOpen(false);
      await refreshUser();
      toast.success("Two-factor authentication disabled.");
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setDisableError(axiosErr.response?.data?.error?.message ?? "Could not disable 2FA.");
    } finally {
      setDisableSubmitting(false);
    }
  }

  async function onRegenerateBackupCodes(): Promise<void> {
    setRegenerating(true);
    try {
      setNewCodes(await authApi.regenerateBackupCodes());
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not create new backup codes."));
    } finally {
      setRegenerating(false);
    }
  }

  async function onRevokeSession(id: string): Promise<void> {
    setRevoking(id);
    try {
      await authApi.revokeSession(id);
      reloadSessions();
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not revoke that session."));
    } finally {
      setRevoking(null);
    }
  }

  async function onLogoutAll(): Promise<void> {
    setLoggingOutAll(true);
    try {
      await authApi.logoutAll();
      await logout();
      navigate("/login");
    } catch (err) {
      toast.error(apiErrorMessage(err, "Could not log out everywhere."));
      setLoggingOutAll(false);
    }
  }

  const totpOn = Boolean(user?.totpEnabled);

  return (
    <>
      <PageHeader title="Account & Security" subtitle="Your sign-in details, two-step sign-in and the devices you're signed in on." />
      <Stack>
        <Panel title="Sign-in details">
          <KeyValueGrid
            items={[
              { label: "Name", value: user?.fullName },
              { label: "Username (Employee Code)", value: user?.employeeCode },
              { label: "Two-step sign-in", value: <StatusChip tone={totpOn ? "success" : "neutral"}>{totpOn ? "Enabled" : "Not enabled"}</StatusChip> },
            ]}
          />
        </Panel>

        <Panel title="Password" subtitle="Changing your password from inside the app isn't available yet.">
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[4], justifyContent: "space-between" }}>
            <div style={{ color: v.textBody, fontSize: fs.md, flex: "1 1 280px" }}>
              Use the reset link instead: we email it to the personal email on file, and it's valid for 1 hour.
            </div>
            <Button icon={<KeyOutlined />} size="large" block={phone} onClick={() => navigate("/forgot-password")}>
              Reset password by email
            </Button>
          </div>
        </Panel>

        <Panel title="Two-Factor Authentication" subtitle="A 6-digit code from your phone at every sign-in." extra={<StatusChip tone={totpOn ? "success" : "neutral"}>{totpOn ? "Enabled" : "Not enabled"}</StatusChip>}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: space[4] }}>
            <span aria-hidden style={{ width: 48, height: 48, borderRadius: radius.pill, background: totpOn ? v.accentSubtle : v.bgSubtle, color: totpOn ? v.accentText : v.textSecondary, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.h2, flex: "none" }}>
              <SafetyOutlined />
            </span>
            <div style={{ flex: "1 1 240px", color: v.textBody, fontSize: fs.md }}>
              {totpOn
                ? "Your account asks for a code from your authenticator app after your password. Keep your backup codes somewhere safe."
                : "Add a second step to your sign-in with an authenticator app such as Google Authenticator or Authy."}
            </div>
            <div style={{ display: "flex", gap: space[3], flexWrap: "wrap", width: phone ? "100%" : undefined }}>
              {totpOn ? (
                <>
                  <Button size="large" block={phone} loading={regenerating} onClick={() => void onRegenerateBackupCodes()}>
                    Regenerate backup codes
                  </Button>
                  <Button size="large" block={phone} danger onClick={() => setDisableModalOpen(true)}>
                    Disable 2FA
                  </Button>
                </>
              ) : (
                <Button type="primary" size="large" block={phone} icon={<SafetyOutlined />} onClick={() => navigate("/totp-setup")}>
                  Set up 2FA
                </Button>
              )}
            </div>
          </div>
        </Panel>

        <Panel
          title="Active Sessions"
          subtitle="Devices where you're signed in."
          extra={
            <Button danger icon={<LogoutOutlined />} onClick={() => setLogoutAllOpen(true)}>
              Log out everywhere
            </Button>
          }
        >
          {loadingSessions ? (
            <div aria-busy="true" style={{ display: "flex", flexDirection: "column", gap: space[4] }}>
              {[0, 1].map((i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: space[3] }}>
                  <Skel w={40} h={40} r={radius.pill} />
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: space[2] }}>
                    <Skel w="60%" h={14} />
                    <Skel w="40%" h={12} />
                  </div>
                </div>
              ))}
            </div>
          ) : sessionsError ? (
            <EmptyState kind="error" compact title="Couldn't load your sessions" onRetry={reloadSessions} />
          ) : sessions.length === 0 ? (
            <EmptyState compact title="No active sessions" description={null} />
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {sessions.map((session, i) => {
                const Icon = isMobileAgent(session.userAgent) ? MobileOutlined : DesktopOutlined;
                return (
                  <li
                    key={session.id}
                    style={{ display: "flex", alignItems: "center", gap: space[3], padding: `${space[3]}px 0`, borderTop: i ? `1px solid ${v.borderDefault}` : undefined, flexWrap: phone ? "wrap" : "nowrap" }}
                  >
                    <span aria-hidden style={{ width: 40, height: 40, borderRadius: radius.pill, background: v.bgSubtle, color: v.textSecondary, display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: fs.lg, flex: "none" }}>
                      <Icon />
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <Tooltip title={session.userAgent ?? undefined}>
                        <div style={{ fontSize: fs.md, fontWeight: fw.semibold, color: v.textPrimary, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{session.userAgent ?? "Unknown device"}</div>
                      </Tooltip>
                      <div style={{ fontSize: fs.sm, color: v.textSecondary }}>{sessionMeta(session)}</div>
                    </div>
                    <Button size={phone ? "large" : "middle"} block={phone} loading={revoking === session.id} onClick={() => void onRevokeSession(session.id)}>
                      Revoke
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      </Stack>

      <ConfirmModal
        open={logoutAllOpen}
        onCancel={() => setLogoutAllOpen(false)}
        onConfirm={() => void onLogoutAll()}
        title="Log out everywhere?"
        description="Every device, including this one, will be signed out. You'll need your password to sign in again."
        confirmLabel="Log out everywhere"
        danger
        loading={loggingOutAll}
      />

      <ConfirmModal
        open={newCodes !== null}
        onCancel={() => setNewCodes(null)}
        onConfirm={() => setNewCodes(null)}
        title="New backup codes"
        description="Your old backup codes no longer work. Save these somewhere safe."
        confirmLabel="Done"
        cancelLabel={null}
      >
        {newCodes && <BackupCodeGrid codes={newCodes} />}
      </ConfirmModal>

      <ConfirmModal
        open={disableModalOpen}
        onCancel={() => {
          setDisableModalOpen(false);
          setDisableError(null);
          disableForm.resetFields();
        }}
        onConfirm={() => disableForm.submit()}
        title="Disable two-factor authentication"
        description="Confirm with your password and a current code from your authenticator app."
        confirmLabel="Disable 2FA"
        danger
        loading={disableSubmitting}
      >
        {disableError && <Alert type="error" showIcon title={disableError} style={{ marginBottom: space[4] }} />}
        <Form<DisableTotpForm> id={DISABLE_FORM_ID} form={disableForm} layout="vertical" onFinish={(values) => void onDisableTotp(values)} requiredMark={false}>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: "Enter your password" }]}>
            <Input.Password size="large" autoFocus autoComplete="current-password" />
          </Form.Item>
          <Form.Item name="code" label="Current authentication code" rules={[{ required: true, message: "Enter your current code" }]} style={{ marginBottom: 0 }}>
            <Input size="large" placeholder="123456" inputMode="numeric" autoComplete="one-time-code" />
          </Form.Item>
        </Form>
      </ConfirmModal>
    </>
  );
}
