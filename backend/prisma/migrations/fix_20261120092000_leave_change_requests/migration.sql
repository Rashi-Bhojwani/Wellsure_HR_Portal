-- FIX-C3 (independent audit 2026-11-20): leave-changing actions are proposals that a different director confirms (modules/leave/changeRequests.ts).
CREATE TYPE "LeaveChangeKind" AS ENUM ('GRANT', 'COMP_OFF_GRANT', 'IMPORT');
CREATE TYPE "LeaveChangeStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');

CREATE TABLE "leave_change_requests" (
    "id" TEXT NOT NULL,
    "kind" "LeaveChangeKind" NOT NULL,
    "status" "LeaveChangeStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "import_batch_id" TEXT,
    "target_employee_ids" TEXT[],
    "summary" TEXT NOT NULL,
    "proposed_by_user_id" TEXT NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "result" JSONB,
    CONSTRAINT "leave_change_requests_pkey" PRIMARY KEY ("id"),
    -- A confirmation is never by the proposer (a rejection may be: the proposer withdrawing their own proposal).
    CONSTRAINT "leave_change_requests_confirmer_not_proposer" CHECK ("status" <> 'CONFIRMED' OR "decided_by_user_id" <> "proposed_by_user_id"),
    CONSTRAINT "leave_change_requests_decided_fields" CHECK (("status" = 'PENDING') = ("decided_by_user_id" IS NULL AND "decided_at" IS NULL))
);

CREATE INDEX "leave_change_requests_status_proposed_at_idx" ON "leave_change_requests"("status", "proposed_at");

-- A row is decided once: PENDING -> CONFIRMED or REJECTED, with only the decision columns (and the result) written. Never deleted (except the test purge).
CREATE OR REPLACE FUNCTION leave_change_requests_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'LEAVE_CHANGE_APPEND_ONLY: a leave change request is never deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'LEAVE_CHANGE_APPEND_ONLY: a leave change request is never deleted';
  END IF;
  IF OLD."status" <> 'PENDING' OR NEW."status" = 'PENDING'
     OR NEW."id" <> OLD."id" OR NEW."kind" <> OLD."kind" OR NEW."payload" <> OLD."payload"
     OR NEW."import_batch_id" IS DISTINCT FROM OLD."import_batch_id" OR NEW."target_employee_ids" IS DISTINCT FROM OLD."target_employee_ids"
     OR NEW."summary" <> OLD."summary" OR NEW."proposed_by_user_id" <> OLD."proposed_by_user_id" OR NEW."proposed_at" <> OLD."proposed_at" THEN
    RAISE EXCEPTION 'LEAVE_CHANGE_DECIDED_ONCE: a leave change request is decided once, and only its decision is written';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER leave_change_requests_guard BEFORE UPDATE OR DELETE ON "leave_change_requests" FOR EACH ROW EXECUTE FUNCTION leave_change_requests_guard();
CREATE TRIGGER leave_change_requests_no_truncate BEFORE TRUNCATE ON "leave_change_requests" FOR EACH STATEMENT EXECUTE FUNCTION leave_change_requests_guard();
