-- FIX-C1/M1 (independent audit 2026-11-20). HR could change a director's personal email (the address sign-in and reset links go to), then use the public
-- "forgot password" and sign in as the director. Now such a change is held for a director's confirmation (modules/employee/contactChanges.ts), and every
-- access token carries the account's session version so a password reset, a password change or a setup-link use ends every other session at once.
ALTER TABLE "users" ADD COLUMN "session_version" INTEGER NOT NULL DEFAULT 0;

CREATE TYPE "ContactChangeKind" AS ENUM ('LOGIN_EMAIL', 'DIRECTOR_RECORD');
CREATE TYPE "ContactChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

CREATE TABLE "contact_change_requests" (
    "id" TEXT NOT NULL,
    "kind" "ContactChangeKind" NOT NULL,
    "status" "ContactChangeStatus" NOT NULL DEFAULT 'PENDING',
    "employee_id" TEXT NOT NULL,
    "target_user_id" TEXT,
    "changes" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "proposed_by_user_id" TEXT NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    CONSTRAINT "contact_change_requests_pkey" PRIMARY KEY ("id"),
    -- Applied only by someone other than the proposer, and never by the person whose record it is.
    CONSTRAINT "contact_change_requests_confirmer" CHECK ("status" <> 'APPLIED' OR ("decided_by_user_id" <> "proposed_by_user_id" AND "decided_by_user_id" IS DISTINCT FROM "target_user_id"))
);
CREATE INDEX "contact_change_requests_status_proposed_at_idx" ON "contact_change_requests"("status", "proposed_at");
CREATE INDEX "contact_change_requests_employee_id_idx" ON "contact_change_requests"("employee_id");

CREATE OR REPLACE FUNCTION contact_change_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'CONTACT_CHANGE_APPEND_ONLY: a contact change request is never deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'CONTACT_CHANGE_APPEND_ONLY: a contact change request is never deleted'; END IF;
  IF OLD."status" <> 'PENDING' OR NEW."status" = 'PENDING'
     OR NEW."id" <> OLD."id" OR NEW."kind" <> OLD."kind" OR NEW."employee_id" <> OLD."employee_id" OR NEW."target_user_id" IS DISTINCT FROM OLD."target_user_id"
     OR NEW."changes" <> OLD."changes" OR NEW."source" <> OLD."source" OR NEW."proposed_by_user_id" <> OLD."proposed_by_user_id" OR NEW."proposed_at" <> OLD."proposed_at" THEN
    RAISE EXCEPTION 'CONTACT_CHANGE_DECIDED_ONCE: a contact change request is decided once, and only its decision is written';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER contact_change_requests_guard BEFORE UPDATE OR DELETE ON "contact_change_requests" FOR EACH ROW EXECUTE FUNCTION contact_change_requests_guard();
CREATE TRIGGER contact_change_requests_no_truncate BEFORE TRUNCATE ON "contact_change_requests" FOR EACH STATEMENT EXECUTE FUNCTION contact_change_requests_guard();
