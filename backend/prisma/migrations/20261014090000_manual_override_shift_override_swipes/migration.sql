-- Phase 3 commit 2 (docs/plans/PHASE_3.md "Commit 2 — design as decided before building"):
-- Shift Override, the release of approved leave on a day the person worked, and the permissions for
-- Manual Override and Employee Swipes.

-- attendance_overrides: the new RELEASE_ONLY kind carries no times or status (the day follows the device).
ALTER TABLE "attendance_overrides" DROP CONSTRAINT "attendance_overrides_kind_fields";
ALTER TABLE "attendance_overrides" ADD CONSTRAINT "attendance_overrides_kind_fields" CHECK (
  (kind = 'ADD_TIME' AND ((in_time IS NOT NULL) <> (out_time IS NOT NULL)) AND status IS NULL)
  OR (kind = 'TIMES' AND in_time IS NOT NULL AND out_time IS NOT NULL AND status IS NULL)
  OR (kind = 'STATUS' AND status IN ('P', 'A', 'HD_FIRST', 'HD_SECOND', 'WORKED') AND in_time IS NULL AND out_time IS NULL)
  OR (kind IN ('CLEARED', 'RELEASE_ONLY') AND in_time IS NULL AND out_time IS NULL AND status IS NULL)
);

-- ── shift_overrides: a shift for one employee on one date; append-only, latest wins, shift_id NULL = cleared ──
CREATE TABLE "shift_overrides" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shift_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "shift_overrides_seq_key" ON "shift_overrides"("seq");
CREATE INDEX "shift_overrides_employee_id_date_seq_idx" ON "shift_overrides"("employee_id", "date", "seq");
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "shift_overrides" ADD CONSTRAINT "shift_overrides_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION shift_overrides_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'SHIFT_OVERRIDE_APPEND_ONLY: shift overrides are never changed or deleted; add a correcting row instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER shift_overrides_append_only BEFORE UPDATE OR DELETE ON "shift_overrides" FOR EACH ROW EXECUTE FUNCTION shift_overrides_append_only();
CREATE TRIGGER shift_overrides_no_truncate BEFORE TRUNCATE ON "shift_overrides" FOR EACH STATEMENT EXECUTE FUNCTION shift_overrides_append_only();

-- The day says its shift came from an override.
ALTER TABLE "daily_attendance" ADD COLUMN "shift_override_ref" TEXT;

-- ── leave_day_releases: approved leave released because the person worked that day ──
CREATE TABLE "leave_day_releases" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "leave_request_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "day_part" "LeaveDayPart" NOT NULL,
    "days" DECIMAL(3,2) NOT NULL,
    "override_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_day_releases_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leave_day_releases_override_id_idx" ON "leave_day_releases"("override_id");
CREATE UNIQUE INDEX "leave_day_releases_leave_request_id_date_day_part_key" ON "leave_day_releases"("leave_request_id", "date", "day_part");
CREATE INDEX "leave_day_releases_employee_id_date_idx" ON "leave_day_releases"("employee_id", "date");
ALTER TABLE "leave_day_releases" ADD CONSTRAINT "leave_day_releases_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_day_releases" ADD CONSTRAINT "leave_day_releases_leave_request_id_fkey" FOREIGN KEY ("leave_request_id") REFERENCES "leave_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_day_releases" ADD CONSTRAINT "leave_day_releases_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_day_releases" ADD CONSTRAINT "leave_day_releases_override_id_fkey" FOREIGN KEY ("override_id") REFERENCES "attendance_overrides"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_day_releases" ADD CONSTRAINT "leave_day_releases_days" CHECK ("days" IN (0.5, 1));
ALTER TABLE "leave_day_releases" ADD CONSTRAINT "leave_day_releases_part_days" CHECK (("day_part" = 'FULL') = ("days" = 1));

CREATE OR REPLACE FUNCTION leave_day_releases_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'LEAVE_DAY_RELEASE_APPEND_ONLY: a leave release is never changed or deleted; apply leave again if it was a mistake';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leave_day_releases_append_only BEFORE UPDATE OR DELETE ON "leave_day_releases" FOR EACH ROW EXECUTE FUNCTION leave_day_releases_append_only();
CREATE TRIGGER leave_day_releases_no_truncate BEFORE TRUNCATE ON "leave_day_releases" FOR EACH STATEMENT EXECUTE FUNCTION leave_day_releases_append_only();

-- ── Permissions ──
-- attendance.override.manage: Manual Override and Shift Override (HR Admin; Super Admin holds every permission; never manager-grantable).
-- attendance.swipes.view: the raw punch log (HR; a manager only by grant, TEAM scope).
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('attendance.override.manage', 'Override attendance days and shifts'),
  ('attendance.swipes.view', 'View the raw punch log (Employee Swipes)')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON
  (r.code = 'HR_ADMIN' AND p.key IN ('attendance.override.manage', 'attendance.swipes.view'))
  OR (r.code = 'HR_EXECUTIVE' AND p.key = 'attendance.swipes.view')
ON CONFLICT DO NOTHING;
