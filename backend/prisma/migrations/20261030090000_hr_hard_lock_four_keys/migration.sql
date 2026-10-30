-- After Checkpoint 1: the HR hard lock grows by four keys: user.security.manage, import.manage, letters.generate, leave.yearend.manage.
-- What is removed is copied first into the append-only role_permission_removals (a person's own grant is recorded as USER_OVERRIDE:<user id>).

CREATE OR REPLACE FUNCTION is_hr_forbidden_key(k TEXT) RETURNS boolean AS $$
  SELECT k LIKE 'payroll.%' OR k IN (
    'reports.salary.view', 'reports.liability.view', 'documents.pay.view',
    'role.view', 'audit.view', 'settings.manage', 'delegation.manage',
    'user.security.manage', 'import.manage', 'letters.generate', 'leave.yearend.manage'
  );
$$ LANGUAGE sql IMMUTABLE;

INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key"), r."code", p."key", 'HR hard lock, four more keys (after Checkpoint 1)'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE') AND p."key" IN ('user.security.manage', 'import.manage', 'letters.generate', 'leave.yearend.manage')
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id"
  AND r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE') AND p."key" IN ('user.security.manage', 'import.manage', 'letters.generate', 'leave.yearend.manage');

-- Grants to a person who holds an HR role and is not a director: copied, then removed.
INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5('USER_OVERRIDE:' || o."user_id" || ':' || p."key"), 'USER_OVERRIDE:' || o."user_id", p."key", 'HR hard lock, four more keys (after Checkpoint 1): a personal grant'
FROM "user_permission_overrides" o
JOIN "permissions" p ON p."id" = o."permission_id"
WHERE o."effect" = 'GRANT' AND p."key" IN ('user.security.manage', 'import.manage', 'letters.generate', 'leave.yearend.manage')
  AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE'))
  AND NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" = 'SUPER_ADMIN')
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "user_permission_overrides" o
USING "permissions" p
WHERE p."id" = o."permission_id" AND o."effect" = 'GRANT' AND p."key" IN ('user.security.manage', 'import.manage', 'letters.generate', 'leave.yearend.manage')
  AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" IN ('HR_ADMIN', 'HR_EXECUTIVE'))
  AND NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" = 'SUPER_ADMIN');
