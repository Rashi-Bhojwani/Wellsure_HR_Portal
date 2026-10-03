-- Phase 5 commit F — Core reports permissions.
--
-- reports.view: HR_EXECUTIVE (and so HR_ADMIN), PAYROLL_ADMIN and MANAGER
-- (manager-grantable — every report is scope-filtered; spec §2.2).
-- reports.liability.view: HR_ADMIN and PAYROLL_ADMIN only — leave liability
-- becomes salary-derived in Phase 6, and salary stays off HR_EXECUTIVE and
-- managers (spec §2, §2.2). Applied here once because ensureAccessCatalog()
-- never edits an existing role.

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('reports.view', 'Reports'),
  ('reports.liability.view', 'Leave liability report')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = k.key);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'reports.view'
WHERE r."code" IN ('HR_EXECUTIVE', 'HR_ADMIN', 'PAYROLL_ADMIN', 'MANAGER')
ON CONFLICT DO NOTHING;

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" = 'reports.liability.view'
WHERE r."code" IN ('HR_ADMIN', 'PAYROLL_ADMIN')
ON CONFLICT DO NOTHING;
