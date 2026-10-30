-- Peeps module 1: the asset register (docs/plans/PEEPS_PLAN.md §B.2). Additive only: new tables, three new permission keys granted to the HR roles
-- that exist, and the database guards. No preloaded categories, statuses or conditions: the owners enter and confirm them.

-- CreateEnum
CREATE TYPE "AssetSettingKind" AS ENUM ('CATEGORIES', 'STATUSES', 'CONDITIONS');

-- CreateEnum
CREATE TYPE "AssetAssignmentEndReason" AS ENUM ('RETURNED', 'TRANSFERRED', 'LOST');

-- CreateEnum
CREATE TYPE "AssetEventKind" AS ENUM ('CREATED', 'EDITED', 'ISSUED', 'ACKNOWLEDGED', 'RETURNED', 'TRANSFERRED', 'LOST', 'DAMAGED');

-- CreateTable
CREATE TABLE "asset_setting_versions" (
    "id" TEXT NOT NULL,
    "kind" "AssetSettingKind" NOT NULL,
    "version" INTEGER NOT NULL,
    "value" JSONB NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "entered_by_user_id" TEXT NOT NULL,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_setting_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_setting_confirmations" (
    "id" TEXT NOT NULL,
    "version_id" TEXT NOT NULL,
    "confirmed_by_user_id" TEXT NOT NULL,
    "confirmed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "asset_setting_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "category_code" TEXT NOT NULL,
    "status_code" TEXT NOT NULL,
    "serial_number" TEXT,
    "model" TEXT,
    "notes" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_assignments" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "issued_by_user_id" TEXT NOT NULL,
    "issue_condition_code" TEXT NOT NULL,
    "issue_note" TEXT,
    "acknowledged_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "ended_by_user_id" TEXT,
    "end_reason" "AssetAssignmentEndReason",
    "return_condition_code" TEXT,
    "end_note" TEXT,

    CONSTRAINT "asset_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_events" (
    "id" TEXT NOT NULL,
    "asset_id" TEXT NOT NULL,
    "kind" "AssetEventKind" NOT NULL,
    "assignment_id" TEXT,
    "employee_id" TEXT,
    "condition_code" TEXT,
    "status_code" TEXT,
    "note" TEXT,
    "details" JSONB,
    "actor_user_id" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asset_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "asset_setting_versions_kind_version_key" ON "asset_setting_versions"("kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "asset_setting_confirmations_version_id_key" ON "asset_setting_confirmations"("version_id");

-- CreateIndex
CREATE UNIQUE INDEX "assets_number_key" ON "assets"("number");

-- CreateIndex
CREATE INDEX "assets_category_code_idx" ON "assets"("category_code");

-- CreateIndex
CREATE INDEX "assets_status_code_idx" ON "assets"("status_code");

-- CreateIndex
CREATE INDEX "asset_assignments_asset_id_idx" ON "asset_assignments"("asset_id");

-- CreateIndex
CREATE INDEX "asset_assignments_employee_id_idx" ON "asset_assignments"("employee_id");

-- CreateIndex
CREATE INDEX "asset_events_asset_id_at_idx" ON "asset_events"("asset_id", "at");

-- CreateIndex
CREATE INDEX "asset_events_employee_id_idx" ON "asset_events"("employee_id");

-- AddForeignKey
ALTER TABLE "asset_setting_confirmations" ADD CONSTRAINT "asset_setting_confirmations_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "asset_setting_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_events" ADD CONSTRAINT "asset_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Guards Prisma cannot express ─────────────────────────────────────────

-- An asset has at most one open assignment, whatever the code does (the service also locks the asset row).
CREATE UNIQUE INDEX "asset_assignments_one_open" ON "asset_assignments" ("asset_id") WHERE "ended_at" IS NULL;

-- A closed assignment says when, by whom and why; an open one says none of these. A return records the condition; a transfer or a loss does not have to.
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_end_complete" CHECK (
  ("ended_at" IS NULL AND "ended_by_user_id" IS NULL AND "end_reason" IS NULL AND "return_condition_code" IS NULL AND "end_note" IS NULL)
  OR ("ended_at" IS NOT NULL AND "ended_by_user_id" IS NOT NULL AND "end_reason" IS NOT NULL AND ("end_reason" <> 'RETURNED' OR "return_condition_code" IS NOT NULL))
);
ALTER TABLE "asset_assignments" ADD CONSTRAINT "asset_assignments_end_after_issue" CHECK ("ended_at" IS NULL OR "ended_at" >= "issued_at");
ALTER TABLE "asset_setting_versions" ADD CONSTRAINT "asset_setting_versions_value_is_list" CHECK (jsonb_typeof("value") = 'array');
ALTER TABLE "asset_setting_versions" ADD CONSTRAINT "asset_setting_versions_version_positive" CHECK ("version" >= 1);

-- Append-only: setting versions, confirmations and the event log are never changed or deleted (a test database may purge its own fixtures).
CREATE OR REPLACE FUNCTION peeps_assets_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ASSETS_APPEND_ONLY: % rows are never changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asset_setting_versions_append_only BEFORE UPDATE OR DELETE ON "asset_setting_versions" FOR EACH ROW EXECUTE FUNCTION peeps_assets_append_only();
CREATE TRIGGER asset_setting_versions_no_truncate BEFORE TRUNCATE ON "asset_setting_versions" FOR EACH STATEMENT EXECUTE FUNCTION peeps_assets_append_only();
CREATE TRIGGER asset_setting_confirmations_append_only BEFORE UPDATE OR DELETE ON "asset_setting_confirmations" FOR EACH ROW EXECUTE FUNCTION peeps_assets_append_only();
CREATE TRIGGER asset_setting_confirmations_no_truncate BEFORE TRUNCATE ON "asset_setting_confirmations" FOR EACH STATEMENT EXECUTE FUNCTION peeps_assets_append_only();
CREATE TRIGGER asset_events_append_only BEFORE UPDATE OR DELETE ON "asset_events" FOR EACH ROW EXECUTE FUNCTION peeps_assets_append_only();
CREATE TRIGGER asset_events_no_truncate BEFORE TRUNCATE ON "asset_events" FOR EACH STATEMENT EXECUTE FUNCTION peeps_assets_append_only();

-- A setting is confirmed by a director who did not enter it.
CREATE OR REPLACE FUNCTION asset_setting_confirmations_checker() RETURNS trigger AS $$
DECLARE entered_by TEXT;
BEGIN
  SELECT v."entered_by_user_id" INTO entered_by FROM "asset_setting_versions" v WHERE v."id" = NEW."version_id";
  IF entered_by = NEW."confirmed_by_user_id" THEN
    RAISE EXCEPTION 'ASSET_SETTING_SAME_PERSON: the person who entered a setting cannot confirm it';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."confirmed_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'ASSET_SETTING_DIRECTORS_ONLY: only a director confirms an asset setting';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asset_setting_confirmations_checker BEFORE INSERT ON "asset_setting_confirmations" FOR EACH ROW EXECUTE FUNCTION asset_setting_confirmations_checker();

-- Assignment history: never deleted; the only changes are closing an open row once, and the holder acknowledging it once. Everything else stays as issued.
CREATE OR REPLACE FUNCTION asset_assignments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ASSET_ASSIGNMENTS_APPEND_ONLY: assignment history is never deleted';
  END IF;
  IF TG_OP = 'TRUNCATE' THEN
    RAISE EXCEPTION 'ASSET_ASSIGNMENTS_APPEND_ONLY: assignment history is never deleted';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."asset_id" IS DISTINCT FROM OLD."asset_id" OR NEW."employee_id" IS DISTINCT FROM OLD."employee_id"
     OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at" OR NEW."issued_by_user_id" IS DISTINCT FROM OLD."issued_by_user_id"
     OR NEW."issue_condition_code" IS DISTINCT FROM OLD."issue_condition_code" OR NEW."issue_note" IS DISTINCT FROM OLD."issue_note" THEN
    RAISE EXCEPTION 'ASSET_ASSIGNMENTS_APPEND_ONLY: what was issued, to whom and when is never changed';
  END IF;
  IF OLD."acknowledged_at" IS NOT NULL AND NEW."acknowledged_at" IS DISTINCT FROM OLD."acknowledged_at" THEN
    RAISE EXCEPTION 'ASSET_ASSIGNMENTS_APPEND_ONLY: an acknowledgement is recorded once';
  END IF;
  IF OLD."ended_at" IS NOT NULL AND (NEW."ended_at" IS DISTINCT FROM OLD."ended_at" OR NEW."ended_by_user_id" IS DISTINCT FROM OLD."ended_by_user_id"
     OR NEW."end_reason" IS DISTINCT FROM OLD."end_reason" OR NEW."return_condition_code" IS DISTINCT FROM OLD."return_condition_code" OR NEW."end_note" IS DISTINCT FROM OLD."end_note") THEN
    RAISE EXCEPTION 'ASSET_ASSIGNMENTS_APPEND_ONLY: a closed assignment is never reopened or changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER asset_assignments_guard BEFORE UPDATE OR DELETE ON "asset_assignments" FOR EACH ROW EXECUTE FUNCTION asset_assignments_guard();
CREATE TRIGGER asset_assignments_no_truncate BEFORE TRUNCATE ON "asset_assignments" FOR EACH STATEMENT EXECUTE FUNCTION asset_assignments_guard();

-- A register entry is edited (name, notes, status) but never deleted: its history hangs off it.
CREATE OR REPLACE FUNCTION assets_no_delete() RETURNS trigger AS $$
BEGIN
  IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ASSETS_NO_DELETE: a register entry is never deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER assets_no_delete BEFORE DELETE ON "assets" FOR EACH ROW EXECUTE FUNCTION assets_no_delete();

-- ── Permissions ──────────────────────────────────────────────────────────
-- New keys; existing HR roles get the defaults that lib/systemRoles.ts gives a new database (HR Executive: view and manage the register; HR Admin also
-- prepares the setting lists). Confirming a setting has no key: the service and the trigger above require a director.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('assets.view', 'View the asset register'),
  ('assets.manage', 'Manage the asset register'),
  ('assets.settings.manage', 'Prepare asset categories, statuses and conditions')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key IN ('assets.view', 'assets.manage')
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'assets.settings.manage'
WHERE r.code = 'HR_ADMIN'
ON CONFLICT DO NOTHING;
