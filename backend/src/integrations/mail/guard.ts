import { env } from "../../config/env";
import { prisma } from "../../lib/prisma";
import { getSetting } from "../../lib/settings";
import type { MailMessage, MailReceipt, MailService } from "./MailService";

// The mail guard (Peeps Stage 4, seed safety). Sits in front of every driver that really sends (SMTP, SES); the console driver only writes a
// local file and is not wrapped. A refused message is never handed to the transport: send() throws MailRefusedError, which callers already
// treat as a failed send. Refused, in every mode:
//   - an address on a reserved test domain (RFC 2606/6761: .invalid, .test, .example, .localhost, example.com/.net/.org) — what the seeds and the
//     demo company use, so a seeded or demo address can never reach a real mailbox;
//   - an address of a demo company employee (employee code DEMO…), while the demo company is marked (setting demo.company).
// Refused outside production (development, staging): any address whose domain is not listed in MAIL_ALLOWED_DOMAINS (comma-separated; empty by
// default, so a development or staging stack sends nothing until someone lists the domains it may reach).

export class MailRefusedError extends Error {
  readonly code = "MAIL_REFUSED";
  constructor(reason: string) {
    super(`The mail guard refused this message: ${reason}.`);
  }
}

const RESERVED_TLDS = new Set(["invalid", "test", "example", "localhost"]);
const RESERVED_DOMAINS = new Set(["example.com", "example.net", "example.org"]);

export function domainOf(address: string): string | null {
  const m = /^[^@\s]+@([^@\s]+)$/.exec(address.trim().toLowerCase());
  return m ? m[1]!.replace(/\.$/, "") : null;
}

export function isReservedDomain(domain: string): boolean {
  const labels = domain.split(".");
  if (RESERVED_TLDS.has(labels[labels.length - 1]!)) return true;
  return [...RESERVED_DOMAINS].some((d) => domain === d || domain.endsWith(`.${d}`));
}

export function allowedDomains(): string[] {
  return (env.MAIL_ALLOWED_DOMAINS ?? "").split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

async function isDemoEmployeeAddress(address: string): Promise<boolean> {
  if ((await getSetting<boolean>("demo.company", false)) !== true) return false;
  const a = address.trim();
  const n = await prisma.employee.count({
    where: {
      employeeCode: { startsWith: "DEMO" },
      OR: [{ officialEmail: { equals: a, mode: "insensitive" } }, { personal: { personalEmail: { equals: a, mode: "insensitive" } } }],
    },
  });
  return n > 0;
}

/** Why this address must not receive mail, or null when it may. */
export async function refusalFor(address: string): Promise<string | null> {
  const domain = domainOf(address);
  if (!domain) return "not a single email address";
  if (isReservedDomain(domain)) return "a reserved test domain, never deliverable";
  if (await isDemoEmployeeAddress(address)) return "an address of a demo company employee";
  if (env.APP_ENV !== "production" && !allowedDomains().includes(domain)) return `outside production, ${domain} is not listed in MAIL_ALLOWED_DOMAINS`;
  return null;
}

export class GuardedMailService implements MailService {
  constructor(private readonly inner: MailService) {}

  async send(message: MailMessage): Promise<MailReceipt> {
    const reason = await refusalFor(message.to);
    if (reason) throw new MailRefusedError(reason);
    return this.inner.send(message);
  }
}
