-- Peeps assets under Q-14 (decided 2026-11): the asset register is managed by HR and the directors. Forward-only; the earlier migrations stay as they are.
-- This gives the HR roles back what peeps_20261031121000_assets_office took away (the defaults lib/systemRoles.ts gives a new database: HR Executive and
-- HR Admin view and manage the register; HR Admin also prepares the asset lists, which a director who did not enter them confirms), and removes the
-- narrow onboarding key, which no route uses any more (HR issues from the register itself).
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('assets.view', 'assets.manage')
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'assets.settings.manage'
WHERE r.code = 'HR_ADMIN'
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id
  AND r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
  AND p.key = 'assets.onboarding.issue';
