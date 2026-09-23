import { env } from "../../config/env";
import { ConsoleMailService } from "./ConsoleMailService";
import type { MailService } from "./MailService";
import { SesMailService } from "./SesMailService";

export type { MailMessage, MailService } from "./MailService";

function createMailService(): MailService {
  switch (env.MAIL_DRIVER) {
    case "console":
      return new ConsoleMailService();
    case "ses":
      return new SesMailService();
  }
}

export const mailService: MailService = createMailService();
