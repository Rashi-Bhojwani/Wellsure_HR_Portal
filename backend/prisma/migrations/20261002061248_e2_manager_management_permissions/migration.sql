-- Phase 5 commit E2 — Manager Management permissions.
--
-- ensureAccessCatalog() (run on every deploy) creates missing permission
-- rows but deliberately never edits an existing role. The user's decision
-- that HR_ADMIN holds the three new keys by default is therefore applied
-- here, once, for databases whose HR_ADMIN role already exists. A Super
-- Admin can revoke them afterwards (Roles & Permissions).

INSERT INTO "permissions" ("id", "key", "description")
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('manager.appoint', 'Appoint and remove managers'),
  ('manager.team.assign', 'Assign teams'),
  ('manager.permissions.manage', 'Manager permission exceptions')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM "permissions" p WHERE p."key" = k.key);

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id"
FROM "roles" r
JOIN "permissions" p ON p."key" IN ('manager.appoint', 'manager.team.assign', 'manager.permissions.manage')
WHERE r."code" = 'HR_ADMIN'
ON CONFLICT DO NOTHING;
