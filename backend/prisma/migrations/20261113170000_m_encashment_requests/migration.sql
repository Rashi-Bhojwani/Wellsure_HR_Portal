-- M session block 2, LV-23: an employee asks to encash leave during the year. Off until two directors turn it on. A director approves; the
-- approved days wait for payroll, which pays them and records them in the leave ledger (Session A: request). Nothing here moves money or the
-- ledger. Forward-only.
CREATE TABLE "leave_encashment_requests" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "leave_type_id" TEXT NOT NULL,
  "leave_year" INTEGER NOT NULL,
  "days" DECIMAL(5,1) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by_user_id" TEXT,
  "decided_at" TIMESTAMPTZ(3),
  "decision_note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "leave_encashment_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "leave_encashment_requests_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "leave_encashment_requests_days" CHECK ("days" > 0 AND "days" * 2 = round("days" * 2)),
  CONSTRAINT "leave_encashment_requests_decided" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL)),
  CONSTRAINT "leave_encashment_requests_reject_reason" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3)
);
CREATE INDEX "leave_encashment_requests_employee_id_leave_year_idx" ON "leave_encashment_requests"("employee_id", "leave_year");
CREATE INDEX "leave_encashment_requests_status_idx" ON "leave_encashment_requests"("status");
ALTER TABLE "leave_encashment_requests" ADD CONSTRAINT "leave_encashment_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "leave_encashment_requests" ADD CONSTRAINT "leave_encashment_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION m_encashment_decided_fixed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'ENCASHMENT_DECIDED: a decided encashment request is never changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "leave_encashment_requests_decided_fixed" BEFORE UPDATE ON "leave_encashment_requests" FOR EACH ROW EXECUTE FUNCTION m_encashment_decided_fixed();
