# mail

`MailService` interface (`send`) selected by `MAIL_DRIVER` (`mail/index.ts`):

- **`console`** (default, dev) — `ConsoleMailService` logs the message and
  writes a real `.eml` file (open it in any mail client) to `MAIL_DEV_DIR`
  (default `.mail/`, gitignored). Nothing is actually sent.
- **`smtp`** (development only) — `SmtpMailService`, via nodemailer, through
  any SMTP account (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASSWORD`, `MAIL_FROM`), so a real email reaches a real inbox. Staging
  and production refuse to start on it. `send` returns a receipt (`delivered`
  is true only when a real server accepted it) and throws when it was not
  accepted; `describeMailError` puts a failure into words.
- **`ses`** (staging/production) — `SesMailService`, via
  `@aws-sdk/client-ses`.

Used for invite, password reset, notification and payslip emails starting
Phase 1.
