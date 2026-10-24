import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button, Form, Input, Typography } from "antd";
import type { AxiosError } from "axios";
import { AuthShell } from "../AuthShell";
import { AuthError, codeInputStyle } from "../authParts";
import { BackupCodeGrid } from "./BackupCodeGrid";
import { useAuth } from "../../../hooks/useAuth";
import * as authApi from "../../../api/auth";
import type { LoginTokensResponse } from "../../../api/auth";
import { Skel, StepperLayout } from "../../../ui";
import { fs, radius, space, v } from "../../../theme/tokens";

const { Text } = Typography;

interface TotpForm {
  code: string;
}

const ADMIN_TIER_ROLES = ["HR_ADMIN", "HR_EXECUTIVE", "PAYROLL_ADMIN", "SUPER_ADMIN"];
const STEPS = ["Scan and verify", "Save backup codes"];

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
      <AuthShell title="Save your backup codes" width={480}>
        <StepperLayout
          steps={STEPS}
          current={1}
          description="Each code can be used once if you lose access to your authenticator app. Store them somewhere safe — they won't be shown again."
          footer={
            <Button type="primary" block size="large" onClick={() => void onContinue()}>
              I've saved these — continue
            </Button>
          }
        >
          <BackupCodeGrid codes={backupCodes} />
        </StepperLayout>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Set up two-step sign-in"
      subtitle={challengeToken ? "Your role requires two-step sign-in (2FA)." : "Add a code from your phone to every sign-in."}
      width={480}
    >
      <StepperLayout steps={STEPS} current={0} description="Scan this QR code with Google Authenticator, Authy, or any TOTP app, then enter the 6-digit code it shows.">
        <AuthError message={error} />
        {loadingEnrollment ? (
          <div aria-busy="true" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: space[4] }}>
            <Skel w={212} h={212} r={radius.lg} />
            <Skel w={260} h={14} />
            <Skel h={48} r={radius.md} />
          </div>
        ) : (
          <>
            {qrCodeDataUrl && (
              <div style={{ display: "flex", justifyContent: "center", marginBottom: space[4] }}>
                <div style={{ padding: space[4], border: `1px solid ${v.borderDefault}`, borderRadius: radius.lg, background: v.bgSurface }}>
                  <img src={qrCodeDataUrl} alt="2FA QR code" width={180} height={180} style={{ display: "block", borderRadius: radius.sm }} />
                </div>
              </div>
            )}
            {secret && (
              <div style={{ textAlign: "center", fontSize: fs.sm, color: v.textSecondary, marginBottom: space[5] }}>
                Can't scan it? Enter this code manually:{" "}
                <Text code copyable style={{ fontSize: fs.sm }}>
                  {secret}
                </Text>
              </div>
            )}

            <Form<TotpForm> layout="vertical" onFinish={onFinish} requiredMark={false}>
              <Form.Item name="code" label="Authentication code" rules={[{ required: true, message: "Enter the 6-digit code" }]}>
                <Input placeholder="123456" size="large" maxLength={10} autoFocus autoComplete="one-time-code" inputMode="numeric" style={codeInputStyle} />
              </Form.Item>
              <Form.Item style={{ marginBottom: 0 }}>
                <Button type="primary" htmlType="submit" block size="large" loading={submitting}>
                  Verify and enable 2FA
                </Button>
              </Form.Item>
            </Form>
          </>
        )}
      </StepperLayout>
    </AuthShell>
  );
}
