import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import type { MailMessage, MailReceipt, MailService } from "./MailService";

// Dev mail transport — logs to the console and writes a real .eml file
// (readable in any mail client) to MAIL_DEV_DIR (default .mail/,
// gitignored) instead of sending anything. Selected by MAIL_DRIVER=console.
const DIR = path.resolve(process.cwd(), env.MAIL_DEV_DIR);
const DEV_FROM = env.SES_FROM ?? "no-reply@wellsure.local";

function toEml(message: MailMessage): string {
  return [
    `From: ${DEV_FROM}`,
    `To: ${message.to}`,
    `Subject: ${message.subject}`,
    `Date: ${new Date().toUTCString()}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset="utf-8"`,
    ``,
    message.html,
  ].join("\r\n");
}

export class ConsoleMailService implements MailService {
  async send(message: MailMessage): Promise<MailReceipt> {
    logger.info({ to: message.to, subject: message.subject }, "dev mail sent (console + .eml)");
    console.log(
      `\n----- MAIL -----\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text ?? message.html}\n----------------\n`,
    );

    await mkdir(DIR, { recursive: true });
    const filename = `${Date.now()}-${randomUUID().slice(0, 8)}.eml`;
    const file = path.join(DIR, filename);
    await writeFile(file, toEml(message), "utf8");
    return { driver: "console", delivered: false, to: message.to, detail: file };
  }
}
