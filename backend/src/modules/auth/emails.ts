import { env } from "../../config/env";
import { mailService } from "../../integrations/mail";

function layout(title: string, bodyHtml: string): string {
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
    html: layout(
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
    html: layout(
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
    html: layout(
      "You're all set",
      `<p>Hi ${fullName},</p>
       <p>Your password is set and your account is active. You can now sign in with your Employee Code and password.</p>
       ${button(env.WEB_BASE_URL, "Go to Wellsure HR Portal")}`,
    ),
  });
}
