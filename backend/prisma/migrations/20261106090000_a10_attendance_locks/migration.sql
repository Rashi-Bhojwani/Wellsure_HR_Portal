-- A-10 G3 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 7): attendance activity locks. A director locks chosen activities for a date range, from an effective
-- date, for everyone or a snapshot of a saved segment. Never deleted; the only change allowed is voiding it once (with who and why). None seeded.
CREATE TABLE "attendance_locks" (
    "id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "categories" TEXT[] NOT NULL,
    "employee_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "segment_name" TEXT,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" TEXT,
    "void_reason" TEXT,
    CONSTRAINT "attendance_locks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendance_locks_range" CHECK ("from_date" <= "to_date"),
    CONSTRAINT "attendance_locks_categories" CHECK (cardinality("categories") > 0),
    CONSTRAINT "attendance_locks_void_whole" CHECK (("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL))
);
CREATE INDEX "attendance_locks_to_date_idx" ON "attendance_locks"("to_date");

CREATE FUNCTION attendance_locks_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ATTENDANCE_LOCK_APPEND_ONLY: a lock is never deleted; void it';
  END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.from_date IS DISTINCT FROM OLD.from_date OR NEW.to_date IS DISTINCT FROM OLD.to_date
     OR NEW.categories IS DISTINCT FROM OLD.categories OR NEW.employee_ids IS DISTINCT FROM OLD.employee_ids OR NEW.segment_name IS DISTINCT FROM OLD.segment_name
     OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'ATTENDANCE_LOCK_APPEND_ONLY: a lock is only ever voided, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER attendance_locks_guard BEFORE UPDATE OR DELETE ON "attendance_locks" FOR EACH ROW EXECUTE FUNCTION attendance_locks_guard();
