# mail

`MailService` interface (`send`) selected by `MAIL_DRIVER` (`mail/index.ts`):

- **`console`** (default, dev) — `ConsoleMailService` logs the message and
  writes a real `.eml` file (open it in any mail client) to `MAIL_DEV_DIR`
  (default `.mail/`, gitignored). Nothing is actually sent.
- **`ses`** (staging/production) — `SesMailService`, via
  `@aws-sdk/client-ses`.

Used for invite, password reset, notification and payslip emails starting
Phase 1.
