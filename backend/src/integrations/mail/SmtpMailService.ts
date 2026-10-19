import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import type { MailMessage, MailReceipt, MailService } from "./MailService";

// Real email from a development machine, through any SMTP account: a Gmail app password, Mailtrap, a company relay. Selected by MAIL_DRIVER=smtp, and development
// only: the production guard refuses to start staging or production on anything but SES. Nothing here is logged except the recipient, the subject and the server's
// message id; the password is never printed, and an error is put into words (describeMailError) before it reaches a screen.

export class MailNotAcceptedError extends Error {}

export class SmtpMailService implements MailService {
  private readonly transporter: Transporter;
  private readonly from: string;

  constructor() {
    if (!env.SMTP_HOST) throw new Error('MAIL_DRIVER=smtp needs SMTP_HOST (see docs/GETTING_STARTED.md, "Sending real email in development").');
    if (env.SMTP_USER && !env.SMTP_PASSWORD) throw new Error("SMTP_USER is set but SMTP_PASSWORD is not.");
    this.from = env.MAIL_FROM ?? env.SMTP_USER ?? env.SES_FROM ?? "no-reply@wellsure.local";
    this.transporter = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      requireTLS: !env.SMTP_SECURE && env.SMTP_REQUIRE_TLS, // never fall back to sending the password in the clear
      ignoreTLS: !env.SMTP_SECURE && !env.SMTP_REQUIRE_TLS,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASSWORD! } } : {}),
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
  }

  async send(message: MailMessage): Promise<MailReceipt> {
    const info = await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.text ? { text: message.text } : {}),
    });
    const accepted = (info.accepted as unknown[]).map(String);
    if (!accepted.some((a) => a.toLowerCase() === message.to.toLowerCase())) {
      const rejected = (info.rejected as unknown[]).map(String);
      throw new MailNotAcceptedError(`The mail server did not accept ${message.to}${rejected.length ? ` (it rejected ${rejected.join(", ")})` : ""}.`);
    }
    logger.info({ to: message.to, subject: message.subject, messageId: info.messageId }, "mail handed to the SMTP server");
    return { driver: "smtp", delivered: true, to: message.to, detail: String(info.messageId ?? "") };
  }
}

/** A sending failure in words a person can act on. Never includes a credential. */
export function describeMailError(err: unknown): string {
  const e = err as { code?: string; responseCode?: number; response?: string; message?: string; command?: string };
  if (err instanceof MailNotAcceptedError) return err.message;
  const host = env.SMTP_HOST ? `${env.SMTP_HOST}:${env.SMTP_PORT}` : "the mail server";
  if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN/.test(`${e.code ?? ""} ${e.message ?? ""}`)) {
    return `Could not reach ${host}. Check SMTP_HOST and SMTP_PORT and that this machine can connect out.`;
  }
  switch (e.code) {
    case "EAUTH":
      return `The mail server refused the sign-in. Check SMTP_USER and SMTP_PASSWORD${/gmail/i.test(env.SMTP_HOST ?? "") ? " (Gmail needs an app password, not your normal password)" : ""}.`;
    case "ECONNECTION":
    case "ECONNREFUSED":
    case "ENOTFOUND":
    case "EDNS":
      return `Could not reach ${host}. Check SMTP_HOST and SMTP_PORT and that this machine can connect out.`;
    case "ETIMEDOUT":
    case "ESOCKET":
      return `The connection to ${host} timed out or dropped. Check SMTP_PORT and SMTP_SECURE (465 needs SMTP_SECURE=true, 587 needs false).`;
    case "EENVELOPE":
      return `The mail server did not accept the address: ${e.message ?? "invalid recipient"}.`;
    default:
      return e.response ? `The mail server said: ${e.response.slice(0, 200)}` : `The email could not be sent (${e.message?.slice(0, 160) ?? "unknown error"}).`;
  }
}
