-- Audit fix 2026-11-18 (docs/plans/AUDIT_FIXES.md item 7): another person's personal email, mobile, home addresses and emergency contact move behind their own key,
-- split out of employee.view the same way the Stage 1 keys were: everyone who held employee.view holds the new key, so nothing changes for anybody except the
-- Developer role, which never holds it (it is a sensitive class, and the Developer's ceiling in lib/permissions.ts removes it even if granted).
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, 'employee.personal.view', 'See personal contact details'
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = 'employee.personal.view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, c.id
FROM role_permissions rp
JOIN permissions pp ON pp.id = rp.permission_id AND pp.key = 'employee.view'
JOIN roles r ON r.id = rp.role_id AND r.code <> 'DEVELOPER'
JOIN permissions c ON c.key = 'employee.personal.view'
ON CONFLICT DO NOTHING;

-- A person's own grant or revoke of employee.view carries over to the new key.
INSERT INTO user_permission_overrides (id, user_id, permission_id, effect, reason, created_by_user_id)
SELECT 'upo_' || md5(o.user_id || ':employee.personal.view'), o.user_id, c.id, o.effect, 'Carried over from employee.view when personal contact details got their own key (2026-11-18)', o.created_by_user_id
FROM user_permission_overrides o
JOIN permissions pp ON pp.id = o.permission_id AND pp.key = 'employee.view'
JOIN permissions c ON c.key = 'employee.personal.view'
ON CONFLICT (user_id, permission_id) DO NOTHING;
