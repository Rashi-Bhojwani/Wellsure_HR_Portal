-- FIX-C3/H5/M7 (independent audit 2026-11-20). The Developer role keeps view and diagnostics only: every write or import permission that changes employee,
-- leave, pay, attendance policy or identity data leaves it (shared/constants/sensitiveData.ts, DEVELOPER_WRITE_FORBIDDEN; lib/permissions.ts removes them
-- from a Developer whatever is stored). HR Executive no longer grants leave by default (HR Admin proposes, a director confirms). What is removed is copied
-- first into the append-only role_permission_removals.

CREATE TEMP TABLE fix_dev_forbidden(key text PRIMARY KEY);
INSERT INTO fix_dev_forbidden(key) VALUES
  ('employee.create'), ('employee.edit'), ('employee.manage'), ('employee.separate'), ('profile.changerequest.approve'), ('invitations.send'),
  ('org.manage'), ('import.manage'), ('import.details.manage'),
  ('leave.apply.onBehalf'), ('leave.approve'), ('leave.grant'), ('leave.recalculate'), ('leave.yearend.manage'), ('leave.policy.manage'),
  ('attendance.config.manage'), ('attendance.manual.enter'), ('attendance.process'), ('attendance.devices.manage'), ('attendance.regularization.approve'),
  ('attendance.regularization.bulk'), ('attendance.override.manage'), ('attendance.finalise'), ('attendance.manual.upload'), ('attendance.roster.manage'), ('attendance.unlock'),
  ('manager.appoint'), ('manager.team.assign'),
  ('exits.manage'), ('exits.accept'), ('exits.checklist.complete'),
  ('recruitment.onboarding');

INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key" || ':fix-20261120'), r."code", p."key", 'Developer keeps view and diagnostics only (independent audit fix, 2026-11-20)'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" = 'DEVELOPER' AND p."key" IN (SELECT key FROM fix_dev_forbidden)
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id" AND r."code" = 'DEVELOPER' AND p."key" IN (SELECT key FROM fix_dev_forbidden);

-- A personal grant to someone holding the Developer role: copied, then removed.
INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5('USER_OVERRIDE:' || o."user_id" || ':' || p."key" || ':fix-20261120'), 'USER_OVERRIDE:' || o."user_id", p."key", 'Developer keeps view and diagnostics only (independent audit fix, 2026-11-20): a personal grant'
FROM "user_permission_overrides" o
JOIN "permissions" p ON p."id" = o."permission_id"
WHERE o."effect" = 'GRANT' AND p."key" IN (SELECT key FROM fix_dev_forbidden)
  AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" = 'DEVELOPER')
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "user_permission_overrides" o
USING "permissions" p
WHERE p."id" = o."permission_id" AND o."effect" = 'GRANT' AND p."key" IN (SELECT key FROM fix_dev_forbidden)
  AND EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = o."user_id" AND r."code" = 'DEVELOPER');

-- HR Executive: leave.grant leaves the role (copied first). HR Admin holds it, to propose a grant a director confirms.
INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key" || ':fix-20261120'), r."code", p."key", 'HR Executive no longer grants leave (independent audit fix, 2026-11-20)'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" = 'HR_EXECUTIVE' AND p."key" = 'leave.grant'
ON CONFLICT ("id") DO NOTHING;

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id" AND r."code" = 'HR_EXECUTIVE' AND p."key" = 'leave.grant';

INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT r."id", p."id" FROM "roles" r, "permissions" p
WHERE r."code" = 'HR_ADMIN' AND p."key" = 'leave.grant'
ON CONFLICT DO NOTHING;
DROP TABLE fix_dev_forbidden;
