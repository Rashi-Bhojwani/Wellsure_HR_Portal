import { env } from "../../config/env";
import { ConsoleMailService } from "./ConsoleMailService";
import { GuardedMailService } from "./guard";
import type { MailService } from "./MailService";
import { SesMailService } from "./SesMailService";
import { SmtpMailService } from "./SmtpMailService";

export type { MailMessage, MailReceipt, MailService } from "./MailService";
export { describeMailError } from "./SmtpMailService";
export { MailRefusedError } from "./guard";

export function createMailService(driver: typeof env.MAIL_DRIVER = env.MAIL_DRIVER): MailService {
  switch (driver) {
    case "console":
      return new ConsoleMailService(); // writes a local file and sends nothing
    // PEEPS-BEGIN mail-guard: every driver that really sends goes through the guard (guard.ts).
    case "smtp":
      return new GuardedMailService(new SmtpMailService());
    case "ses":
      return new GuardedMailService(new SesMailService());
    // PEEPS-END mail-guard
  }
}

export const mailService: MailService = createMailService();
/** Which driver is in use, for screens that must not claim an email went anywhere when it did not. */
export const mailDriver = env.MAIL_DRIVER;
