-- After the owners' review of Checkpoint 1: three narrower keys, each a director-controlled HR switch, with the default as before D1 (the HR roles hold them).
-- They carry no pay data: sending invitations, importing non-pay employee details, issuing letters proven to contain no pay figure.

INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('invitations.send', 'Send invitations'),
  ('import.details.manage', 'Import employee details'),
  ('letters.issue.nopay', 'Issue letters without pay figures')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

-- Invitations: everyone who could add employees can send invitations (split from employee.create), roles and personal grants alike.
INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, c.id FROM role_permissions rp
JOIN permissions pp ON pp.id = rp.permission_id AND pp.key = 'employee.create'
JOIN permissions c ON c.key = 'invitations.send'
ON CONFLICT DO NOTHING;
INSERT INTO user_permission_overrides (id, user_id, permission_id, effect, reason, created_by_user_id)
SELECT 'upo_' || md5(o.user_id || ':' || c.key), o.user_id, c.id, o.effect, 'Carried over from employee.create when invitations were split out', o.created_by_user_id
FROM user_permission_overrides o
JOIN permissions pp ON pp.id = o.permission_id AND pp.key = 'employee.create'
JOIN permissions c ON c.key = 'invitations.send'
ON CONFLICT (user_id, permission_id) DO NOTHING;

-- Import and letters: both HR roles held the wide keys before the hard lock, so both hold the narrow ones.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('import.details.manage', 'letters.issue.nopay')
WHERE r.code IN ('HR_ADMIN', 'HR_EXECUTIVE')
ON CONFLICT DO NOTHING;

ALTER TABLE "hr_capability_switches" DROP CONSTRAINT "hr_capability_switches_capability_check";
ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_capability_check" CHECK ("capability" IN (
  'VIEW_ATTENDANCE', 'APPROVE_REGULARIZATIONS', 'APPROVE_LEAVE', 'EDIT_MUSTER', 'UPLOAD_MANUAL_MUSTER', 'FINALISE_MONTH', 'CORRECTIONS', 'SHIFT_ROSTER', 'EXCEPTIONS_QUEUE', 'ATTENDANCE_REPORTS', 'LEAVE_REPORTS', 'SEE_LEAVE_COUNTS',
  'SEND_INVITATIONS', 'IMPORT_EMPLOYEE_DETAILS', 'ISSUE_LETTERS_NO_PAY'));
