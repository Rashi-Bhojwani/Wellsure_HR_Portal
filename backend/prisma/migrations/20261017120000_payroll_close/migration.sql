-- Phase 6, P6-4 (docs/plans/PHASE_6.md §14F): submit, approve, finalise and the real payroll lock.
--   payroll_runs                two new states (SUBMITTED, APPROVED); FINALISED reachable only from APPROVED, under the finaliser's switch, with both approvals consumed
--   payroll_period_locks        append-only: every FINALISE and UNLOCK of a cycle; a cycle is locked while its latest row is FINALISE
--   payroll_run_releases        append-only: payslips published / a bank file generated (P6-5 writes them); while one exists the period cannot be unlocked
--   payroll_adjustments         consumed only under the finaliser's switch; handed back to pending only under the unlock switch

ALTER TYPE "PayrollRunStatus" ADD VALUE 'SUBMITTED' AFTER 'CALCULATED';
ALTER TYPE "PayrollRunStatus" ADD VALUE 'APPROVED' AFTER 'SUBMITTED';

CREATE TYPE "PayrollLockAction" AS ENUM ('FINALISE', 'UNLOCK');
CREATE TYPE "PayrollReleaseKind" AS ENUM ('PAYSLIPS_PUBLISHED', 'BANK_FILE_GENERATED');

ALTER TABLE "payroll_runs" ADD COLUMN "finalised_at" TIMESTAMPTZ(3), ADD COLUMN "finalised_by_user_id" TEXT;
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_finalised_stamped" CHECK ("status" <> 'FINALISED' OR ("finalised_at" IS NOT NULL AND "finalised_by_user_id" IS NOT NULL));

CREATE TABLE "payroll_period_locks" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "cycle_start" DATE NOT NULL,
    "cycle_end" DATE NOT NULL,
    "cycle_label" TEXT NOT NULL,
    "action" "PayrollLockAction" NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_hash" TEXT,
    "reason" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_period_locks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_period_locks_seq_key" ON "payroll_period_locks"("seq");
CREATE INDEX "payroll_period_locks_cycle_start_cycle_end_seq_idx" ON "payroll_period_locks"("cycle_start", "cycle_end", "seq");
ALTER TABLE "payroll_period_locks" ADD CONSTRAINT "payroll_period_locks_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "payroll_run_releases" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" "PayrollReleaseKind" NOT NULL,
    "reference" TEXT,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_run_releases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_run_releases_run_id_kind_idx" ON "payroll_run_releases"("run_id", "kind");
ALTER TABLE "payroll_run_releases" ADD CONSTRAINT "payroll_run_releases_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── The run guard, tightened ─────────────────────────────────────────────────────────────────────────────────────────────────
-- Into FINALISED: only from APPROVED, only inside the finaliser's transaction (payroll.finalising), and only when the run's approval and its period approval have both been
--   consumed (the checker is never the maker: payroll_approvals already refuses that).
-- Out of FINALISED: only to VOID, only inside the unlock transaction (payroll.unlocking), only while nothing has been released against it, and nothing else about the run changes.
CREATE OR REPLACE FUNCTION payroll_runs_guard() RETURNS trigger AS $$
DECLARE
  finalising boolean := coalesce(current_setting('payroll.finalising', true), '') = 'yes';
  unlocking boolean := coalesce(current_setting('payroll.unlocking', true), '') = 'yes';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'FINALISED' THEN
      RAISE EXCEPTION 'RUN_FINALISE_FORBIDDEN: a run is created as a draft and becomes final only through the finaliser';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'RUN_NOT_DELETABLE: a payroll run is never deleted; discard a draft (void it)';
  END IF;
  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'RUN_VOID_IMMUTABLE: a discarded run is never changed';
  END IF;
  IF OLD.status = 'FINALISED' THEN
    IF NOT (unlocking AND NEW.status = 'VOID') THEN
      RAISE EXCEPTION 'RUN_FINALISED_IMMUTABLE: a finalised run is never changed, except by unlocking its period';
    END IF;
    IF EXISTS (SELECT 1 FROM payroll_run_releases WHERE run_id = OLD.id) THEN
      RAISE EXCEPTION 'RUN_RELEASED: payslips have been published or a bank file generated for this run, so its period cannot be unlocked';
    END IF;
    IF (to_jsonb(NEW) - 'status' - 'voided_at' - 'voided_by_user_id' - 'void_reason') <> (to_jsonb(OLD) - 'status' - 'voided_at' - 'voided_by_user_id' - 'void_reason') THEN
      RAISE EXCEPTION 'RUN_FINALISED_IMMUTABLE: unlocking voids a final run; it does not change its figures';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'FINALISED' THEN
    IF NOT finalising OR OLD.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'RUN_FINALISE_FORBIDDEN: a run becomes final only through the finaliser, from approved';
    END IF;
    IF (SELECT count(DISTINCT subject) FROM payroll_approvals WHERE subject_id = NEW.id AND subject IN ('RUN_APPROVAL', 'PERIOD_FINALISE') AND status = 'CONSUMED') <> 2 THEN
      RAISE EXCEPTION 'RUN_FINALISE_FORBIDDEN: the run and its period need a second person''s approval, both used, before it becomes final';
    END IF;
  END IF;
  IF NEW.cycle_start <> OLD.cycle_start OR NEW.cycle_end <> OLD.cycle_end OR NEW.created_by_user_id <> OLD.created_by_user_id THEN
    RAISE EXCEPTION 'RUN_IMMUTABLE: the cycle of a run never changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- A run waiting for a decision, or approved, has the figures that were looked at: its people and lines do not change.
CREATE OR REPLACE FUNCTION payroll_run_children_guard() RETURNS trigger AS $$
DECLARE
  rid text;
  st "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN rid := OLD.run_id; ELSE rid := NEW.run_id; END IF;
  SELECT status INTO st FROM payroll_runs WHERE id = rid;
  IF st IS NULL THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF; -- the run itself is already gone (a cascade)
  IF wellsure_test_purge_allowed() AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF st = 'FINALISED' THEN RAISE EXCEPTION 'RUN_FINALISED_IMMUTABLE: the figures of a finalised run are never changed'; END IF;
  IF st = 'VOID' THEN RAISE EXCEPTION 'RUN_VOID_IMMUTABLE: a discarded run is never changed'; END IF;
  IF st IN ('SUBMITTED', 'APPROVED') THEN RAISE EXCEPTION 'RUN_LOCKED_FOR_APPROVAL: a run that has been submitted for approval is not recalculated; reopen it first'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- ── Adjustments: consumed only by the finaliser, handed back only by the unlock ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION payroll_adjustments_guard() RETURNS trigger AS $$
DECLARE
  finalising boolean := coalesce(current_setting('payroll.finalising', true), '') = 'yes';
  unlocking boolean := coalesce(current_setting('payroll.unlocking', true), '') = 'yes';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: an adjustment is never deleted; cancel it';
  END IF;
  IF OLD.status = 'CONSUMED' AND unlocking AND NEW.status = 'PENDING' AND NEW.consumed_by_run_id IS NULL
     AND (to_jsonb(NEW) - 'status' - 'consumed_by_run_id') = (to_jsonb(OLD) - 'status' - 'consumed_by_run_id') THEN
    RETURN NEW; -- unlocking a period: what the run had paid is owed again
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: this adjustment is already % and cannot change', lower(OLD.status::text);
  END IF;
  IF NEW.status = 'CONSUMED' AND NOT finalising THEN
    RAISE EXCEPTION 'ADJUSTMENT_CONSUMED_BY_FINALISER_ONLY: an adjustment is marked paid only when a payroll run is finalised';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'consumed_by_run_id' - 'cancelled_at' - 'cancelled_by_user_id' - 'cancel_reason')
     = (to_jsonb(OLD) - 'status' - 'consumed_by_run_id' - 'cancelled_at' - 'cancelled_by_user_id' - 'cancel_reason') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: the amount, reason and employee of an adjustment never change; cancel it and add another';
END;
$$ LANGUAGE plpgsql;

-- ── The lock log: append-only; a cycle is finalised and unlocked in turn, never twice the same way running ──────────────────
ALTER TABLE "payroll_period_locks" ADD CONSTRAINT "payroll_period_locks_cycle_order" CHECK ("cycle_end" >= "cycle_start");
ALTER TABLE "payroll_period_locks" ADD CONSTRAINT "payroll_period_locks_finalise_hash" CHECK ("action" <> 'FINALISE' OR length(coalesce("run_hash", '')) > 0);
ALTER TABLE "payroll_period_locks" ADD CONSTRAINT "payroll_period_locks_unlock_reason" CHECK ("action" <> 'UNLOCK' OR length(btrim(coalesce("reason", ''))) >= 5);
CREATE OR REPLACE FUNCTION payroll_period_locks_guard() RETURNS trigger AS $$
DECLARE
  last_action "PayrollLockAction";
  last_run text;
  run_state "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'PERIOD_LOCK_APPEND_ONLY: the lock log is never changed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'PERIOD_LOCK_APPEND_ONLY: the lock log is never changed';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('payroll_period_locks:' || NEW.cycle_start::text || ':' || NEW.cycle_end::text));
  SELECT action, run_id INTO last_action, last_run FROM payroll_period_locks WHERE cycle_start = NEW.cycle_start AND cycle_end = NEW.cycle_end ORDER BY seq DESC LIMIT 1;
  SELECT status INTO run_state FROM payroll_runs WHERE id = NEW.run_id;
  IF NEW.action = 'FINALISE' THEN
    IF last_action = 'FINALISE' THEN RAISE EXCEPTION 'PERIOD_ALREADY_LOCKED: this payroll period is already finalised'; END IF;
    IF run_state IS DISTINCT FROM 'FINALISED' THEN RAISE EXCEPTION 'PERIOD_LOCK_NEEDS_FINAL_RUN: a period is locked by a finalised run'; END IF;
  ELSE
    IF last_action IS DISTINCT FROM 'FINALISE' THEN RAISE EXCEPTION 'PERIOD_NOT_LOCKED: this payroll period is not finalised, so there is nothing to unlock'; END IF;
    IF last_run <> NEW.run_id THEN RAISE EXCEPTION 'PERIOD_UNLOCK_WRONG_RUN: a period is unlocked through the run that locked it'; END IF;
    IF EXISTS (SELECT 1 FROM payroll_run_releases WHERE run_id = NEW.run_id) THEN
      RAISE EXCEPTION 'RUN_RELEASED: payslips have been published or a bank file generated for this run, so its period cannot be unlocked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_period_locks_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_period_locks" FOR EACH ROW EXECUTE FUNCTION payroll_period_locks_guard();

-- ── Releases: append-only, and only against a final run ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION payroll_run_releases_guard() RETURNS trigger AS $$
DECLARE run_state "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'RELEASE_APPEND_ONLY: a release is never removed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'RELEASE_APPEND_ONLY: a release is never changed';
  END IF;
  SELECT status INTO run_state FROM payroll_runs WHERE id = NEW.run_id FOR SHARE;
  IF run_state IS DISTINCT FROM 'FINALISED' THEN RAISE EXCEPTION 'RELEASE_NEEDS_FINAL_RUN: payslips and bank files come only from a finalised run'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_run_releases_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_run_releases" FOR EACH ROW EXECUTE FUNCTION payroll_run_releases_guard();

-- ── Neither log is ever emptied ─────────────────────────────────────────────────────────────────────────────────────────────
-- A truncate-blocking trigger is also what the Phase 1.5 role step looks for: the app role keeps INSERT and SELECT on these and loses everything else.
CREATE OR REPLACE FUNCTION payroll_logs_no_truncate() RETURNS trigger AS $$
BEGIN
  IF wellsure_test_purge_allowed() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'APPEND_ONLY: this log is never emptied';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_period_locks_no_truncate BEFORE TRUNCATE ON "payroll_period_locks" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
CREATE TRIGGER payroll_run_releases_no_truncate BEFORE TRUNCATE ON "payroll_run_releases" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
