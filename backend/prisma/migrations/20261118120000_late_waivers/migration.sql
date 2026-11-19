-- Lateness rule (docs/plans/LATE_CHECKLIST.md §5): a manager asks HR to waive one late arrival. Maker-checker in the database too: the person who
-- decides is never the person who asked. At most one open or approved waiver per employee-day. A decided waiver never changes. Forward-only.
CREATE TABLE "late_waivers" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "date" DATE NOT NULL,
  "reason" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "requested_by_user_id" TEXT NOT NULL,
  "decided_by_user_id" TEXT,
  "decided_at" TIMESTAMPTZ(3),
  "decision_note" TEXT,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "late_waivers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "late_waivers_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN')),
  CONSTRAINT "late_waivers_reason_given" CHECK (length(btrim("reason")) >= 3),
  CONSTRAINT "late_waivers_decided" CHECK (("status" IN ('PENDING', 'WITHDRAWN')) = ("decided_by_user_id" IS NULL)),
  CONSTRAINT "late_waivers_not_own" CHECK ("decided_by_user_id" IS NULL OR "decided_by_user_id" <> "requested_by_user_id"),
  CONSTRAINT "late_waivers_reject_reason" CHECK ("status" <> 'REJECTED' OR length(btrim(coalesce("decision_note", ''))) >= 3)
);
CREATE INDEX "late_waivers_employee_id_date_idx" ON "late_waivers"("employee_id", "date");
CREATE INDEX "late_waivers_status_idx" ON "late_waivers"("status");
CREATE UNIQUE INDEX "late_waivers_one_open" ON "late_waivers"("employee_id", "date") WHERE "status" IN ('PENDING', 'APPROVED');
ALTER TABLE "late_waivers" ADD CONSTRAINT "late_waivers_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION late_waiver_decided_fixed() RETURNS trigger AS $$
BEGIN
  IF OLD."status" <> 'PENDING' THEN RAISE EXCEPTION 'LATE_WAIVER_DECIDED: a decided lateness waiver is never changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "late_waivers_decided_fixed" BEFORE UPDATE ON "late_waivers" FOR EACH ROW EXECUTE FUNCTION late_waiver_decided_fixed();
