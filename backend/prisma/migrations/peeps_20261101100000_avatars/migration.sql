-- Peeps avatars and directory. Additive: one permission key. HR and the directors remove someone else's inappropriate profile photo with a reason
-- (audited); only the owner adds or changes a photo. HR Executive and HR Admin get it, as lib/systemRoles.ts gives a new database; the directors hold
-- every key already.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, 'avatars.moderate', 'Remove someone else''s inappropriate profile photo, with a reason'
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE key = 'avatars.moderate');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'avatars.moderate'
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;
