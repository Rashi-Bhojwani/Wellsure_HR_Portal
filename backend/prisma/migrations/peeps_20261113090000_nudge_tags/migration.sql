-- Peeps Stage 3: public light-hearted nudge tags (given by a director only, a week each, no free text), and the old private corrective notes made
-- read-only (existing rows are kept; no new note, read or withdrawal can be written). Forward-only, additive.

-- CreateEnum
CREATE TYPE "NudgeReviewOutcome" AS ENUM ('KEPT', 'REMOVED');

-- CreateTable
CREATE TABLE "nudge_tag_awards" (
    "id" TEXT NOT NULL,
    "tag_code" TEXT NOT NULL,
    "recipient_employee_id" TEXT NOT NULL,
    "giver_user_id" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "given_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "nudge_tag_awards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_tag_removals" (
    "id" TEXT NOT NULL,
    "award_id" TEXT NOT NULL,
    "removed_by_user_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_tag_removals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_tag_review_requests" (
    "id" TEXT NOT NULL,
    "award_id" TEXT NOT NULL,
    "requested_by_employee_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_tag_review_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_tag_review_decisions" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "decided_by_user_id" TEXT NOT NULL,
    "outcome" "NudgeReviewOutcome" NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_tag_review_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nudge_tag_awards_recipient_employee_id_idx" ON "nudge_tag_awards"("recipient_employee_id");

-- CreateIndex
CREATE INDEX "nudge_tag_awards_expires_at_idx" ON "nudge_tag_awards"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_tag_awards_giver_user_id_idempotency_key_key" ON "nudge_tag_awards"("giver_user_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_tag_removals_award_id_key" ON "nudge_tag_removals"("award_id");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_tag_review_requests_award_id_key" ON "nudge_tag_review_requests"("award_id");

-- CreateIndex
CREATE UNIQUE INDEX "nudge_tag_review_decisions_request_id_key" ON "nudge_tag_review_decisions"("request_id");

-- AddForeignKey
ALTER TABLE "nudge_tag_awards" ADD CONSTRAINT "nudge_tag_awards_recipient_employee_id_fkey" FOREIGN KEY ("recipient_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_tag_removals" ADD CONSTRAINT "nudge_tag_removals_award_id_fkey" FOREIGN KEY ("award_id") REFERENCES "nudge_tag_awards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_tag_review_requests" ADD CONSTRAINT "nudge_tag_review_requests_award_id_fkey" FOREIGN KEY ("award_id") REFERENCES "nudge_tag_awards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_tag_review_decisions" ADD CONSTRAINT "nudge_tag_review_decisions_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "nudge_tag_review_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "nudge_tag_awards" ADD CONSTRAINT "nudge_tag_awards_expiry_after" CHECK ("expires_at" > "given_at");
ALTER TABLE "nudge_tag_removals" ADD CONSTRAINT "nudge_tag_removals_reason" CHECK (length(btrim("reason")) >= 3);

-- Append-only: no UPDATE, DELETE or TRUNCATE (the app role also loses UPDATE/DELETE through dbRoles, which reads these triggers).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nudge_tag_awards', 'nudge_tag_removals', 'nudge_tag_review_requests', 'nudge_tag_review_decisions'] LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION peeps_core_append_only()', t || '_append_only', t);
    EXECUTE format('CREATE TRIGGER %I BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION peeps_core_append_only()', t || '_no_truncate', t);
  END LOOP;
END $$;

-- Only a director gives, removes or decides (whatever the service does): a system job or anyone else is refused by the database.
CREATE OR REPLACE FUNCTION peeps_nudge_tag_director_only() RETURNS trigger AS $$
DECLARE uid TEXT;
BEGIN
  uid := CASE TG_TABLE_NAME
    WHEN 'nudge_tag_awards' THEN NEW."giver_user_id"
    WHEN 'nudge_tag_removals' THEN NEW."removed_by_user_id"
    ELSE NEW."decided_by_user_id"
  END;
  IF NOT peeps_is_director(uid) THEN
    RAISE EXCEPTION 'PEEPS_NUDGE_DIRECTORS_ONLY: only a director gives, removes or decides a nudge tag';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER nudge_tag_awards_director_only BEFORE INSERT ON "nudge_tag_awards" FOR EACH ROW EXECUTE FUNCTION peeps_nudge_tag_director_only();
CREATE TRIGGER nudge_tag_removals_director_only BEFORE INSERT ON "nudge_tag_removals" FOR EACH ROW EXECUTE FUNCTION peeps_nudge_tag_director_only();
CREATE TRIGGER nudge_tag_review_decisions_director_only BEFORE INSERT ON "nudge_tag_review_decisions" FOR EACH ROW EXECUTE FUNCTION peeps_nudge_tag_director_only();

-- A review is asked for by the person the tag was given to, and only them.
CREATE OR REPLACE FUNCTION peeps_nudge_review_by_recipient() RETURNS trigger AS $$
BEGIN
  IF (SELECT a."recipient_employee_id" FROM "nudge_tag_awards" a WHERE a."id" = NEW."award_id") IS DISTINCT FROM NEW."requested_by_employee_id" THEN
    RAISE EXCEPTION 'PEEPS_NUDGE_REVIEW_RECIPIENT: only the person the tag was given to asks for a review';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER nudge_tag_review_requests_recipient BEFORE INSERT ON "nudge_tag_review_requests" FOR EACH ROW EXECUTE FUNCTION peeps_nudge_review_by_recipient();

-- The old private corrective notes are read-only from now on: existing rows stay (directors and the person concerned read them); nothing new is written.
-- The one exception: a development or test database (dev_database_marker present) may write a fixture note inside a transaction that sets
-- app.legacy_note_fixture = 'dev' (the demo company and the tests that prove the notes stay readable). A production database has no marker.
CREATE OR REPLACE FUNCTION peeps_private_notes_read_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.legacy_note_fixture', true) = 'dev' AND EXISTS (SELECT 1 FROM dev_database_marker) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'PEEPS_NOTES_READ_ONLY: private corrective notes are read-only (Peeps Stage 3); no new note, read or withdrawal is recorded';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER private_nudges_read_only BEFORE INSERT ON "private_nudges" FOR EACH ROW EXECUTE FUNCTION peeps_private_notes_read_only();
CREATE TRIGGER nudge_reads_read_only BEFORE INSERT ON "nudge_reads" FOR EACH ROW EXECUTE FUNCTION peeps_private_notes_read_only();
CREATE TRIGGER nudge_revocations_read_only BEFORE INSERT ON "nudge_revocations" FOR EACH ROW EXECUTE FUNCTION peeps_private_notes_read_only();
