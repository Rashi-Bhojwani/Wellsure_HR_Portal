-- Stage 5a: remote attendance. A director marks who works remotely (append-only); a remote employee checks in and out (a server-stamped time, no location);
-- the record goes to the directors, who alone approve a full day, a half day, or reject with a reason.
CREATE TYPE "RemoteRecordStatus" AS ENUM ('OPEN', 'PENDING', 'APPROVED_FULL', 'APPROVED_HALF', 'REJECTED');
CREATE TYPE "RemoteHalf" AS ENUM ('FIRST', 'SECOND');
CREATE TYPE "RemoteRejectOutcome" AS ENUM ('ABSENT', 'LOSS_OF_PAY');
CREATE TYPE "RemoteRequestKind" AS ENUM ('CORRECTION', 'REVIEW');
CREATE TYPE "RemoteRequestStatus" AS ENUM ('OPEN', 'ACCEPTED', 'DECLINED');

CREATE TABLE "remote_work_marks" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "remote" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "marked_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "remote_work_marks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "remote_work_marks_employee_id_effective_from_created_at_idx" ON "remote_work_marks"("employee_id", "effective_from", "created_at");
ALTER TABLE "remote_work_marks" ADD CONSTRAINT "remote_work_marks_reason_check" CHECK (length(btrim("reason")) >= 3);

CREATE TABLE "remote_attendance_records" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "check_in_at" TIMESTAMPTZ(3),
    "check_out_at" TIMESTAMPTZ(3),
    "status" "RemoteRecordStatus" NOT NULL DEFAULT 'OPEN',
    "half" "RemoteHalf",
    "reject_outcome" "RemoteRejectOutcome",
    "decision_reason" TEXT,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMPTZ(3),
    "override_id" TEXT,
    "reopen_count" INTEGER NOT NULL DEFAULT 0,
    "reminder_sent_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "remote_attendance_records_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "remote_attendance_records_employee_id_date_key" ON "remote_attendance_records"("employee_id", "date");
CREATE INDEX "remote_attendance_records_status_date_idx" ON "remote_attendance_records"("status", "date");
ALTER TABLE "remote_attendance_records" ADD CONSTRAINT "remote_attendance_records_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A rejection always carries its reason and its outcome; a half day says which half; a check-out is never before the check-in.
ALTER TABLE "remote_attendance_records" ADD CONSTRAINT "remote_attendance_records_decision_check" CHECK (
  ("status" <> 'REJECTED' OR ("decision_reason" IS NOT NULL AND length(btrim("decision_reason")) >= 3 AND "reject_outcome" IS NOT NULL))
  AND ("status" <> 'APPROVED_HALF' OR "half" IS NOT NULL)
  AND ("check_out_at" IS NULL OR "check_in_at" IS NOT NULL AND "check_out_at" >= "check_in_at")
);

CREATE TABLE "remote_attendance_events" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "remote_attendance_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "remote_attendance_events_record_id_created_at_idx" ON "remote_attendance_events"("record_id", "created_at");
ALTER TABLE "remote_attendance_events" ADD CONSTRAINT "remote_attendance_events_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "remote_attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "remote_attendance_requests" (
    "id" TEXT NOT NULL,
    "record_id" TEXT NOT NULL,
    "kind" "RemoteRequestKind" NOT NULL,
    "status" "RemoteRequestStatus" NOT NULL DEFAULT 'OPEN',
    "note" TEXT NOT NULL,
    "proposed_check_in" TIMESTAMPTZ(3),
    "proposed_check_out" TIMESTAMPTZ(3),
    "requested_by_user_id" TEXT NOT NULL,
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMPTZ(3),
    "resolution_note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "remote_attendance_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "remote_attendance_requests_record_id_status_idx" ON "remote_attendance_requests"("record_id", "status");
ALTER TABLE "remote_attendance_requests" ADD CONSTRAINT "remote_attendance_requests_record_id_fkey" FOREIGN KEY ("record_id") REFERENCES "remote_attendance_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION remote_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN RETURN OLD; END IF; -- a record deleted with its employee in a test takes its events with it
  RAISE EXCEPTION 'REMOTE_APPEND_ONLY: a remote-work mark or an event is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER remote_work_marks_append_only BEFORE UPDATE OR DELETE ON "remote_work_marks" FOR EACH ROW EXECUTE FUNCTION remote_append_only();
CREATE TRIGGER remote_work_marks_no_truncate BEFORE TRUNCATE ON "remote_work_marks" FOR EACH STATEMENT EXECUTE FUNCTION remote_append_only();
CREATE TRIGGER remote_attendance_events_append_only BEFORE UPDATE OR DELETE ON "remote_attendance_events" FOR EACH ROW EXECUTE FUNCTION remote_append_only();

-- Only a Super Admin marks anyone remote (the service checks it too; this holds whatever the code does).
CREATE OR REPLACE FUNCTION remote_marks_director_only() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."marked_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'REMOTE_MARKS_DIRECTORS_ONLY: only a Super Admin marks who works remotely';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER remote_work_marks_director_only BEFORE INSERT ON "remote_work_marks" FOR EACH ROW EXECUTE FUNCTION remote_marks_director_only();
