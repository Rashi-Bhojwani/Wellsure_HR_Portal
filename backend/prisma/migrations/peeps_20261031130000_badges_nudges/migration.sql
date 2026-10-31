-- Peeps: badges and private nudges (D-29, Q-16). Additive only. All five tables are append-only; a nudge's text is field-encrypted.

-- CreateEnum
CREATE TYPE "RecognitionGiverKind" AS ENUM ('DIRECTOR', 'OFFICE', 'MANAGER');

-- CreateTable
CREATE TABLE "badge_awards" (
    "id" TEXT NOT NULL,
    "badge_code" TEXT NOT NULL,
    "recipient_employee_id" TEXT NOT NULL,
    "giver_user_id" TEXT NOT NULL,
    "giver_kind" "RecognitionGiverKind" NOT NULL,
    "message" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "given_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3),

    CONSTRAINT "badge_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badge_revocations" (
    "id" TEXT NOT NULL,
    "award_id" TEXT NOT NULL,
    "revoked_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "badge_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "private_nudges" (
    "id" TEXT NOT NULL,
    "recipient_employee_id" TEXT NOT NULL,
    "sender_user_id" TEXT NOT NULL,
    "sender_kind" "RecognitionGiverKind" NOT NULL,
    "body_encrypted" BYTEA NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "private_nudges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_reads" (
    "id" TEXT NOT NULL,
    "nudge_id" TEXT NOT NULL,
    "read_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_reads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_revocations" (
    "id" TEXT NOT NULL,
    "nudge_id" TEXT NOT NULL,
    "revoked_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "badge_awards_recipient_employee_id_idx" ON "badge_awards"("recipient_employee_id");

-- CreateIndex
CREATE INDEX "badge_awards_giver_user_id_given_at_idx" ON "badge_awards"("giver_user_id", "given_at");

-- CreateIndex
CREATE UNIQUE INDEX "badge_awards_giver_user_id_idempotency_key_key" ON "badge_awards"("giver_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "badge_revocations_award_id_key" ON "badge_revocations"("award_id");

-- CreateIndex
CREATE INDEX "private_nudges_recipient_employee_id_idx" ON "private_nudges"("recipient_employee_id");

-- CreateIndex
CREATE INDEX "private_nudges_sender_user_id_sent_at_idx" ON "private_nudges"("sender_user_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "private_nudges_sender_user_id_idempotency_key_key" ON "private_nudges"("sender_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_reads_nudge_id_key" ON "nudge_reads"("nudge_id");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_revocations_nudge_id_key" ON "nudge_revocations"("nudge_id");

-- AddForeignKey
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_recipient_employee_id_fkey" FOREIGN KEY ("recipient_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "badge_revocations" ADD CONSTRAINT "badge_revocations_award_id_fkey" FOREIGN KEY ("award_id") REFERENCES "badge_awards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "private_nudges" ADD CONSTRAINT "private_nudges_recipient_employee_id_fkey" FOREIGN KEY ("recipient_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_reads" ADD CONSTRAINT "nudge_reads_nudge_id_fkey" FOREIGN KEY ("nudge_id") REFERENCES "private_nudges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_revocations" ADD CONSTRAINT "nudge_revocations_nudge_id_fkey" FOREIGN KEY ("nudge_id") REFERENCES "private_nudges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "badge_revocations" ADD CONSTRAINT "badge_revocations_reason" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "nudge_revocations" ADD CONSTRAINT "nudge_revocations_reason" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "badge_awards" ADD CONSTRAINT "badge_awards_expiry_after" CHECK ("expires_at" IS NULL OR "expires_at" > "given_at");

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['badge_awards', 'badge_revocations', 'private_nudges', 'nudge_reads', 'nudge_revocations'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;
