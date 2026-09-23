export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export interface MailService {
  send(message: MailMessage): Promise<void>;
}
