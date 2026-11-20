-- FIX-C2 (independent audit 2026-11-20): one director alone could make anyone a Super Admin, or remove the other director's role. Now every such change is a
-- proposal (modules/access/directorChanges.ts) that another director confirms, and the database refuses a Super Admin role row added or removed outside it.
CREATE TYPE "DirectorChangeAction" AS ENUM ('GRANT_SUPER_ADMIN', 'REVOKE_SUPER_ADMIN', 'ASSIGN_ROLE', 'REMOVE_ROLE', 'SUSPEND');
CREATE TYPE "DirectorChangeStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED');

CREATE TABLE "director_role_changes" (
    "id" TEXT NOT NULL,
    "action" "DirectorChangeAction" NOT NULL,
    "status" "DirectorChangeStatus" NOT NULL DEFAULT 'PENDING',
    "target_user_id" TEXT NOT NULL,
    "role_code" TEXT,
    "reason" TEXT NOT NULL,
    "third_director_acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "proposed_by_user_id" TEXT NOT NULL,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_by_user_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    CONSTRAINT "director_role_changes_pkey" PRIMARY KEY ("id"),
    -- Applied only with at least one confirmation, and never one by the proposer.
    CONSTRAINT "director_role_changes_confirmed_by_other" CHECK (NOT ("proposed_by_user_id" = ANY ("confirmed_by_user_ids"))),
    CONSTRAINT "director_role_changes_applied_confirmed" CHECK ("status" <> 'APPLIED' OR cardinality("confirmed_by_user_ids") >= 1)
);
CREATE INDEX "director_role_changes_status_proposed_at_idx" ON "director_role_changes"("status", "proposed_at");

-- The change record: decided once (PENDING -> APPLIED or REJECTED), confirmations only added while PENDING, never deleted (except the test purge).
CREATE OR REPLACE FUNCTION director_role_changes_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'DIRECTOR_CHANGE_APPEND_ONLY: a director role change is never deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN RAISE EXCEPTION 'DIRECTOR_CHANGE_APPEND_ONLY: a director role change is never deleted'; END IF;
  IF OLD."status" <> 'PENDING'
     OR NEW."id" <> OLD."id" OR NEW."action" <> OLD."action" OR NEW."target_user_id" <> OLD."target_user_id" OR NEW."role_code" IS DISTINCT FROM OLD."role_code"
     OR NEW."reason" <> OLD."reason" OR NEW."third_director_acknowledged" <> OLD."third_director_acknowledged" OR NEW."proposed_by_user_id" <> OLD."proposed_by_user_id"
     OR NEW."proposed_at" <> OLD."proposed_at" OR NOT (OLD."confirmed_by_user_ids" <@ NEW."confirmed_by_user_ids") THEN
    RAISE EXCEPTION 'DIRECTOR_CHANGE_DECIDED_ONCE: a director role change is decided once and its confirmations are only added';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER director_role_changes_guard BEFORE UPDATE OR DELETE ON "director_role_changes" FOR EACH ROW EXECUTE FUNCTION director_role_changes_guard();
CREATE TRIGGER director_role_changes_no_truncate BEFORE TRUNCATE ON "director_role_changes" FOR EACH STATEMENT EXECUTE FUNCTION director_role_changes_guard();

-- A Super Admin role row is added or removed only (1) by the confirmation that applies a director change, which names its APPLIED change in the
-- transaction (app.director_change); (2) by the first-director bootstrap CLI while no active Super Admin exists (app.director_bootstrap); or (3) in a
-- database the development seed marked, for fixture rows that record no assigner (every application path records its actor) and for the test purge.
-- Named to sort after user_roles_protect_last_super_admin, so "never the last Super Admin" is still the reply for the last one.
CREATE OR REPLACE FUNCTION user_roles_director_change_guard() RETURNS trigger AS $$
DECLARE
  rid TEXT;
  uid TEXT;
  change_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN rid := OLD."role_id"; uid := OLD."user_id"; ELSE rid := NEW."role_id"; uid := NEW."user_id"; END IF;
  IF TG_OP = 'UPDATE' AND NEW."role_id" = OLD."role_id" AND NEW."user_id" = OLD."user_id" THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "roles" WHERE "id" = rid AND "code" = 'SUPER_ADMIN')
     AND NOT (TG_OP = 'UPDATE' AND EXISTS (SELECT 1 FROM "roles" WHERE "id" = OLD."role_id" AND "code" = 'SUPER_ADMIN')) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'DIRECTOR_CHANGE_NEEDS_CONFIRMATION: a Super Admin role row is never moved to another person or role'; END IF;
  change_id := NULLIF(current_setting('app.director_change', true), '');
  IF change_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM "director_role_changes" c
    WHERE c."id" = change_id AND c."status" = 'APPLIED' AND c."target_user_id" = uid
      AND c."action" = (CASE WHEN TG_OP = 'DELETE' THEN 'REVOKE_SUPER_ADMIN' ELSE 'GRANT_SUPER_ADMIN' END)::"DirectorChangeAction"
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'INSERT' AND current_setting('app.director_bootstrap', true) = 'on' AND NOT EXISTS (
    SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" JOIN "users" u ON u."id" = ur."user_id" WHERE r."code" = 'SUPER_ADMIN' AND u."status" = 'ACTIVE'
  ) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM "dev_database_marker") AND (
    (TG_OP = 'INSERT' AND NEW."assigned_by_user_id" IS NULL) OR (TG_OP = 'DELETE' AND current_setting('app.audit_purge', true) = 'test')
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'DIRECTOR_CHANGE_NEEDS_CONFIRMATION: making or removing a director needs one director to propose and the other to confirm';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_roles_zz_director_change_guard BEFORE INSERT OR UPDATE OR DELETE ON "user_roles" FOR EACH ROW EXECUTE FUNCTION user_roles_director_change_guard();
