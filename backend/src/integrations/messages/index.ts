import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// M session block 2, NT-11: SMS and WhatsApp behind an interface, as MailService is. The only driver is the local one (development): it writes each
// message to .messages/ and sends nothing. A real provider needs an account and a key kept as a secret; which provider is the owners' choice
// (policy.textMessages, Not set) and is wired at deployment as another implementation of this interface.
export interface TextMessage {
  channel: "SMS" | "WHATSAPP";
  to: string;
  body: string;
}
export interface MessageService {
  send(message: TextMessage): Promise<void>;
}

const DIR = path.resolve(process.cwd(), ".messages");

export class LocalMessageService implements MessageService {
  async send(message: TextMessage): Promise<void> {
    await mkdir(DIR, { recursive: true });
    await writeFile(path.join(DIR, `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}.json`), JSON.stringify(message, null, 2));
  }
}

/** Production has no provider yet: nothing is sent and nothing is written (a phone number never lands in a file on a server). */
export class NoMessageService implements MessageService {
  async send(): Promise<void> {}
}

export const messageService: MessageService = process.env.NODE_ENV === "production" ? new NoMessageService() : new LocalMessageService();
