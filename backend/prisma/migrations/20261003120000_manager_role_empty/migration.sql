-- User decision 2026-10-03: the MANAGER role grants nothing by default.
-- Every manager permission is granted per manager (a user override) by
-- Admin, within the manager-grantable ceiling. Existing databases had
-- employee.view, leave.view, leave.approve, leave.apply.onBehalf and
-- reports.view on the role; they're removed here. In production no manager
-- exists yet; in a dev database the seed re-grants its demo managers
-- explicitly, per person.
DELETE FROM "role_permissions"
WHERE "role_id" IN (SELECT "id" FROM "roles" WHERE "code" = 'MANAGER');
