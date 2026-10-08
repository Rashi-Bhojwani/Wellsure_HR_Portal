-- Manual attendance (Phase 2 commit P2-D, docs/plans/PHASE_2.md §2.3, §5,
-- "P2-D build design").


-- CreateEnum
CREATE TYPE "ManualEntryKind" AS ENUM ('TIMED', 'STATUS_ONLY', 'CLEARED');

-- CreateEnum
CREATE TYPE "ManualEntryVia" AS ENUM ('SCREEN', 'MUSTER_UPLOAD', 'BULK');

-- CreateEnum
CREATE TYPE "ManualMusterUploadStatus" AS ENUM ('PREVIEW', 'COMMITTED');

-- CreateTable
CREATE TABLE "manual_attendance_entries" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "ManualEntryKind" NOT NULL,
    "in_time" TEXT,
    "out_time" TEXT,
    "status" TEXT,
    "via" "ManualEntryVia" NOT NULL,
    "upload_id" TEXT,
    "remark" TEXT,
    "entered_by_user_id" TEXT NOT NULL,
    "entered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "manual_attendance_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "manual_muster_uploads" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "cycle_end" DATE NOT NULL,
    "file_name" TEXT NOT NULL,
    "status" "ManualMusterUploadStatus" NOT NULL DEFAULT 'PREVIEW',
    "pending_cells" JSONB,
    "summary" JSONB NOT NULL DEFAULT '{}',
    "uploaded_by_user_id" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committed_at" TIMESTAMP(3),

    CONSTRAINT "manual_muster_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manual_attendance_entries_seq_key" ON "manual_attendance_entries"("seq");

-- CreateIndex
CREATE INDEX "manual_attendance_entries_employee_id_date_seq_idx" ON "manual_attendance_entries"("employee_id", "date", "seq");

-- AddForeignKey
ALTER TABLE "manual_attendance_entries" ADD CONSTRAINT "manual_attendance_entries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_attendance_entries" ADD CONSTRAINT "manual_attendance_entries_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "manual_muster_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "manual_muster_uploads" ADD CONSTRAINT "manual_muster_uploads_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Each kind carries exactly its own fields.
ALTER TABLE "manual_attendance_entries" ADD CONSTRAINT "manual_attendance_entries_kind_fields" CHECK (
  (kind = 'TIMED' AND in_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' AND (out_time IS NULL OR out_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') AND status IS NULL)
  OR (kind = 'STATUS_ONLY' AND status IN ('P', 'A', 'HD_FIRST', 'HD_SECOND', 'WORKED') AND in_time IS NULL AND out_time IS NULL)
  OR (kind = 'CLEARED' AND in_time IS NULL AND out_time IS NULL AND status IS NULL)
);
ALTER TABLE "manual_attendance_entries" ADD CONSTRAINT "manual_attendance_entries_upload_via" CHECK ((via = 'MUSTER_UPLOAD') = (upload_id IS NOT NULL));

-- Append-only: a correction is a new entry, never an edit. Deletion only by
-- the test suite's fixture purge in a dev-marked database (the same
-- exception as audit_logs and raw_punches).
CREATE OR REPLACE FUNCTION manual_attendance_entries_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MANUAL_ENTRY_APPEND_ONLY: manual attendance entries are never changed or deleted; enter a correction instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER manual_attendance_entries_append_only
  BEFORE UPDATE OR DELETE ON "manual_attendance_entries"
  FOR EACH ROW EXECUTE FUNCTION manual_attendance_entries_append_only();

CREATE TRIGGER manual_attendance_entries_no_truncate
  BEFORE TRUNCATE ON "manual_attendance_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION manual_attendance_entries_append_only();

-- The daily "still not marked" reminder hour (IST), read when the scheduler starts.
INSERT INTO system_settings (key, value, updated_at)
VALUES ('attendance.manualReminderHour', '18', now())
ON CONFLICT (key) DO NOTHING;
