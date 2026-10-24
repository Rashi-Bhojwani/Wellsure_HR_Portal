import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Alert, Button, Form, Image, Input, Space, Spin, Typography, Tag } from "antd";
import { SafetyOutlined } from "@ant-design/icons";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { useAuth } from "../../../hooks/useAuth";
import * as authApi from "../../../api/auth";
import type { LoginTokensResponse } from "../../../api/auth";
import { fs } from "../../../theme/tokens";

const { Text, Paragraph } = Typography;

interface TotpForm {
  code: string;
}

const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN"];

// Reached from LoginPage when login() returns { status: "requires_totp_setup" }
// — this role requires 2FA (spec §3.7) and hasn't enrolled yet. Also
// reachable from Account & Security for self-service opt-in enrolment,
// in which case there's no challengeToken and the user is already
// authenticated (setupTotp()/verifyTotp() both work with or without one).
export function TotpSetupPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { completeLoginWithTokens } = useAuth();
  const challengeToken = (location.state as { challengeToken?: string } | null)?.challengeToken;

  const [loadingEnrollment, setLoadingEnrollment] = useState(true);
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [pendingTokens, setPendingTokens] = useState<LoginTokensResponse | null>(null);

  useEffect(() => {
    authApi
      .setupTotp(challengeToken)
      .then((enrollment) => {
        setQrCodeDataUrl(enrollment.qrCodeDataUrl);
        setSecret(enrollment.secret);
      })
      .catch(() => setError("Could not start 2FA setup. Please try signing in again."))
      .finally(() => setLoadingEnrollment(false));
  }, [challengeToken]);

  const onFinish = async (values: TotpForm): Promise<void> => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await authApi.verifyTotp(values.code.trim(), challengeToken);
      setBackupCodes(res.backupCodes);
      if (res.accessToken && res.user) {
        setPendingTokens({ accessToken: res.accessToken, user: res.user });
      }
    } catch (err) {
      const axiosErr = err as AxiosError<{ error?: { message?: string } }>;
      setError(axiosErr.response?.data?.error?.message ?? "Invalid code. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const onContinue = async (): Promise<void> => {
    if (pendingTokens) {
      await completeLoginWithTokens(pendingTokens);
      navigate(pendingTokens.user.roleCodes.some((role) => ADMIN_TIER_ROLES.includes(role)) ? "/admin" : "/app/home");
      return;
    }
    navigate(-1); // self-service enrolment from Account & Security — just go back
  };

  if (backupCodes) {
    return (
      <AuthShell title="Save your backup codes" width={440}>
        <Paragraph type="secondary">
          Each code can be used once if you lose access to your authenticator app. Store them somewhere safe — they won't be
          shown again.
        </Paragraph>
        <Space wrap style={{ marginBottom: 20 }}>
          {backupCodes.map((code) => (
            <Tag key={code} style={{ fontFamily: "monospace", fontSize: fs.md, padding: "4px 8px" }}>
              {code}
            </Tag>
          ))}
        </Space>
        <Button type="primary" block size="large" onClick={() => void onContinue()}>
          I've saved these — continue
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Set up two-factor authentication" subtitle="Your role requires 2FA" width={420}>
      {error && <Alert type="error" showIcon title={error} style={{ marginBottom: 20 }} />}

      {loadingEnrollment ? (
        <div style={{ textAlign: "center", padding: 24 }}>
          <Spin />
        </div>
      ) : (
        <>
          <Paragraph type="secondary">
            Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code it shows.
          </Paragraph>
          {qrCodeDataUrl && (
            <div style={{ textAlign: "center", marginBottom: 12 }}>
              <Image src={qrCodeDataUrl} alt="2FA QR code" width={180} preview={false} />
            </div>
          )}
          {secret && (
            <Paragraph type="secondary" style={{ textAlign: "center", fontSize: fs.sm }}>
              Can't scan it? Enter this code manually: <Text code>{secret}</Text>
            </Paragraph>
          )}

          <Form<TotpForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
            <Form.Item name="code" label="Authentication code" rules={[{ required: true, message: "Enter the 6-digit code" }]}>
              <Input prefix={<SafetyOutlined />} placeholder="123456" size="large" maxLength={10} autoFocus />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                Verify and enable 2FA
              </Button>
            </Form.Item>
          </Form>
        </>
      )}
    </AuthShell>
  );
}
