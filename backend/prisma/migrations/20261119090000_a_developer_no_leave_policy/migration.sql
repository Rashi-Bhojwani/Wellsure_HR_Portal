-- Final merge 2026-11-19 (docs/plans/FINAL_MERGE_REPORT.md): leave.policy.manage leaves the Developer role. Leave policies change people's leave balances, so
-- the person who builds and runs the system no longer holds them; the key is now in DEVELOPER_FORBIDDEN_KEYS (shared/constants/sensitiveData.ts), which
-- lib/permissions.ts removes from a Developer whatever is stored. What is removed here is copied first into the append-only role_permission_removals.

INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key"), r."code", p."key", 'Developer no longer manages leave policies (final merge, 2026-11-19)'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" = 'DEVELOPER' AND p."key" = 'leave.policy.manage'
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id" AND r."code" = 'DEVELOPER' AND p."key" = 'leave.policy.manage';

-- A personal grant to someone holding the Developer role: copied, then removed.
INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5('USER_OVERRIDE:' || o."user_id" || ':' || p."key"), 'USER_OVERRIDE:' || o."user_id", p."key", 'Developer no longer manages leave policies (final merge, 2026-11-19): a personal grant'
FROM "user_permission_overrides" o
JOIN "permissions" p ON p."id" = o."permission_id"
WHERE o."effect" = 'GRANT' AND p."key" = 'leave.policy.manage'
  AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" = 'DEVELOPER')
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "user_permission_overrides" o
USING "permissions" p
WHERE p."id" = o."permission_id" AND o."effect" = 'GRANT' AND p."key" = 'leave.policy.manage'
  AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" = 'DEVELOPER');
