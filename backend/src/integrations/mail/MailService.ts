export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

/**
 * What actually happened to a message. `delivered` is true only when a real mail server accepted it for delivery (SMTP or SES). The console driver writes a file and
 * sends nothing, and says so, because a screen that told HR "invited" on the strength of a file on a server would be lying.
 */
export interface MailReceipt {
  driver: "console" | "smtp" | "ses";
  delivered: boolean;
  to: string;
  /** Where it went or what the server said: the .eml path, or the server's message id. Never a secret. */
  detail: string;
}

export interface MailService {
  /** Resolves when the message has been handed over; throws if it was not. */
  send(message: MailMessage): Promise<MailReceipt>;
}
