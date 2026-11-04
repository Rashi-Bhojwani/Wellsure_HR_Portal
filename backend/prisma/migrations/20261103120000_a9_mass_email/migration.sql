-- A-9 G5 (docs/plans/GREYTHR_PARITY_EMPLOYEE_ADMIN.md): mass email (drafts, sending, history). One new key, held by nobody but the directors until an owner grants it.
-- CreateEnum
CREATE TYPE "MassEmailStatus" AS ENUM ('DRAFT', 'SENDING', 'SENT', 'DISCARDED');

-- CreateEnum
CREATE TYPE "MassEmailAudience" AS ENUM ('ALL', 'SEGMENT', 'PEOPLE');

-- CreateEnum
CREATE TYPE "MassEmailOutcome" AS ENUM ('SENT', 'FAILED', 'NO_ADDRESS');

-- CreateTable
CREATE TABLE "mass_emails" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "category" TEXT,
    "audience" "MassEmailAudience" NOT NULL,
    "segment_id" TEXT,
    "employee_ids" JSONB NOT NULL DEFAULT '[]',
    "status" "MassEmailStatus" NOT NULL DEFAULT 'DRAFT',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "sent_by_user_id" TEXT,
    "sent_at" TIMESTAMPTZ(3),
    "recipient_count" INTEGER,
    "delivered_count" INTEGER,
    "failed_count" INTEGER,
    "discarded_at" TIMESTAMPTZ(3),

    CONSTRAINT "mass_emails_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mass_email_recipients" (
    "id" TEXT NOT NULL,
    "mass_email_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "outcome" "MassEmailOutcome" NOT NULL,
    "detail" TEXT,

    CONSTRAINT "mass_email_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mass_emails_status_created_at_idx" ON "mass_emails"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "mass_email_recipients_mass_email_id_employee_id_key" ON "mass_email_recipients"("mass_email_id", "employee_id");

-- AddForeignKey
ALTER TABLE "mass_email_recipients" ADD CONSTRAINT "mass_email_recipients_mass_email_id_fkey" FOREIGN KEY ("mass_email_id") REFERENCES "mass_emails"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mass_email_recipients" ADD CONSTRAINT "mass_email_recipients_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "mass_emails" ADD CONSTRAINT "mass_emails_sent_check" CHECK ("status" <> 'SENT' OR ("sent_at" IS NOT NULL AND "sent_by_user_id" IS NOT NULL AND "recipient_count" IS NOT NULL));

INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, 'communication.mass.send', 'Mass email'
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = 'communication.mass.send');
