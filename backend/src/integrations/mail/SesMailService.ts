import { SendEmailCommand, SESClient } from "@aws-sdk/client-ses";
import { env } from "../../config/env";
import type { MailMessage, MailReceipt, MailService } from "./MailService";

// The AWS implementation — selected by MAIL_DRIVER=ses (staging/production
// only; local dev uses ConsoleMailService). Credentials and region come
// from the standard AWS SDK chain (an ECS task's IAM role in staging/prod).
export class SesMailService implements MailService {
  private readonly client: SESClient;
  private readonly from: string;

  constructor() {
    if (!env.SES_FROM) {
      throw new Error("SES_FROM is required when MAIL_DRIVER=ses");
    }
    this.from = env.SES_FROM;
    this.client = new SESClient({ region: env.AWS_REGION });
  }

  async send(message: MailMessage): Promise<MailReceipt> {
    const result = await this.client.send(
      new SendEmailCommand({
        Source: this.from,
        Destination: { ToAddresses: [message.to] },
        Message: {
          Subject: { Data: message.subject },
          Body: {
            Html: { Data: message.html },
            ...(message.text ? { Text: { Data: message.text } } : {}),
          },
        },
      }),
    );
    return { driver: "ses", delivered: true, to: message.to, detail: result.MessageId ?? "" };
  }
}
