-- M session block 2, AT-36: work-from-home requests. An employee in an eligible department asks for days; a director approves, which writes
-- remote marks through the existing director path (attendance/remote). Off until two directors turn it on. Forward-only.
CREATE TABLE "wfh_requests" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "from_date" DATE NOT NULL,
  "to_date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "decided_by_user_id" TEXT,
  "decided_at" TIMESTAMPTZ(3),
  "decision_note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "wfh_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "wfh_requests_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "wfh_requests_range" CHECK ("to_date" >= "from_date"),
  CONSTRAINT "wfh_requests_reason_given" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "wfh_requests_decided" CHECK (("status" = 'PENDING') = ("decided_at" IS NULL)),
  CONSTRAINT "wfh_requests_reject_reason" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3)
);
CREATE INDEX "wfh_requests_employee_id_from_date_idx" ON "wfh_requests"("employee_id", "from_date");
CREATE INDEX "wfh_requests_status_idx" ON "wfh_requests"("status");
ALTER TABLE "wfh_requests" ADD CONSTRAINT "wfh_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION m_wfh_decided_fixed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'WFH_DECIDED: a decided work-from-home request is never changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "wfh_requests_decided_fixed" BEFORE UPDATE ON "wfh_requests" FOR EACH ROW EXECUTE FUNCTION m_wfh_decided_fixed();
