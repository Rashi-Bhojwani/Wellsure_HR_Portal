import { env } from "../../config/env";
import { ConsoleMailService } from "./ConsoleMailService";
import type { MailService } from "./MailService";
import { SesMailService } from "./SesMailService";
import { SmtpMailService } from "./SmtpMailService";

export type { MailMessage, MailReceipt, MailService } from "./MailService";
export { describeMailError } from "./SmtpMailService";

function createMailService(): MailService {
  switch (env.MAIL_DRIVER) {
    case "console":
      return new ConsoleMailService();
    case "smtp":
      return new SmtpMailService();
    case "ses":
      return new SesMailService();
  }
}

export const mailService: MailService = createMailService();
/** Which driver is in use, for screens that must not claim an email went anywhere when it did not. */
export const mailDriver = env.MAIL_DRIVER;
