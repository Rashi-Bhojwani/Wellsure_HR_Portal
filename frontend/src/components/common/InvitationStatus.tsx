import { useState } from "react";
import { Alert, Button, Space, Typography } from "antd";
import { apiErrorMessage } from "../../lib/apiError";
import * as employeeApi from "../../api/employee";

const { Text } = Typography;

function when(iso?: string): string {
  return iso ? new Date(iso).toLocaleString() : "";
}

/**
 * What really happened to an invitation email, said plainly, with a Resend button. A failure is shown as a failure, in red, with the reason; "sent" only ever
 * means a mail server accepted the email, and development's file-only mode says that nothing was sent to anybody.
 */
export function InvitationStatus({ employeeId, invitation, onChange }: { employeeId: string; invitation: employeeApi.InvitationDelivery; onChange?: (next: employeeApi.InvitationDelivery) => void }) {
  const [current, setCurrent] = useState(invitation);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function resend() {
    setBusy(true);
    setProblem(null);
    try {
      const next = await employeeApi.resendInvite(employeeId);
      setCurrent(next);
      onChange?.(next);
    } catch (err) {
      setProblem(apiErrorMessage(err, "Could not resend the invitation."));
    } finally {
      setBusy(false);
    }
  }

  const resendButton = (label: string) => (
    <Button size="small" loading={busy} onClick={() => void resend()} data-testid="resend-invitation">
      {label}
    </Button>
  );

  let alert;
  if (current.status === "SENT") {
    alert = (
      <Alert
        type="success"
        showIcon
        title={`Invitation email sent to ${current.to}`}
        description={
          <Text>
            The mail server accepted it{current.sentAt ? ` at ${when(current.sentAt)}` : ""}. That does not guarantee it reached the inbox: if they cannot find it, ask them to check spam, or resend.
          </Text>
        }
        action={resendButton("Resend")}
      />
    );
  } else if (current.status === "FILE_ONLY") {
    alert = (
      <Alert
        type="warning"
        showIcon
        title={`Nothing was emailed to ${current.to}`}
        description="This system is in development mode: the email was only written to a file on the server (backend/.mail/), so nobody has received it. Set the SMTP variables in backend/.env to send real emails (see GETTING_STARTED.md), then resend."
        action={resendButton("Resend")}
      />
    );
  } else if (current.status === "FAILED") {
    alert = (
      <Alert
        type="error"
        showIcon
        title={`The invitation email to ${current.to} could not be sent`}
        description={
          <Space orientation="vertical" size={2}>
            <Text>{current.error ?? "Sending failed."}</Text>
            <Text strong>This person has NOT been invited yet. The account exists, but they have no way to set a password until an invitation is sent.</Text>
          </Space>
        }
        action={resendButton("Try again")}
      />
    );
  } else {
    alert = (
      <Alert
        type="info"
        showIcon
        title={`No invitation has been sent to ${current.to || "this person"} yet`}
        description="Their account exists but they cannot sign in until you send the invitation."
        action={resendButton("Send invitation")}
      />
    );
  }

  return (
    <Space orientation="vertical" size={8} style={{ width: "100%" }} data-testid="invitation-status" data-status={current.status}>
      {alert}
      {problem && <Alert type="error" showIcon title={problem} />}
    </Space>
  );
}
