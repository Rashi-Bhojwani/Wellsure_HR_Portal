-- M session block 2, AT-19: overtime claims. Overtime is read from the attendance engine's result (daily_attendance.excess_minutes) under the
-- overtime policy in force (off until two directors turn it on); nothing here changes attendance. Paying approved overtime is payroll's
-- (a request to Session A). One claim per person and day while it waits or is approved. Forward-only.
CREATE TABLE "overtime_claims" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "minutes" INTEGER NOT NULL,
  "approved_minutes" INTEGER,
  "note" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by_user_id" TEXT,
  "decided_at" TIMESTAMPTZ(3),
  "decision_note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "overtime_claims_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "overtime_claims_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "overtime_claims_minutes_positive" CHECK ("minutes" > 0 AND ("approved_minutes" IS NULL OR "approved_minutes" >= 0)),
  CONSTRAINT "overtime_claims_decided" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL)),
  CONSTRAINT "overtime_claims_approved_has_minutes" CHECK (("status" = 'APPROVED') = ("approved_minutes" IS NOT NULL)),
  CONSTRAINT "overtime_claims_reject_reason" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3)
);
CREATE INDEX "overtime_claims_employee_id_date_idx" ON "overtime_claims"("employee_id", "date");
CREATE INDEX "overtime_claims_status_idx" ON "overtime_claims"("status");
CREATE UNIQUE INDEX "overtime_claims_one_live" ON "overtime_claims"("employee_id", "date") WHERE "status" IN ('PENDING', 'APPROVED');
ALTER TABLE "overtime_claims" ADD CONSTRAINT "overtime_claims_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION m_overtime_decided_fixed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'OVERTIME_DECIDED: a decided overtime claim is never changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "overtime_claims_decided_fixed" BEFORE UPDATE ON "overtime_claims" FOR EACH ROW EXECUTE FUNCTION m_overtime_decided_fixed();
