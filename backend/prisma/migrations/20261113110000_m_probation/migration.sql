-- M session block 2, ER-26: probation decisions. A person's probation ends on the joining date plus the policy's months (policy.probation), or on
-- the latest extension; HR confirms or extends with a reason. Append-only; never by the person on their own record (checked in the service).
-- Forward-only.
CREATE TABLE "employee_probation_decisions" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "extended_to" DATE,
  "reason" TEXT NOT NULL,
  "decided_by_user_id" TEXT NOT NULL,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_probation_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_probation_decisions_kind" CHECK ("kind" IN ('CONFIRMED', 'EXTENDED')),
  CONSTRAINT "employee_probation_decisions_extension_dated" CHECK (("kind" = 'EXTENDED') = ("extended_to" IS NOT NULL)),
  CONSTRAINT "employee_probation_decisions_reason_given" CHECK (length(btrim("reason")) >= 3)
);
CREATE INDEX "employee_probation_decisions_employee_id_created_at_idx" ON "employee_probation_decisions"("employee_id", "created_at");
ALTER TABLE "employee_probation_decisions" ADD CONSTRAINT "employee_probation_decisions_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION m_probation_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'PROBATION_APPEND_ONLY: a probation decision is never changed or removed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_probation_decisions_append_only" BEFORE UPDATE OR DELETE ON "employee_probation_decisions" FOR EACH ROW EXECUTE FUNCTION m_probation_append_only();
