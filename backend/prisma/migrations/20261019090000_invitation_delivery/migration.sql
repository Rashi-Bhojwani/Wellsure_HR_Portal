-- What happened to each invitation email (docs/GETTING_STARTED.md, "Sending real email in development"). A token whose email was never accepted by a mail server has no
-- email_sent_at, so HR is never told someone was invited when they were not.
ALTER TABLE "invitation_tokens"
  ADD COLUMN "email_to" TEXT,
  ADD COLUMN "email_driver" TEXT,
  ADD COLUMN "email_attempted_at" TIMESTAMP(3),
  ADD COLUMN "email_sent_at" TIMESTAMP(3),
  ADD COLUMN "email_error" TEXT;
