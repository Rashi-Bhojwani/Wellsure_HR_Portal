-- Phase 6 commit P6-1 (docs/plans/PHASE_6.md §3, §6, §12): payroll's foundations.
--   payroll_item_versions       every version of every governed item (rule, component, structure, bank layout, output layout), append-only
--   payroll_item_confirmations  who vouched for which version and value, and when, append-only; never by the version's own author
--   payroll_approvals           the maker-checker core: one small purpose-built piece, seven subjects
--   payroll_events              every state change with its actor and hash, append-only
-- Actor columns are plain text, not foreign keys (as for audit_logs and the period locks): nothing that happens to a user can alter these rows.

CREATE TYPE "PayrollItemKind" AS ENUM ('RULE', 'COMPONENT', 'STRUCTURE', 'BANK_TEMPLATE', 'OUTPUT_TEMPLATE');
CREATE TYPE "PayrollApprovalSubject" AS ENUM ('RUN_APPROVAL', 'PERIOD_FINALISE', 'PAYSLIP_PUBLISH', 'BANK_FILE', 'PERIOD_UNLOCK', 'RULE_CONFIRM', 'SALARY_REVISION');
CREATE TYPE "PayrollApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'VOIDED', 'CONSUMED');

-- ── Governed item versions ───────────────────────────────────────────────
CREATE TABLE "payroll_item_versions" (
    "id" TEXT NOT NULL,
    "kind" "PayrollItemKind" NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "value_hash" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "author_user_id" TEXT, -- null = the shipped placeholder (System)
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_item_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_item_versions_kind_key_version_key" ON "payroll_item_versions"("kind", "key", "version");
ALTER TABLE "payroll_item_versions" ADD CONSTRAINT "payroll_item_versions_version_positive" CHECK ("version" >= 1);

CREATE OR REPLACE FUNCTION payroll_item_versions_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'TRUNCATE' AND wellsure_test_purge_allowed() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'PAYROLL_VERSION_APPEND_ONLY: a version of a payroll rule, component, structure or template is never changed or deleted; edit it to add the next version';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_item_versions_append_only BEFORE UPDATE OR DELETE ON "payroll_item_versions" FOR EACH ROW EXECUTE FUNCTION payroll_item_versions_append_only();
CREATE TRIGGER payroll_item_versions_no_truncate BEFORE TRUNCATE ON "payroll_item_versions" FOR EACH STATEMENT EXECUTE FUNCTION payroll_item_versions_append_only();

-- ── Confirmations ────────────────────────────────────────────────────────
CREATE TABLE "payroll_item_confirmations" (
    "id" TEXT NOT NULL,
    "kind" "PayrollItemKind" NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value_hash" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',
    "approval_id" TEXT,

    CONSTRAINT "payroll_item_confirmations_pkey" PRIMARY KEY ("id")
);
-- A version is Confirmed once: one row per version.
CREATE UNIQUE INDEX "payroll_item_confirmations_kind_key_version_key" ON "payroll_item_confirmations"("kind", "key", "version");

-- The database's own backstop for "a different person must confirm": the confirmation must name a real version, vouch for exactly its
-- value, and come from somebody other than the version's author. (The service checks all of it first; this is for anything that bypasses it.)
CREATE OR REPLACE FUNCTION payroll_item_confirmations_guard() RETURNS trigger AS $$
DECLARE v RECORD;
BEGIN
  SELECT value_hash, author_user_id INTO v FROM payroll_item_versions WHERE kind = NEW.kind AND key = NEW.key AND version = NEW.version;
  IF NOT FOUND THEN RAISE EXCEPTION 'PAYROLL_CONFIRM_NO_VERSION: there is no such version to confirm'; END IF;
  IF v.value_hash <> NEW.value_hash THEN RAISE EXCEPTION 'PAYROLL_CONFIRM_VALUE_MISMATCH: the confirmation does not match the value of that version'; END IF;
  IF v.author_user_id IS NOT NULL AND v.author_user_id = NEW.confirmed_by_user_id THEN
    RAISE EXCEPTION 'PAYROLL_CONFIRM_SAME_PERSON: the person who wrote a value cannot be the one who confirms it';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_item_confirmations_guard BEFORE INSERT ON "payroll_item_confirmations" FOR EACH ROW EXECUTE FUNCTION payroll_item_confirmations_guard();

CREATE OR REPLACE FUNCTION payroll_item_confirmations_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'TRUNCATE' AND wellsure_test_purge_allowed() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'PAYROLL_CONFIRMATION_APPEND_ONLY: a confirmation is never changed or deleted; edit the value to start again';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_item_confirmations_append_only BEFORE UPDATE OR DELETE ON "payroll_item_confirmations" FOR EACH ROW EXECUTE FUNCTION payroll_item_confirmations_append_only();
CREATE TRIGGER payroll_item_confirmations_no_truncate BEFORE TRUNCATE ON "payroll_item_confirmations" FOR EACH STATEMENT EXECUTE FUNCTION payroll_item_confirmations_append_only();

-- ── Approvals (maker-checker) ────────────────────────────────────────────
CREATE TABLE "payroll_approvals" (
    "id" TEXT NOT NULL,
    "subject" "PayrollApprovalSubject" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "status" "PayrollApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "content_hash" TEXT NOT NULL,
    "maker_user_id" TEXT NOT NULL,
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submit_note" TEXT NOT NULL DEFAULT '',
    "preview_fingerprint" TEXT NOT NULL,
    "checker_user_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "decision_note" TEXT,
    "hash_at_decision" TEXT,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" TEXT,
    "consumed_at" TIMESTAMPTZ(3),
    "consumed_by_user_id" TEXT,

    CONSTRAINT "payroll_approvals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_approvals_subject_subject_id_idx" ON "payroll_approvals"("subject", "subject_id");
-- At most one live approval per thing: a second submission must wait for the first to be decided, voided or consumed.
CREATE UNIQUE INDEX "payroll_approvals_one_live" ON "payroll_approvals"("subject", "subject_id") WHERE "status" IN ('PENDING', 'APPROVED');
-- Never the maker, whatever the code does.
ALTER TABLE "payroll_approvals" ADD CONSTRAINT "payroll_approvals_checker_not_maker" CHECK ("checker_user_id" IS NULL OR "checker_user_id" <> "maker_user_id");
-- A rejection always says why; a void always says why.
ALTER TABLE "payroll_approvals" ADD CONSTRAINT "payroll_approvals_reject_reason" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3);
ALTER TABLE "payroll_approvals" ADD CONSTRAINT "payroll_approvals_void_reason" CHECK ("status" <> 'VOIDED' OR length(btrim(coalesce("void_reason", ''))) >= 3);
-- An approval records the hash the checker saw, and that it matched at the moment of the decision.
ALTER TABLE "payroll_approvals" ADD CONSTRAINT "payroll_approvals_approved_hash" CHECK ("status" NOT IN ('APPROVED', 'CONSUMED') OR "hash_at_decision" = "content_hash");

CREATE OR REPLACE FUNCTION payroll_approvals_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' OR TG_OP = 'TRUNCATE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NULL END; END IF;
    RAISE EXCEPTION 'PAYROLL_APPROVAL_APPEND_ONLY: an approval is never deleted';
  END IF;
  -- What was submitted never changes.
  IF NEW.subject <> OLD.subject OR NEW.subject_id <> OLD.subject_id OR NEW.content_hash <> OLD.content_hash OR NEW.maker_user_id <> OLD.maker_user_id
     OR NEW.submitted_at <> OLD.submitted_at OR NEW.preview_fingerprint <> OLD.preview_fingerprint THEN
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
CREATE TRIGGER payroll_approvals_guard BEFORE UPDATE OR DELETE ON "payroll_approvals" FOR EACH ROW EXECUTE FUNCTION payroll_approvals_guard();
CREATE TRIGGER payroll_approvals_no_truncate BEFORE TRUNCATE ON "payroll_approvals" FOR EACH STATEMENT EXECUTE FUNCTION payroll_approvals_guard();

-- ── Events ───────────────────────────────────────────────────────────────
CREATE TABLE "payroll_events" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "subject_type" TEXT NOT NULL,
    "subject_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "payroll_events_seq_key" ON "payroll_events"("seq");
CREATE INDEX "payroll_events_subject_type_subject_id_seq_idx" ON "payroll_events"("subject_type", "subject_id", "seq");

CREATE OR REPLACE FUNCTION payroll_events_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'TRUNCATE' AND wellsure_test_purge_allowed() THEN RETURN NULL; END IF;
  RAISE EXCEPTION 'PAYROLL_EVENT_APPEND_ONLY: the payroll event record is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_events_append_only BEFORE UPDATE OR DELETE ON "payroll_events" FOR EACH ROW EXECUTE FUNCTION payroll_events_append_only();
CREATE TRIGGER payroll_events_no_truncate BEFORE TRUNCATE ON "payroll_events" FOR EACH STATEMENT EXECUTE FUNCTION payroll_events_append_only();

-- ── Permissions ──────────────────────────────────────────────────────────
-- None of these is manager-grantable (shared/constants/permissions.ts; a test fails if one ever is). Super Admin holds every key in code.
-- payroll.unlock is Super Admin only: no role row. There is deliberately no audit permission: the Payroll audit trail uses payroll.salary.view.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('payroll.rules.view', 'View payroll rules and setup'),
  ('payroll.rules.manage', 'Edit payroll rules, components, structures and templates'),
  ('payroll.rules.confirm', 'Confirm payroll rules (a different person from the one who edited them)'),
  ('payroll.salary.view', 'View salary, payroll runs and the payroll audit trail'),
  ('payroll.salary.edit', 'Prepare salary revisions'),
  ('payroll.adjust', 'Add payroll adjustments'),
  ('payroll.run', 'Prepare, calculate and submit payroll runs (maker)'),
  ('payroll.approve', 'Approve or reject payroll actions (checker)'),
  ('payroll.unlock', 'Unlock a finalised payroll period (Super Admin only)'),
  ('payroll.payslip.view', 'View any employee''s payslip'),
  ('payroll.bank.view', 'View bank transfer batches'),
  ('reports.salary.view', 'Salary and statutory reports')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

-- Existing databases: the maker set for Payroll Admin, view and prepare-revisions for HR Admin. (New databases get the same from lib/systemRoles.ts.)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('payroll.rules.view', 'payroll.rules.manage', 'payroll.salary.view', 'payroll.salary.edit', 'payroll.adjust', 'payroll.run', 'payroll.payslip.view', 'payroll.bank.view', 'reports.salary.view')
WHERE r.code = 'PAYROLL_ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('payroll.rules.view', 'payroll.salary.view', 'payroll.salary.edit')
WHERE r.code = 'HR_ADMIN'
ON CONFLICT DO NOTHING;
