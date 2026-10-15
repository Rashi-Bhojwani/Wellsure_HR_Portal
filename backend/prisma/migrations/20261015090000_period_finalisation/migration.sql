-- Phase 3 commit 3 (docs/plans/PHASE_3.md "Commit 3 — Finalisation and exceptions"): Period Finalisation's record.
-- Each finalise and each unlock of an attendance cycle is a row, never edited or removed; a cycle's status is its latest row
-- (none = open, FINALISE = finalised, UNLOCK = open again, with who unlocked it and why).

CREATE TYPE "PeriodLockAction" AS ENUM ('FINALISE', 'UNLOCK');

CREATE TABLE "attendance_period_locks" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "action" "PeriodLockAction" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "locked_days" INTEGER NOT NULL DEFAULT 0,
    "payroll_consumed" BOOLEAN NOT NULL DEFAULT false,
    "actor_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_period_locks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_period_locks_seq_key" ON "attendance_period_locks"("seq");
CREATE INDEX "attendance_period_locks_period_start_period_end_seq_idx" ON "attendance_period_locks"("period_start", "period_end", "seq");
ALTER TABLE "attendance_period_locks" ADD CONSTRAINT "attendance_period_locks_period" CHECK ("period_end" >= "period_start");
-- An unlock always says why.
ALTER TABLE "attendance_period_locks" ADD CONSTRAINT "attendance_period_locks_unlock_reason" CHECK ("action" <> 'UNLOCK' OR length(btrim("reason")) >= 5);

CREATE OR REPLACE FUNCTION attendance_period_locks_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PERIOD_LOCK_APPEND_ONLY: finalising and unlocking a period are never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER attendance_period_locks_append_only BEFORE UPDATE OR DELETE ON "attendance_period_locks" FOR EACH ROW EXECUTE FUNCTION attendance_period_locks_append_only();
CREATE TRIGGER attendance_period_locks_no_truncate BEFORE TRUNCATE ON "attendance_period_locks" FOR EACH STATEMENT EXECUTE FUNCTION attendance_period_locks_append_only();

-- Permissions: finalise (HR Admin and Payroll Admin; Super Admin holds every key in code). Unlock is Super Admin only: no role row.
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES
  ('attendance.finalise', 'Finalise attendance periods'),
  ('attendance.unlock', 'Unlock a finalised attendance period (Super Admin only)')
) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'attendance.finalise'
WHERE r.code IN ('HR_ADMIN', 'PAYROLL_ADMIN')
ON CONFLICT DO NOTHING;
