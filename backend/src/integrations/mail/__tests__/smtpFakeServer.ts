import { createServer, type Server } from "node:net";

// A small SMTP server for tests: it speaks just enough of the protocol (EHLO, AUTH PLAIN, MAIL, RCPT, DATA, QUIT) to receive a message from nodemailer, can be told to refuse
// the sign-in or a recipient, and keeps what it received. Plain text only: the tests turn SMTP_REQUIRE_TLS off for it, which is what a local catcher such as Mailpit needs too.

export interface FakeSmtp {
  port: number;
  received: Array<{ from: string; to: string[]; data: string; authUser: string | null }>;
  close(): Promise<void>;
}

export async function startFakeSmtp(opts: { user?: string; password?: string; refuseRecipient?: string } = {}): Promise<FakeSmtp> {
  const received: FakeSmtp["received"] = [];
  const server: Server = createServer((socket) => {
    let buffer = "";
    let data: string | null = null;
    let from = "";
    let to: string[] = [];
    let authUser: string | null = null;
    const reply = (line: string) => socket.write(`${line}\r\n`);
    reply("220 fake.smtp ESMTP ready");
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      for (;;) {
        if (data !== null) {
          const end = buffer.indexOf("\r\n.\r\n");
          if (end === -1) return;
          received.push({ from, to, data: buffer.slice(0, end), authUser });
          buffer = buffer.slice(end + 5);
          data = null;
          reply("250 2.0.0 queued as TEST");
          continue;
        }
        const eol = buffer.indexOf("\r\n");
        if (eol === -1) return;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        const [cmd = "", ...rest] = line.split(" ");
        switch (cmd.toUpperCase()) {
          case "EHLO":
          case "HELO":
            socket.write(`250-fake.smtp\r\n${opts.user ? "250-AUTH PLAIN\r\n" : ""}250 OK\r\n`);
            break;
          case "AUTH": {
            const decoded = Buffer.from(rest[1] ?? "", "base64").toString("utf8").split("\u0000");
            if (decoded[1] === opts.user && decoded[2] === opts.password) {
              authUser = decoded[1] ?? null;
              reply("235 2.7.0 Authentication successful");
            } else reply("535 5.7.8 Username and Password not accepted");
            break;
          }
          case "MAIL":
            from = line.slice(line.indexOf("<") + 1, line.indexOf(">"));
            reply("250 OK");
            break;
          case "RCPT": {
            const rcpt = line.slice(line.indexOf("<") + 1, line.indexOf(">"));
            if (opts.refuseRecipient && rcpt.toLowerCase() === opts.refuseRecipient.toLowerCase()) reply("550 5.1.1 No such user here");
            else {
              to.push(rcpt);
              reply("250 OK");
            }
            break;
          }
          case "DATA":
            data = "";
            reply("354 End data with <CR><LF>.<CR><LF>");
            break;
          case "RSET":
            to = [];
            reply("250 OK");
            break;
          case "QUIT":
            reply("221 Bye");
            socket.end();
            return;
          default:
            reply("250 OK");
        }
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return { port, received, close: () => new Promise((resolve) => server.close(() => resolve())) };
}
