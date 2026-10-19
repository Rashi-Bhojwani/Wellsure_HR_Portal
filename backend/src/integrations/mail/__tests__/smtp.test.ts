import { afterEach, describe, expect, it } from "vitest";
import { env } from "../../../config/env";
import { describeMailError, MailNotAcceptedError, SmtpMailService } from "../SmtpMailService";
import { startFakeSmtp, type FakeSmtp } from "./smtpFakeServer";

// The SMTP driver (MAIL_DRIVER=smtp), against a real SMTP conversation on a local port: what arrives, what is refused, and the words a failure is put into.

type Mutable = { -readonly [K in keyof typeof env]: (typeof env)[K] };
const e = env as Mutable;
const saved = { ...env };
let server: FakeSmtp | null = null;

afterEach(async () => {
  Object.assign(e, saved);
  await server?.close();
  server = null;
});

function configure(port: number, extra: Partial<Mutable> = {}): void {
  Object.assign(e, { SMTP_HOST: "127.0.0.1", SMTP_PORT: port, SMTP_SECURE: false, SMTP_REQUIRE_TLS: false, SMTP_USER: "hr@example.org", SMTP_PASSWORD: "app-password-123", MAIL_FROM: "Wellsure HR <hr@example.org>", ...extra });
}

describe("MAIL_DRIVER=smtp", () => {
  it("hands a real message to the server, signed in, from the configured address, and says it was delivered", async () => {
    server = await startFakeSmtp({ user: "hr@example.org", password: "app-password-123" });
    configure(server.port);
    const receipt = await new SmtpMailService().send({ to: "new.hire@gmail.com", subject: "Welcome", html: "<p>Hello there</p>", text: "Hello there" });
    expect(receipt).toMatchObject({ driver: "smtp", delivered: true, to: "new.hire@gmail.com" });
    expect(server.received).toHaveLength(1);
    const got = server.received[0]!;
    expect([got.from, got.to, got.authUser]).toEqual(["hr@example.org", ["new.hire@gmail.com"], "hr@example.org"]);
    expect(got.data).toMatch(/Subject: Welcome/);
    expect(got.data).toMatch(/From: .*hr@example\.org/);
    expect(got.data).toMatch(/Hello there/);
  });

  it("works without a sign-in against a local catcher, and refuses to start without a host", async () => {
    server = await startFakeSmtp();
    configure(server.port, { SMTP_USER: undefined, SMTP_PASSWORD: undefined, MAIL_FROM: undefined });
    expect((await new SmtpMailService().send({ to: "a@example.org", subject: "x", html: "<p>x</p>" })).delivered).toBe(true);
    Object.assign(e, { SMTP_HOST: undefined });
    expect(() => new SmtpMailService()).toThrow(/SMTP_HOST/);
    Object.assign(e, { SMTP_HOST: "127.0.0.1", SMTP_USER: "someone" });
    expect(() => new SmtpMailService()).toThrow(/SMTP_PASSWORD/);
  });

  it("a wrong password is a failure in words, with no password in it; a Gmail host says to use an app password", async () => {
    server = await startFakeSmtp({ user: "hr@example.org", password: "right-one" });
    configure(server.port, { SMTP_PASSWORD: "wrong-secret-xyz" });
    const err = await new SmtpMailService().send({ to: "a@example.org", subject: "x", html: "<p>x</p>" }).catch((x: unknown) => x);
    const words = describeMailError(err);
    expect(words).toMatch(/refused the sign-in/);
    expect(words).not.toContain("wrong-secret-xyz");
    expect(describeMailError(Object.assign(new Error("x"), { code: "EAUTH" }))).not.toMatch(/app password/);
    Object.assign(e, { SMTP_HOST: "smtp.gmail.com" });
    expect(describeMailError(Object.assign(new Error("x"), { code: "EAUTH" }))).toMatch(/app password/);
  });

  it("a recipient the server refuses is a failure, never reported as delivered", async () => {
    server = await startFakeSmtp({ user: "hr@example.org", password: "app-password-123", refuseRecipient: "nobody@example.org" });
    configure(server.port);
    const err = await new SmtpMailService().send({ to: "nobody@example.org", subject: "x", html: "<p>x</p>" }).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(Error);
    expect(describeMailError(err)).toMatch(/did not accept|550|No such user/i);
    expect(server.received).toHaveLength(0);
  });

  it("an unreachable server is a failure that names the host and port", async () => {
    configure(1); // nothing listens there
    const err = await new SmtpMailService().send({ to: "a@example.org", subject: "x", html: "<p>x</p>" }).catch((x: unknown) => x);
    expect(describeMailError(err)).toMatch(/Could not reach 127\.0\.0\.1:1/);
  });

  it("MailNotAcceptedError carries its own message", () => {
    expect(describeMailError(new MailNotAcceptedError("The mail server did not accept a@b.c."))).toBe("The mail server did not accept a@b.c.");
  });
});
