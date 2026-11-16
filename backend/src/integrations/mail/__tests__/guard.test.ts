import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { env } from "../../../config/env";
import { prisma } from "../../../lib/prisma";
import { getSetting, setSetting } from "../../../lib/settings";
import { cleanupEmployeeTestOrgMasters, cleanupFullTestEmployee, createEmployeeTestOrgMasters, createFullTestEmployee, type TestOrgMasters } from "../../../modules/employee/__tests__/employeeTestHelpers";
import { GuardedMailService, MailRefusedError, isReservedDomain } from "../guard";
import { createMailService } from "../index";
import type { MailMessage, MailReceipt, MailService } from "../MailService";

// Peeps Stage 4 (seed safety): the mail guard in front of every driver that really sends. Reserved test domains and demo company employees are
// refused in every mode; outside production only the domains in MAIL_ALLOWED_DOMAINS are reached. A refused message never reaches the transport.

class RecordingTransport implements MailService {
  sent: string[] = [];
  async send(message: MailMessage): Promise<MailReceipt> {
    this.sent.push(message.to);
    return { driver: "smtp", delivered: true, to: message.to, detail: "recorded" };
  }
}
const mail = (to: string): MailMessage => ({ to, subject: "DEMO subject", html: "<p>DEMO</p>" });
const mutableEnv = env as { APP_ENV: string; MAIL_ALLOWED_DOMAINS: string };

describe("the mail guard", () => {
  const original = { APP_ENV: mutableEnv.APP_ENV, MAIL_ALLOWED_DOMAINS: mutableEnv.MAIL_ALLOWED_DOMAINS };
  let demoWas = false;
  let org: TestOrgMasters;
  let demoPerson: Awaited<ReturnType<typeof createFullTestEmployee>>;
  let demoOfficial = "";
  let demoPersonal = "";

  beforeAll(async () => {
    demoWas = await getSetting<boolean>("demo.company", false);
    org = await createEmployeeTestOrgMasters();
    demoPerson = await createFullTestEmployee(org);
    const suffix = demoPerson.employeeId.slice(-8);
    demoOfficial = `demo.guard.${suffix}@allowed-domain.in`;
    await prisma.employee.update({ where: { id: demoPerson.employeeId }, data: { employeeCode: `DEMOGUARD${suffix}`, officialEmail: demoOfficial } });
    demoPersonal = `demo.guard.personal.${suffix}@allowed-domain.in`;
    await prisma.employeePersonal.update({ where: { employeeId: demoPerson.employeeId }, data: { personalEmail: demoPersonal } });
  });
  afterEach(() => Object.assign(mutableEnv, original));
  afterAll(async () => {
    await setSetting("demo.company", demoWas, null);
    await cleanupFullTestEmployee(demoPerson.employeeId);
    await cleanupEmployeeTestOrgMasters(org);
  });

  it("the drivers that really send are guarded; the console driver (a local file) is not", () => {
    const drivers = env as { SMTP_HOST?: string; SES_FROM?: string };
    const saved = { SMTP_HOST: drivers.SMTP_HOST, SES_FROM: drivers.SES_FROM };
    Object.assign(drivers, { SMTP_HOST: "smtp.example.invalid", SES_FROM: "no-reply@example.invalid" }); // constructing a driver needs its settings
    try {
      expect(createMailService("smtp")).toBeInstanceOf(GuardedMailService);
      expect(createMailService("ses")).toBeInstanceOf(GuardedMailService);
    } finally {
      Object.assign(drivers, saved);
    }
    expect(createMailService("console")).not.toBeInstanceOf(GuardedMailService);
  });

  it("reserved test domains are refused in every mode, production included, and never reach the transport", async () => {
    for (const d of ["example.invalid", "demo.example.invalid", "personal.example.invalid", "x.test", "example.com", "mail.example.org", "localhost"]) expect(isReservedDomain(d), d).toBe(true);
    for (const d of ["gmail.com", "allowed-domain.in", "examples.com"]) expect(isReservedDomain(d), d).toBe(false);
    const transport = new RecordingTransport();
    const guarded = new GuardedMailService(transport);
    for (const appEnv of ["development", "staging", "production"]) {
      Object.assign(mutableEnv, { APP_ENV: appEnv, MAIL_ALLOWED_DOMAINS: "example.invalid,example.com" }); // even listed, a reserved domain is refused
      await expect(guarded.send(mail("someone@demo.example.invalid"))).rejects.toBeInstanceOf(MailRefusedError);
      await expect(guarded.send(mail("someone@example.com"))).rejects.toThrow(/reserved test domain/);
    }
    expect(transport.sent).toEqual([]);
  });

  it("outside production only the allowlisted domains are reached (empty list: nowhere); production reaches any real domain", async () => {
    const transport = new RecordingTransport();
    const guarded = new GuardedMailService(transport);
    for (const appEnv of ["development", "staging"]) {
      Object.assign(mutableEnv, { APP_ENV: appEnv, MAIL_ALLOWED_DOMAINS: "" });
      await expect(guarded.send(mail("new.hire@gmail.com"))).rejects.toThrow(/not listed in MAIL_ALLOWED_DOMAINS/);
      Object.assign(mutableEnv, { MAIL_ALLOWED_DOMAINS: " Allowed-Domain.in , other.in" });
      await expect(guarded.send(mail("new.hire@gmail.com"))).rejects.toBeInstanceOf(MailRefusedError);
      await expect(guarded.send(mail("someone@allowed-domain.in"))).resolves.toMatchObject({ delivered: true });
    }
    Object.assign(mutableEnv, { APP_ENV: "production", MAIL_ALLOWED_DOMAINS: "" });
    await expect(guarded.send(mail("new.hire@gmail.com"))).resolves.toMatchObject({ delivered: true });
    expect(transport.sent).toEqual(["someone@allowed-domain.in", "someone@allowed-domain.in", "new.hire@gmail.com"]);
    await expect(guarded.send(mail("not an address"))).rejects.toBeInstanceOf(MailRefusedError);
  });

  it("while the demo company is marked, its employees' official and personal addresses are refused in every mode, even on an allowed domain", async () => {
    const transport = new RecordingTransport();
    const guarded = new GuardedMailService(transport);
    await setSetting("demo.company", true, null);
    for (const appEnv of ["development", "production"]) {
      Object.assign(mutableEnv, { APP_ENV: appEnv, MAIL_ALLOWED_DOMAINS: "allowed-domain.in" });
      await expect(guarded.send(mail(demoOfficial))).rejects.toThrow(/demo company employee/);
      await expect(guarded.send(mail(demoPersonal.toUpperCase()))).rejects.toThrow(/demo company employee/);
    }
    expect(transport.sent).toEqual([]);
    // Without the demo marker the same addresses are ordinary ones.
    await setSetting("demo.company", false, null);
    Object.assign(mutableEnv, { APP_ENV: "development", MAIL_ALLOWED_DOMAINS: "allowed-domain.in" });
    await expect(guarded.send(mail(demoOfficial))).resolves.toMatchObject({ delivered: true });
  });
});
