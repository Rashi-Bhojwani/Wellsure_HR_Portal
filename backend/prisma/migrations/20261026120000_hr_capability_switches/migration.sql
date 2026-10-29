-- Stage 1 (docs/plans/HR_CAPABILITIES.md §1B): the HR capability switches, and the five permission keys split out so each switch can govern its piece alone.

-- 1. The five keys. Everyone who held the parent holds the child, so nothing changes for anybody on the day this ships.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('attendance.manual.upload', 'Upload manual attendance'),
  ('attendance.roster.manage', 'Shift roster'),
  ('attendance.exceptions.view', 'Attendance exceptions queue'),
  ('reports.attendance.view', 'Attendance reports'),
  ('reports.leave.view', 'Leave reports')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

CREATE TEMP TABLE _split_keys (child TEXT, parent TEXT) ON COMMIT DROP;
INSERT INTO _split_keys VALUES
  ('attendance.manual.upload', 'attendance.manual.enter'),
  ('attendance.roster.manage', 'attendance.config.manage'),
  ('attendance.exceptions.view', 'attendance.view'),
  ('reports.attendance.view', 'reports.view'),
  ('reports.leave.view', 'reports.view');

INSERT INTO role_permissions (role_id, permission_id)
SELECT rp.role_id, c.id
FROM role_permissions rp
JOIN permissions pp ON pp.id = rp.permission_id
JOIN _split_keys sk ON sk.parent = pp.key
JOIN permissions c ON c.key = sk.child
ON CONFLICT DO NOTHING;

-- A person's own grant or revoke of the parent carries over to the child.
INSERT INTO user_permission_overrides (id, user_id, permission_id, effect, reason, created_by_user_id)
SELECT 'upo_' || md5(o.user_id || ':' || c.key), o.user_id, c.id, o.effect, 'Carried over from ' || pp.key || ' when it was split (Stage 1)', o.created_by_user_id
FROM user_permission_overrides o
JOIN permissions pp ON pp.id = o.permission_id
JOIN _split_keys sk ON sk.parent = pp.key
JOIN permissions c ON c.key = sk.child
ON CONFLICT (user_id, permission_id) DO NOTHING;

-- 2. The switches. Append-only.
CREATE TABLE "hr_capability_switches" (
    "id" TEXT NOT NULL,
    "capability" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject_key" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "effective_from" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_capability_switches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "hr_capability_switches_capability_subject_kind_subject_key__key" ON "hr_capability_switches"("capability", "subject_kind", "subject_key", "effective_from");
CREATE INDEX "hr_capability_switches_subject_kind_subject_key_idx" ON "hr_capability_switches"("subject_kind", "subject_key");

ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_state_check" CHECK ("state" IN ('ON', 'OFF', 'DEFAULT'));
ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_kind_check" CHECK ("subject_kind" IN ('ROLE', 'USER'));
ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_role_check" CHECK ("subject_kind" <> 'ROLE' OR "subject_key" IN ('HR_ADMIN', 'HR_EXECUTIVE'));
ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_capability_check" CHECK ("capability" IN (
  'VIEW_ATTENDANCE', 'APPROVE_REGULARIZATIONS', 'APPROVE_LEAVE', 'EDIT_MUSTER', 'UPLOAD_MANUAL_MUSTER', 'FINALISE_MONTH', 'CORRECTIONS', 'SHIFT_ROSTER', 'EXCEPTIONS_QUEUE', 'ATTENDANCE_REPORTS', 'LEAVE_REPORTS'));
ALTER TABLE "hr_capability_switches" ADD CONSTRAINT "hr_capability_switches_reason_check" CHECK (length(btrim("reason")) >= 3);

CREATE OR REPLACE FUNCTION hr_capability_switches_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'HR_SWITCHES_APPEND_ONLY: a switch is never changed or deleted; a new row supersedes it';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hr_capability_switches_append_only BEFORE UPDATE OR DELETE ON "hr_capability_switches" FOR EACH ROW EXECUTE FUNCTION hr_capability_switches_append_only();
CREATE TRIGGER hr_capability_switches_no_truncate BEFORE TRUNCATE ON "hr_capability_switches" FOR EACH STATEMENT EXECUTE FUNCTION hr_capability_switches_append_only();

-- Only a Super Admin writes a switch (the service checks it too; this holds whatever the code does).
CREATE OR REPLACE FUNCTION hr_capability_switches_director_only() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."created_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'HR_SWITCHES_DIRECTORS_ONLY: only a Super Admin changes what HR can do';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER hr_capability_switches_director_only BEFORE INSERT ON "hr_capability_switches" FOR EACH ROW EXECUTE FUNCTION hr_capability_switches_director_only();

-- The test-purge allowance (a development-marked database only, inside a transaction that sets it) for the record the previous migration created, as for every other append-only table.
CREATE OR REPLACE FUNCTION role_permission_removals_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ROLE_PERMISSION_REMOVALS_APPEND_ONLY: this record is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
