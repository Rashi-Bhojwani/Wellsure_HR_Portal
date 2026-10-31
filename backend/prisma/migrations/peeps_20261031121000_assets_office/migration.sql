-- Peeps assets under owner decisions D-29 / Q-14: the register is managed by the directors and the Wellsure Office members they choose (through
-- membership grants), no longer by HR. HR keeps one narrow key: issuing an asset to a new joiner during onboarding, which the service refuses until
-- the directors' asset settings allow it. Forward-only: the rows removed here are the ones peeps_20261031090000_assets added.
DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id AND rp.permission_id = p.id
  AND r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
  AND p.key IN ('assets.view', 'assets.manage', 'assets.settings.manage');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'assets.onboarding.issue'
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;
