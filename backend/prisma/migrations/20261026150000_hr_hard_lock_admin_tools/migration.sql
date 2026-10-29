-- Stage 1 (docs/plans/HR_CAPABILITIES.md §1A): Admin Tools are the directors' too. The hard lock grows by four keys: role.view, audit.view, settings.manage, delegation.manage.
-- The rows removed are copied first into the append-only role_permission_removals, exactly as in the previous migration.

CREATE OR REPLACE FUNCTION is_hr_forbidden_key(k TEXT) RETURNS boolean AS $$
  SELECT k LIKE 'payroll.%' OR k IN ('reports.salary.view', 'reports.liability.view', 'documents.pay.view', 'role.view', 'audit.view', 'settings.manage', 'delegation.manage');
$$ LANGUAGE sql IMMUTABLE;

INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key"), r."code", p."key", 'HR hard lock, Admin Tools (Stage 1): these are the directors'' own'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE') AND p."key" IN ('role.view', 'audit.view', 'settings.manage', 'delegation.manage')
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id"
  AND r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE') AND p."key" IN ('role.view', 'audit.view', 'settings.manage', 'delegation.manage');
