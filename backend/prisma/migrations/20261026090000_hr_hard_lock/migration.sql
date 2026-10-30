-- Stage 1 (docs/plans/HR_CAPABILITIES.md §1A): the HR hard lock. Pay data is never HR's.
-- lib/permissions.ts already strips these keys from every HR holder; this makes the database agree and refuses the rows coming back.

-- The rows removed below are copied first, so the removal can be reversed by a forward migration. Append-only.
CREATE TABLE "role_permission_removals" (
    "id" TEXT NOT NULL,
    "role_code" TEXT NOT NULL,
    "permission_key" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "removed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "role_permission_removals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "role_permission_removals_role_code_idx" ON "role_permission_removals"("role_code");

CREATE OR REPLACE FUNCTION role_permission_removals_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ROLE_PERMISSION_REMOVALS_APPEND_ONLY: this record is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER role_permission_removals_append_only BEFORE UPDATE OR DELETE ON "role_permission_removals" FOR EACH ROW EXECUTE FUNCTION role_permission_removals_append_only();
CREATE TRIGGER role_permission_removals_no_truncate BEFORE TRUNCATE ON "role_permission_removals" FOR EACH STATEMENT EXECUTE FUNCTION role_permission_removals_append_only();

-- The locked keys: every payroll.* key, the salary-derived reports and PAY documents (shared/constants/sensitiveData.ts HR_FORBIDDEN_KEYS).
CREATE OR REPLACE FUNCTION is_hr_forbidden_key(k TEXT) RETURNS boolean AS $$
  SELECT k LIKE 'payroll.%' OR k IN ('reports.salary.view', 'reports.liability.view', 'documents.pay.view');
$$ LANGUAGE sql IMMUTABLE;

-- Copy, then remove, what the two HR system roles hold today.
INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key"), r."code", p."key", 'HR hard lock (Stage 1): pay data is never HR''s'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE') AND is_hr_forbidden_key(p."key");

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id"
  AND r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE') AND is_hr_forbidden_key(p."key");

-- A pay key can no longer be put on an HR system role...
CREATE OR REPLACE FUNCTION role_permissions_hr_hard_lock() RETURNS trigger AS $$
DECLARE role_code TEXT; k TEXT;
BEGIN
  SELECT "code" INTO role_code FROM "roles" WHERE "id" = NEW."role_id";
  IF role_code IN ('HR_ADMIN', 'HR_EXECUTIVE') THEN
    SELECT "key" INTO k FROM "permissions" WHERE "id" = NEW."permission_id";
    IF is_hr_forbidden_key(k) THEN
      RAISE EXCEPTION 'HR_HARD_LOCK: % is pay data and cannot be given to an HR role', k;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER role_permissions_hr_hard_lock BEFORE INSERT ON "role_permissions" FOR EACH ROW EXECUTE FUNCTION role_permissions_hr_hard_lock();

-- ...nor granted to a person who holds one (a director who is also HR is exempt: they hold every key anyway).
CREATE OR REPLACE FUNCTION user_permission_overrides_hr_hard_lock() RETURNS trigger AS $$
DECLARE k TEXT;
BEGIN
  IF NEW."effect" = 'GRANT' THEN
    SELECT "key" INTO k FROM "permissions" WHERE "id" = NEW."permission_id";
    IF is_hr_forbidden_key(k)
       AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."user_id" AND r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE'))
       AND NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."user_id" AND r."code" = 'SUPER_ADMIN') THEN
      RAISE EXCEPTION 'HR_HARD_LOCK: % is pay data and cannot be granted to someone who holds an HR role', k;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER user_permission_overrides_hr_hard_lock BEFORE INSERT ON "user_permission_overrides" FOR EACH ROW EXECUTE FUNCTION user_permission_overrides_hr_hard_lock();
