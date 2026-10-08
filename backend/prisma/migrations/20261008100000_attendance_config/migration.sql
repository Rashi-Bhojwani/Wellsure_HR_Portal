-- Phase 2 commit P2-A: attendance configuration (docs/plans/PHASE_2.md §2.1).

-- CreateEnum
CREATE TYPE "ShiftSessionKind" AS ENUM ('WORK', 'BREAK');

-- AlterTable
ALTER TABLE "locations" ADD COLUMN     "has_biometric_device" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "grace_in_minutes" INTEGER NOT NULL DEFAULT 0,
    "grace_out_minutes" INTEGER NOT NULL DEFAULT 0,
    "window_before_minutes" INTEGER NOT NULL DEFAULT 240,
    "window_after_minutes" INTEGER NOT NULL DEFAULT 360,
    "placeholder_fields" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shift_sessions" (
    "id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "kind" "ShiftSessionKind" NOT NULL,
    "label" TEXT NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,

    CONSTRAINT "shift_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "week_off_patterns" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "week_off_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_policies" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "full_day_min_minutes" INTEGER NOT NULL,
    "half_day_min_minutes" INTEGER NOT NULL,
    "half_day_min_not_met_lop_days" DECIMAL(3,2) NOT NULL DEFAULT 1,
    "near_duplicate_seconds" INTEGER NOT NULL DEFAULT 120,
    "infer_break_pairing" BOOLEAN NOT NULL DEFAULT false,
    "penalty_rules" JSONB NOT NULL DEFAULT '[]',
    "future_tolerance_minutes" INTEGER NOT NULL DEFAULT 10,
    "max_punch_age_days" INTEGER NOT NULL DEFAULT 45,
    "placeholder_fields" JSONB NOT NULL DEFAULT '[]',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_assignments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "shift_id" TEXT NOT NULL,
    "week_off_pattern_id" TEXT NOT NULL,
    "policy_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "change_reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_cycle_rules" (
    "id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "start_day" INTEGER NOT NULL,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_cycle_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_manual_branches" (
    "user_id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "assigned_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_manual_branches_pkey" PRIMARY KEY ("user_id","location_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shifts_code_key" ON "shifts"("code");

-- CreateIndex
CREATE UNIQUE INDEX "shift_sessions_shift_id_sort_order_key" ON "shift_sessions"("shift_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "week_off_patterns_code_key" ON "week_off_patterns"("code");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_policies_code_key" ON "attendance_policies"("code");

-- CreateIndex
CREATE INDEX "attendance_assignments_employee_id_effective_to_idx" ON "attendance_assignments"("employee_id", "effective_to");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_cycle_rules_effective_from_key" ON "attendance_cycle_rules"("effective_from");

-- AddForeignKey
ALTER TABLE "shift_sessions" ADD CONSTRAINT "shift_sessions_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_shift_id_fkey" FOREIGN KEY ("shift_id") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_week_off_pattern_id_fkey" FOREIGN KEY ("week_off_pattern_id") REFERENCES "week_off_patterns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_assignments" ADD CONSTRAINT "attendance_assignments_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "attendance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_manual_branches" ADD CONSTRAINT "attendance_manual_branches_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_manual_branches" ADD CONSTRAINT "attendance_manual_branches_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- attendance_assignments is a history table under the effective-dating model
-- (lib/effectiveDating.ts, EF1): rows never run backwards or overlap.
ALTER TABLE attendance_assignments ADD CONSTRAINT attendance_assignments_dates_ordered CHECK (effective_to IS NULL OR effective_to > effective_from);
ALTER TABLE attendance_assignments ADD CONSTRAINT attendance_assignments_no_overlap
  EXCLUDE USING gist (employee_id WITH =, daterange(effective_from, effective_to, '[)') WITH &&);
CREATE UNIQUE INDEX attendance_assignments_one_open ON attendance_assignments (employee_id) WHERE effective_to IS NULL;
ALTER TABLE attendance_cycle_rules ADD CONSTRAINT attendance_cycle_rules_start_day CHECK (start_day BETWEEN 1 AND 28);

-- What HR confirmed on 2026-10-08, created on every database (not just the
-- dev seed), so a real install starts with the real company rules:
--   GEN 10:00–19:00 in two sessions with lunch 14:00–14:45; Sunday off,
--   Monday–Saturday working; no late penalty; calendar-month cycle.
-- Grace and the half-day/full-day minimum hours are NOT confirmed yet: they
-- are placeholders, listed in placeholder_fields and shown as such in the
-- Attendance Settings screen until HR's values are entered.
INSERT INTO shifts (id, code, name, start_time, end_time, grace_in_minutes, grace_out_minutes, placeholder_fields, updated_at)
VALUES ('shift_gen', 'GEN', 'General Shift', '10:00', '19:00', 0, 0, '["graceInMinutes","graceOutMinutes"]', now());
INSERT INTO shift_sessions (id, shift_id, sort_order, kind, label, start_time, end_time) VALUES
  ('shift_gen_s1', 'shift_gen', 1, 'WORK', 'First session', '10:00', '14:00'),
  ('shift_gen_b1', 'shift_gen', 2, 'BREAK', 'Lunch', '14:00', '14:45'),
  ('shift_gen_s2', 'shift_gen', 3, 'WORK', 'Second session', '14:45', '19:00');
INSERT INTO week_off_patterns (id, code, name, rules, updated_at)
VALUES ('wop_sun', 'SUN', 'Sunday off', '[{"weekday":0}]', now());
INSERT INTO attendance_policies (id, code, name, full_day_min_minutes, half_day_min_minutes, placeholder_fields, updated_at)
VALUES ('policy_default', 'DEFAULT', 'Default policy', 480, 240, '["fullDayMinMinutes","halfDayMinMinutes"]', now());
INSERT INTO attendance_cycle_rules (id, effective_from, start_day) VALUES ('cycle_default', '2000-01-01', 1);
INSERT INTO system_settings (key, value, updated_at)
VALUES ('attendance.defaults', '{"shiftCode":"GEN","weekOffPatternCode":"SUN","policyCode":"DEFAULT"}', now())
ON CONFLICT (key) DO NOTHING;

-- Everyone already on record gets the company default from the first day of
-- their history (the earlier of joining and today, as EF2's firstHistoryDay);
-- a leaver's ends the day after their last working day, like their placement.
INSERT INTO attendance_assignments (id, employee_id, shift_id, week_off_pattern_id, policy_id, effective_from, effective_to, change_reason, created_by_user_id)
SELECT gen_random_uuid()::text, e.id, 'shift_gen', 'wop_sun', 'policy_default',
       LEAST(e.date_of_joining, (now() AT TIME ZONE 'Asia/Kolkata')::date),
       CASE WHEN e.status = 'SEPARATED' AND e.last_working_date IS NOT NULL THEN e.last_working_date + 1 END,
       'Company default (Phase 2 setup)', u.id
FROM employees e JOIN users u ON u.employee_id = e.id
WHERE NOT (e.status = 'SEPARATED' AND e.last_working_date IS NOT NULL AND e.last_working_date + 1 <= LEAST(e.date_of_joining, (now() AT TIME ZONE 'Asia/Kolkata')::date));

-- Permissions (docs/plans/PHASE_2.md §2.4). attendance.manual.enter is
-- manager-grantable but limited to assigned branches (the SPN/Wellsure 2
-- marker is a manager); the rest are Admin-only.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('attendance.view', 'View attendance'),
  ('attendance.config.manage', 'Attendance settings'),
  ('attendance.manual.enter', 'Mark attendance manually'),
  ('attendance.process', 'Process attendance'),
  ('attendance.devices.manage', 'Biometric devices')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('attendance.view', 'attendance.config.manage', 'attendance.manual.enter', 'attendance.process', 'attendance.devices.manage')
WHERE r.code = 'HR_ADMIN'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('attendance.view', 'attendance.manual.enter', 'attendance.process')
WHERE r.code = 'HR_EXECUTIVE'
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'attendance.view'
WHERE r.code = 'PAYROLL_ADMIN'
ON CONFLICT DO NOTHING;
