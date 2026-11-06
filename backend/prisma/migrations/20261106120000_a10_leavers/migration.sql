-- A-10 G6 (docs/plans/GREYTHR_PARITY_WORKFORCE.md item 15): the record that a leaver's leave was recalculated to their last working day. Append-only.
CREATE TABLE "leaver_leave_recalcs" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "separation_id" TEXT NOT NULL,
    "last_working_date" DATE NOT NULL,
    "actions" INTEGER NOT NULL,
    "done_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "leaver_leave_recalcs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "leaver_leave_recalcs_employee_id_idx" ON "leaver_leave_recalcs"("employee_id");
ALTER TABLE "leaver_leave_recalcs" ADD CONSTRAINT "leaver_leave_recalcs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leaver_leave_recalcs" ADD CONSTRAINT "leaver_leave_recalcs_separation_id_fkey" FOREIGN KEY ("separation_id") REFERENCES "separations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE FUNCTION leaver_leave_recalcs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'LEAVER_RECALC_APPEND_ONLY: a leaver recalculation record is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER leaver_leave_recalcs_guard BEFORE UPDATE OR DELETE ON "leaver_leave_recalcs" FOR EACH ROW EXECUTE FUNCTION leaver_leave_recalcs_append_only();
