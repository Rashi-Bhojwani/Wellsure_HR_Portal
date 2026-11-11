-- A-10 G4 (docs/plans/GREYTHR_PARITY_WORKFORCE.md items 9b, 10): a holiday limited to some locations, and a weekend override for chosen people over a date range.
-- Both append-only. A holiday with no scope row (or an empty list) is company-wide, as before. None seeded.
CREATE TABLE "holiday_location_scopes" (
    "id" TEXT NOT NULL,
    "holiday_id" TEXT NOT NULL,
    "location_ids" TEXT[] NOT NULL,
    "reason" TEXT NOT NULL,
    "set_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "holiday_location_scopes_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "holiday_location_scopes_holiday_id_created_at_idx" ON "holiday_location_scopes"("holiday_id", "created_at");
CREATE FUNCTION holiday_location_scopes_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'HOLIDAY_SCOPE_APPEND_ONLY: a holiday''s locations are changed by adding a row, never by editing or deleting one';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER holiday_location_scopes_guard BEFORE UPDATE OR DELETE ON "holiday_location_scopes" FOR EACH ROW EXECUTE FUNCTION holiday_location_scopes_append_only();

CREATE TABLE "weekend_overrides" (
    "id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "week_off_pattern_id" TEXT NOT NULL,
    "employee_ids" TEXT[] NOT NULL,
    "segment_name" TEXT,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" TEXT,
    "void_reason" TEXT,
    CONSTRAINT "weekend_overrides_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "weekend_overrides_range" CHECK ("from_date" <= "to_date"),
    CONSTRAINT "weekend_overrides_people" CHECK (cardinality("employee_ids") > 0),
    CONSTRAINT "weekend_overrides_void_whole" CHECK (("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL))
);
CREATE INDEX "weekend_overrides_to_date_idx" ON "weekend_overrides"("to_date");
ALTER TABLE "weekend_overrides" ADD CONSTRAINT "weekend_overrides_week_off_pattern_id_fkey" FOREIGN KEY ("week_off_pattern_id") REFERENCES "week_off_patterns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION weekend_overrides_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'WEEKEND_OVERRIDE_APPEND_ONLY: a weekend override is never deleted; void it';
  END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR NEW.from_date IS DISTINCT FROM OLD.from_date OR NEW.to_date IS DISTINCT FROM OLD.to_date OR NEW.week_off_pattern_id IS DISTINCT FROM OLD.week_off_pattern_id
     OR NEW.employee_ids IS DISTINCT FROM OLD.employee_ids OR NEW.segment_name IS DISTINCT FROM OLD.segment_name OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'WEEKEND_OVERRIDE_APPEND_ONLY: a weekend override is only ever voided, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER weekend_overrides_guard BEFORE UPDATE OR DELETE ON "weekend_overrides" FOR EACH ROW EXECUTE FUNCTION weekend_overrides_guard();

-- A-10 G4 (item 11): a leave type reviewer. A director names a person (who already holds leave.approve) who may also decide requests of one leave type,
-- for everyone or for the people placed at a location and/or in a department. Voided once, never deleted. None seeded.
CREATE TABLE "leave_type_reviewers" (
    "id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "reviewer_employee_id" TEXT NOT NULL,
    "location_id" TEXT,
    "department_id" TEXT,
    "reason" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" TEXT,
    "void_reason" TEXT,
    CONSTRAINT "leave_type_reviewers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "leave_type_reviewers_void_whole" CHECK (("voided_at" IS NULL AND "voided_by_user_id" IS NULL AND "void_reason" IS NULL) OR ("voided_at" IS NOT NULL AND "voided_by_user_id" IS NOT NULL AND "void_reason" IS NOT NULL))
);
CREATE INDEX "leave_type_reviewers_reviewer_employee_id_idx" ON "leave_type_reviewers"("reviewer_employee_id");
ALTER TABLE "leave_type_reviewers" ADD CONSTRAINT "leave_type_reviewers_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_type_reviewers" ADD CONSTRAINT "leave_type_reviewers_reviewer_employee_id_fkey" FOREIGN KEY ("reviewer_employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION leave_type_reviewers_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'LEAVE_REVIEWER_APPEND_ONLY: a reviewer is never deleted; void it';
  END IF;
  IF OLD.voided_at IS NOT NULL OR NEW.voided_at IS NULL
     OR NEW.leave_type_id IS DISTINCT FROM OLD.leave_type_id OR NEW.reviewer_employee_id IS DISTINCT FROM OLD.reviewer_employee_id
     OR NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.department_id IS DISTINCT FROM OLD.department_id OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'LEAVE_REVIEWER_APPEND_ONLY: a reviewer is only ever voided, once';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leave_type_reviewers_guard BEFORE UPDATE OR DELETE ON "leave_type_reviewers" FOR EACH ROW EXECUTE FUNCTION leave_type_reviewers_guard();
