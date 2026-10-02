import { env } from "../../config/env";
import { mailService } from "../../integrations/mail";

export function emailLayout(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; color: #1f1f1f; max-width: 480px; margin: 0 auto; padding: 24px;">
    <div style="width: 40px; height: 40px; border-radius: 10px; background: #2f6fed; color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px; margin-bottom: 16px;">W</div>
    <h2 style="margin: 0 0 16px;">${title}</h2>
    ${bodyHtml}
    <p style="color: #8c8c8c; font-size: 12px; margin-top: 32px;">Wellsure HR Portal</p>
  </body>
</html>`;
}

function button(url: string, label: string): string {
  return `<p><a href="${url}" style="display: inline-block; background: #2f6fed; color: #fff; padding: 10px 20px; border-radius: 6px; text-decoration: none;">${label}</a></p>
  <p style="color: #8c8c8c; font-size: 12px;">Or copy this link: ${url}</p>`;
}

export async function sendInvitationEmail(to: string, fullName: string, employeeCode: string, token: string): Promise<void> {
  const url = `${env.WEB_BASE_URL}/set-password/${token}`;
  await mailService.send({
    to,
    subject: "Welcome to Wellsure HR Portal — set your password",
    html: emailLayout(
      "Set your password",
      `<p>Hi ${fullName},</p>
       <p>Your Wellsure HR Portal account has been created. Your Employee Code is <strong>${employeeCode}</strong>.</p>
       <p>Set your password to activate your account. This link is valid for 48 hours.</p>
       ${button(url, "Set my password")}`,
    ),
  });
}

export async function sendPasswordResetEmail(to: string, fullName: string, token: string): Promise<void> {
  const url = `${env.WEB_BASE_URL}/reset-password/${token}`;
  await mailService.send({
    to,
    subject: "Reset your Wellsure HR Portal password",
    html: emailLayout(
      "Reset your password",
      `<p>Hi ${fullName},</p>
       <p>We received a request to reset your password. This link is valid for 1 hour. If you didn't request this, you can ignore this email.</p>
       ${button(url, "Reset my password")}`,
    ),
  });
}

export async function sendWelcomeEmail(to: string, fullName: string): Promise<void> {
  await mailService.send({
    to,
    subject: "Welcome to Wellsure HR Portal",
    html: emailLayout(
      "You're all set",
      `<p>Hi ${fullName},</p>
       <p>Your password is set and your account is active. You can now sign in with your Employee Code and password.</p>
       ${button(env.WEB_BASE_URL, "Go to Wellsure HR Portal")}`,
    ),
  });
}

const escapeHtml = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

// E1.1: whenever an admin changes someone's sign-in security from the app
// (reset 2FA, unlock, send a password reset), that person is told who did it
// and why — so a compromised admin account can't quietly take over another,
// including one Super Admin over the other.
export async function sendSecurityChangeNoticeEmail(to: string, fullName: string, change: string, by: string, reason: string): Promise<void> {
  await mailService.send({
    to,
    subject: "[Security] Your Wellsure HR Portal sign-in was changed by an administrator",
    html: emailLayout(
      "Your sign-in security was changed",
      `<p>Hi ${escapeHtml(fullName)},</p>
       <p><strong>${escapeHtml(change)}</strong> — done by <strong>${escapeHtml(by)}</strong> at ${new Date().toISOString()} (UTC).</p>
       <p>Reason given: ${escapeHtml(reason)}</p>
       <p>If you didn't ask for this, contact your Super Admin immediately.</p>`,
    ),
  });
}
