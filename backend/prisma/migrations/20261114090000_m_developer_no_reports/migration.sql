-- M session (owners' decision, 2026-11-14): every report is closed to the Developer / operator role. Its default report grants (reports.view and the
-- two narrower keys reports.attendance.view and reports.leave.view, which open the leave and attendance report pages) are removed from existing
-- databases; new ones follow shared/constants/sensitiveData.ts DEVELOPER_ROLE_PERMISSIONS. The removal is recorded first, as the HR hard lock records
-- its removals, so it can be reversed by a forward migration. Forward-only.
INSERT INTO "role_permission_removals" ("id", "role_code", "permission_key", "reason")
SELECT 'rpr_' || md5(r."code" || ':' || p."key" || ':m_developer_no_reports'), r."code", p."key", 'Owners: every report is closed to the Developer (2026-11-14)'
FROM "role_permissions" rp
JOIN "roles" r ON r."id" = rp."role_id"
JOIN "permissions" p ON p."id" = rp."permission_id"
WHERE r."code" = 'DEVELOPER' AND p."key" IN ('reports.view', 'reports.attendance.view', 'reports.leave.view');

DELETE FROM "role_permissions" rp
USING "roles" r, "permissions" p
WHERE r."id" = rp."role_id" AND p."id" = rp."permission_id"
  AND r."code" = 'DEVELOPER' AND p."key" IN ('reports.view', 'reports.attendance.view', 'reports.leave.view');
