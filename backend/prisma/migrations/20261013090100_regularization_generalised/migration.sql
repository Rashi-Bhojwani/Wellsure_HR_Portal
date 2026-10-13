-- Phase 3 commit 1 (docs/plans/PHASE_3.md): regularization for any correctable day.
-- One request type with a reason code, a free-text note and either corrected
-- times or a target status; a bulk path (batches); and one append-only table,
-- attendance_overrides, that holds every day-level correction (a regularization
-- now, a manual override in commit 2). The latest row for an employee-day wins;
-- raw punches are never touched.

-- CreateEnum
CREATE TYPE "RegularizationReasonCode" AS ENUM ('FORGOT_TO_PUNCH', 'DEVICE_DOWN', 'ON_DUTY_ELSEWHERE', 'OTHER');
CREATE TYPE "OverrideOrigin" AS ENUM ('REGULARIZATION', 'MANUAL_OVERRIDE');
CREATE TYPE "OverrideKind" AS ENUM ('ADD_TIME', 'TIMES', 'STATUS', 'CLEARED');

-- ── regularization_requests: from "one missing punch" to "a correction" ──
ALTER TABLE "regularization_requests"
  ADD COLUMN "reason_code" "RegularizationReasonCode",
  ADD COLUMN "in_time" TEXT,
  ADD COLUMN "out_time" TEXT,
  ADD COLUMN "target_status" TEXT,
  ADD COLUMN "batch_id" TEXT;

-- The old requests were all "forgot to punch": the missing side's time is the one time to add.
UPDATE "regularization_requests" SET
  "reason_code" = 'FORGOT_TO_PUNCH',
  "in_time" = CASE WHEN "missing" = 'IN' THEN "time" END,
  "out_time" = CASE WHEN "missing" = 'OUT' THEN "time" END;

ALTER TABLE "regularization_requests" ALTER COLUMN "reason_code" SET NOT NULL;
ALTER TABLE "regularization_requests" ALTER COLUMN "reason" SET DEFAULT '';
ALTER TABLE "regularization_requests" DROP CONSTRAINT "regularization_requests_time";
ALTER TABLE "regularization_requests" DROP COLUMN "kind", DROP COLUMN "missing", DROP COLUMN "time";
DROP TYPE "RegularizationKind";
DROP TYPE "MissingPunchSide";

ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_times" CHECK (
  (in_time IS NULL OR in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (out_time IS NULL OR out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
-- Exactly one kind of correction: times (one or both) or a status.
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_one_correction" CHECK (
  (target_status IS NOT NULL AND in_time IS NULL AND out_time IS NULL AND target_status IN ('P', 'A', 'HD_FIRST', 'HD_SECOND'))
  OR (target_status IS NULL AND (in_time IS NOT NULL OR out_time IS NOT NULL))
);

-- ── regularization_batches: one HR action over many employee-days ──
CREATE TABLE "regularization_batches" (
    "id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason_code" "RegularizationReasonCode" NOT NULL,
    "note" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "employee_count" INTEGER NOT NULL,
    "day_count" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "regularization_batches_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "regularization_batches_action" CHECK ("action" IN ('RAISED', 'RAISED_AND_APPROVED'))
);
ALTER TABLE "regularization_requests" ADD CONSTRAINT "regularization_requests_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "regularization_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "regularization_requests_batch_id_idx" ON "regularization_requests"("batch_id");

-- ── attendance_overrides: every day-level correction, append-only, latest wins ──
CREATE TABLE "attendance_overrides" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "origin" "OverrideOrigin" NOT NULL,
    "kind" "OverrideKind" NOT NULL,
    "in_time" TEXT,
    "out_time" TEXT,
    "status" TEXT,
    "reason_code" "RegularizationReasonCode",
    "reason" TEXT NOT NULL DEFAULT '',
    "request_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_overrides_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "attendance_overrides_seq_key" ON "attendance_overrides"("seq");
CREATE UNIQUE INDEX "attendance_overrides_request_id_key" ON "attendance_overrides"("request_id");
CREATE INDEX "attendance_overrides_employee_id_date_seq_idx" ON "attendance_overrides"("employee_id", "date", "seq");
ALTER TABLE "attendance_overrides" ADD CONSTRAINT "attendance_overrides_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attendance_overrides" ADD CONSTRAINT "attendance_overrides_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "regularization_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Each kind carries exactly its own fields.
ALTER TABLE "attendance_overrides" ADD CONSTRAINT "attendance_overrides_kind_fields" CHECK (
  (kind = 'ADD_TIME' AND ((in_time IS NOT NULL) <> (out_time IS NOT NULL)) AND status IS NULL)
  OR (kind = 'TIMES' AND in_time IS NOT NULL AND out_time IS NOT NULL AND status IS NULL)
  OR (kind = 'STATUS' AND status IN ('P', 'A', 'HD_FIRST', 'HD_SECOND', 'WORKED') AND in_time IS NULL AND out_time IS NULL)
  OR (kind = 'CLEARED' AND in_time IS NULL AND out_time IS NULL AND status IS NULL)
);
ALTER TABLE "attendance_overrides" ADD CONSTRAINT "attendance_overrides_times" CHECK (
  (in_time IS NULL OR in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND (out_time IS NULL OR out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$')
);
ALTER TABLE "attendance_overrides" ADD CONSTRAINT "attendance_overrides_origin_request" CHECK ((origin = 'REGULARIZATION') = (request_id IS NOT NULL));

-- Append-only: a correction is a new row, never an edit. Deletion only by the test
-- suite's fixture purge in a dev-marked database (as audit_logs, raw_punches, manual entries).
CREATE OR REPLACE FUNCTION attendance_overrides_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'ATTENDANCE_OVERRIDE_APPEND_ONLY: attendance overrides are never changed or deleted; add a correcting row instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER attendance_overrides_append_only BEFORE UPDATE OR DELETE ON "attendance_overrides" FOR EACH ROW EXECUTE FUNCTION attendance_overrides_append_only();
CREATE TRIGGER attendance_overrides_no_truncate BEFORE TRUNCATE ON "attendance_overrides" FOR EACH STATEMENT EXECUTE FUNCTION attendance_overrides_append_only();

-- ── Carry the forgot-to-punch corrections already approved into the new table, and re-mark their days ──
INSERT INTO "attendance_overrides" ("id", "employee_id", "date", "origin", "kind", "in_time", "out_time", "reason_code", "reason", "request_id", "created_by_user_id", "created_at")
SELECT gen_random_uuid()::text, r."employee_id", r."date", 'REGULARIZATION', 'ADD_TIME', r."in_time", r."out_time", r."reason_code", r."reason", r."id",
       COALESCE(r."decided_by_user_id", r."raised_by_user_id"), COALESCE(r."decided_at", r."updated_at")
FROM "regularization_requests" r WHERE r."status" = 'APPROVED';

UPDATE "daily_attendance" d SET "override_kind" = 'REGULARIZATION', "source" = 'OVERRIDE', "override_ref" = o."id"
FROM "attendance_overrides" o
WHERE d."override_kind" = 'MISSING_PUNCH_CORRECTION' AND o."request_id" = d."override_ref";

-- ── Permission: HR raises and approves corrections in bulk (never manager-grantable) ──
INSERT INTO permissions (id, key, description)
SELECT gen_random_uuid()::text, k.key, k.description
FROM (VALUES ('attendance.regularization.bulk', 'Correct attendance in bulk')) AS k(key, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions p WHERE p.key = k.key);

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'attendance.regularization.bulk'
WHERE r.code = 'HR_ADMIN'
ON CONFLICT DO NOTHING;
