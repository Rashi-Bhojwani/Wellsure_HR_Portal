-- D1 (docs/plans/DIRECTOR_AUTHORITY.md): director authority. The core only: nothing in the payroll flows uses it until D2.
--   1. approvals and confirmations record WHICH rule applied (a second director decided / one director acted on their own authority);
--   2. the database's two "a different person" backstops are rewritten to allow exactly that, and only for a Super Admin;
--   3. the notices a director's act sends to the other director (counts only), written with the act;
--   4. PAYROLL_ADMIN and PAYROLL_APPROVER can be given only to a Super Admin.

-- Pre-flight: on a database that was never seeded (staging, production) a payroll role held by someone who is not a Super Admin stops the migration, naming them,
-- so nobody mid-payroll loses access silently. A development database (it has the marker row) only gets a notice: the seed converts those accounts.
DO $$
DECLARE offenders TEXT;
BEGIN
  SELECT string_agg(DISTINCT e."employee_code", ', ') INTO offenders
  FROM "user_roles" ur
  JOIN "roles" r ON r."id" = ur."role_id" AND r."code" IN ('PAYROLL_ADMIN', 'PAYROLL_APPROVER')
  JOIN "users" u ON u."id" = ur."user_id"
  JOIN "employees" e ON e."id" = u."employee_id"
  WHERE NOT EXISTS (SELECT 1 FROM "user_roles" ur2 JOIN "roles" r2 ON r2."id" = ur2."role_id" WHERE ur2."user_id" = ur."user_id" AND r2."code" = 'SUPER_ADMIN');
  IF offenders IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM "dev_database_marker") THEN
      RAISE NOTICE 'D1: payroll roles held by non-directors (they will hold no permissions until converted): %', offenders;
    ELSE
      RAISE EXCEPTION 'D1_PAYROLL_ROLE_HOLDERS: these people hold a payroll role without being a Super Admin: %. Remove the role from them (or make them Super Admins) before migrating.', offenders;
    END IF;
  END IF;
END $$;

CREATE TYPE "ApprovalAuthority" AS ENUM ('SECOND_DIRECTOR', 'DIRECTOR_AUTHORITY');

-- ── 1 + 2. payroll_approvals ──────────────────────────────────────────

ALTER TABLE "payroll_approvals" ADD COLUMN "authority" "ApprovalAuthority" NOT NULL DEFAULT 'SECOND_DIRECTOR';

-- Never the maker -- unless this is a director acting on their own authority, in which case the maker IS the only actor.
ALTER TABLE "payroll_approvals" DROP CONSTRAINT "payroll_approvals_checker_not_maker";
ALTER TABLE "payroll_approvals" ADD CONSTRAINT "payroll_approvals_checker_not_maker"
  CHECK ("checker_user_id" IS NULL OR "checker_user_id" <> "maker_user_id" OR "authority" = 'DIRECTOR_AUTHORITY');
ALTER TABLE "payroll_approvals" ADD CONSTRAINT "payroll_approvals_authority_single_actor"
  CHECK ("authority" <> 'DIRECTOR_AUTHORITY' OR "checker_user_id" IS NULL OR "checker_user_id" = "maker_user_id");

-- Director authority is for a Super Admin and nobody else, whatever the code does.
CREATE OR REPLACE FUNCTION payroll_approvals_authority_guard() RETURNS trigger AS $$
BEGIN
  IF NEW."authority" = 'DIRECTOR_AUTHORITY' AND NOT EXISTS (
    SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."maker_user_id" AND r."code" = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'DIRECTOR_AUTHORITY_NOT_SUPER_ADMIN: only a Super Admin can act on director authority';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_approvals_authority_guard BEFORE INSERT ON "payroll_approvals" FOR EACH ROW EXECUTE FUNCTION payroll_approvals_authority_guard();

-- The authority an approval was made under never changes (the existing guard, plus the new column).
CREATE OR REPLACE FUNCTION payroll_approvals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END; END IF;
    RAISE EXCEPTION 'PAYROLL_APPROVAL_APPEND_ONLY: an approval is never deleted';
  END IF;
  -- What was submitted never changes.
  IF NEW.subject <> OLD.subject OR NEW.subject_id <> OLD.subject_id OR NEW.content_hash <> OLD.content_hash OR NEW.maker_user_id <> OLD.maker_user_id
     OR NEW.submitted_at <> OLD.submitted_at OR NEW.preview_fingerprint <> OLD.preview_fingerprint OR NEW.authority <> OLD.authority THEN
    RAISE EXCEPTION 'PAYROLL_APPROVAL_IMMUTABLE: what was submitted cannot be edited; submit again';
  END IF;
  -- Legal moves only: PENDING to APPROVED / REJECTED / VOIDED, APPROVED to CONSUMED / VOIDED. Nothing leaves REJECTED, VOIDED or CONSUMED.
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'VOIDED'))
    OR (OLD.status = 'APPROVED' AND NEW.status IN ('CONSUMED', 'VOIDED'))
  ) THEN
    RAISE EXCEPTION 'PAYROLL_APPROVAL_TRANSITION: % cannot become %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = OLD.status AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'PAYROLL_APPROVAL_IMMUTABLE: a decided approval is not edited';
  END IF;
  -- A decision, once made, is kept.
  IF OLD.checker_user_id IS NOT NULL AND (NEW.checker_user_id IS DISTINCT FROM OLD.checker_user_id OR NEW.decided_at IS DISTINCT FROM OLD.decided_at) THEN
    RAISE EXCEPTION 'PAYROLL_APPROVAL_IMMUTABLE: the decision is kept as it was made';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── payroll_item_confirmations ────────────────────────────────────────

ALTER TABLE "payroll_item_confirmations" ADD COLUMN "self_confirmed" BOOLEAN NOT NULL DEFAULT false;

-- The author may confirm their own value only as a Super Admin, and only when the row says so; and the row cannot say so for anyone else's value.
CREATE OR REPLACE FUNCTION payroll_item_confirmations_guard() RETURNS trigger AS $$
DECLARE v RECORD;
BEGIN
  SELECT value_hash, author_user_id INTO v FROM payroll_item_versions WHERE kind = NEW.kind AND key = NEW.key AND version = NEW.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_CONFIRM_NO_VERSION: there is no such version to confirm'; END IF;
  IF v.value_hash <> NEW.value_hash THEN RAISE EXCEPTION 'PAYROLL_CONFIRM_VALUE_MISMATCH: the confirmation does not match the value of that version'; END IF;
  IF v.author_user_id IS NOT NULL AND v.author_user_id = NEW.confirmed_by_user_id THEN
    IF NOT NEW.self_confirmed THEN
      RAISE EXCEPTION 'PAYROLL_CONFIRM_SAME_PERSON: the person who wrote a value cannot be the one who confirms it';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW.confirmed_by_user_id AND r."code" = 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'PAYROLL_CONFIRM_SELF_NOT_DIRECTOR: only a Super Admin can confirm a value they wrote, and only on director authority';
    END IF;
  ELSIF NEW.self_confirmed THEN
    RAISE EXCEPTION 'PAYROLL_CONFIRM_SELF_MISMATCH: a confirmation is marked self-confirmed but the confirmer did not write the value';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── 3. Notices ────────────────────────────────────────────────────────

CREATE TABLE "director_action_notices" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "subject_label" TEXT NOT NULL,
    "item_count" INTEGER,
    "actor_user_id" TEXT NOT NULL,
    "approval_id" TEXT,
    "authority" "ApprovalAuthority",
    "detail" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_action_notices_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "director_action_notices_created_at_idx" ON "director_action_notices"("created_at");

CREATE TABLE "director_action_receipts" (
    "id" TEXT NOT NULL,
    "notice_id" TEXT NOT NULL,
    "recipient_user_id" TEXT NOT NULL,
    "delivered_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),
    "failed_reason" TEXT,
    "seen_at" TIMESTAMPTZ(3),
    "acknowledged_at" TIMESTAMPTZ(3),
    "escalated_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "director_action_receipts_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "director_action_receipts_notice_id_recipient_user_id_key" ON "director_action_receipts"("notice_id", "recipient_user_id");
CREATE INDEX "director_action_receipts_recipient_user_id_acknowledged_at_idx" ON "director_action_receipts"("recipient_user_id", "acknowledged_at");
ALTER TABLE "director_action_receipts" ADD CONSTRAINT "director_action_receipts_notice_id_fkey" FOREIGN KEY ("notice_id") REFERENCES "director_action_notices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION director_action_notices_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'DIRECTOR_NOTICE_APPEND_ONLY: a notice of a director action is never changed or removed (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER director_action_notices_append_only BEFORE UPDATE OR DELETE ON "director_action_notices" FOR EACH ROW EXECUTE FUNCTION director_action_notices_append_only();
CREATE TRIGGER director_action_notices_no_truncate BEFORE TRUNCATE ON "director_action_notices" FOR EACH STATEMENT EXECUTE FUNCTION director_action_notices_append_only();

-- A receipt: each timestamp is filled in once and then kept; the identity columns never change.
CREATE OR REPLACE FUNCTION director_action_receipts_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'DIRECTOR_NOTICE_APPEND_ONLY: a receipt is never removed';
  END IF;
  IF NEW.id <> OLD.id OR NEW.notice_id <> OLD.notice_id OR NEW.recipient_user_id <> OLD.recipient_user_id OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'DIRECTOR_NOTICE_APPEND_ONLY: a receipt''s identity never changes';
  END IF;
  IF (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
     OR (OLD.emailed_at IS NOT NULL AND NEW.emailed_at IS DISTINCT FROM OLD.emailed_at)
     OR (OLD.seen_at IS NOT NULL AND NEW.seen_at IS DISTINCT FROM OLD.seen_at)
     OR (OLD.acknowledged_at IS NOT NULL AND NEW.acknowledged_at IS DISTINCT FROM OLD.acknowledged_at)
     OR (OLD.escalated_at IS NOT NULL AND NEW.escalated_at IS DISTINCT FROM OLD.escalated_at) THEN
    RAISE EXCEPTION 'DIRECTOR_NOTICE_APPEND_ONLY: what was recorded on a receipt is kept as it was';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER director_action_receipts_guard BEFORE UPDATE OR DELETE ON "director_action_receipts" FOR EACH ROW EXECUTE FUNCTION director_action_receipts_guard();
CREATE TRIGGER director_action_receipts_no_truncate BEFORE TRUNCATE ON "director_action_receipts" FOR EACH STATEMENT EXECUTE FUNCTION director_action_receipts_guard();

-- ── 4. The payroll roles are for directors only ───────────────────────
-- Refuses at the moment of assignment (the service says so in words first). Removing SUPER_ADMIN is not blocked here: lib/permissions.ts gives a PAYROLL_ role
-- held without SUPER_ADMIN no permissions at all, and the service removes the markers together with the Super Admin role.

CREATE OR REPLACE FUNCTION user_roles_payroll_directors_only() RETURNS trigger AS $$
DECLARE new_code TEXT;
BEGIN
  SELECT "code" INTO new_code FROM "roles" WHERE "id" = NEW."role_id";
  IF new_code IN ('PAYROLL_ADMIN', 'PAYROLL_APPROVER') AND NOT EXISTS (
    SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."user_id" AND r."code" = 'SUPER_ADMIN'
  ) THEN
    RAISE EXCEPTION 'PAYROLL_ROLE_DIRECTORS_ONLY: the payroll roles are held by directors (Super Admins) only';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_roles_payroll_directors_only BEFORE INSERT ON "user_roles" FOR EACH ROW EXECUTE FUNCTION user_roles_payroll_directors_only();

-- A per-user grant of a payroll key to anyone who is not a Super Admin (a Super Admin holds every key anyway).
CREATE OR REPLACE FUNCTION user_permission_overrides_payroll_directors_only() RETURNS trigger AS $$
DECLARE k TEXT;
BEGIN
  IF NEW."effect" = 'GRANT' THEN
    SELECT "key" INTO k FROM "permissions" WHERE "id" = NEW."permission_id";
    IF k LIKE 'payroll.%' AND NOT EXISTS (
      SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."user_id" AND r."code" = 'SUPER_ADMIN'
    ) THEN
      RAISE EXCEPTION 'PAYROLL_GRANT_DIRECTORS_ONLY: a payroll permission can be granted to a Super Admin only';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_permission_overrides_payroll_directors_only BEFORE INSERT ON "user_permission_overrides" FOR EACH ROW EXECUTE FUNCTION user_permission_overrides_payroll_directors_only();
