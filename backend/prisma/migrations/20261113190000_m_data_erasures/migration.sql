-- M session block 2, AD-07: erasure of a former employee's data after the retention period (policy.retention, Not set until the directors choose).
-- One director proposes, a different director confirms, then it is done. Append-only record of what was erased. Forward-only.
CREATE TABLE "data_erasures" (
  "id" TEXT NOT NULL,
  "employee_id" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PROPOSED',
  "proposed_by_user_id" TEXT NOT NULL,
  "confirmed_by_user_id" TEXT,
  "items" INTEGER,
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "done_at" TIMESTAMPTZ(3),
  CONSTRAINT "data_erasures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "data_erasures_category" CHECK ("category" IN ('CONTACT', 'DOCUMENTS')),
  CONSTRAINT "data_erasures_status" CHECK ("status" IN ('PROPOSED', 'DONE')),
  CONSTRAINT "data_erasures_done" CHECK (("status" = 'DONE') = ("confirmed_by_user_id" IS NOT NULL AND "done_at" IS NOT NULL)),
  CONSTRAINT "data_erasures_other_director" CHECK ("confirmed_by_user_id" IS NULL OR "confirmed_by_user_id" <> "proposed_by_user_id")
);
CREATE INDEX "data_erasures_employee_id_idx" ON "data_erasures"("employee_id");
CREATE UNIQUE INDEX "data_erasures_one_open" ON "data_erasures"("employee_id", "category") WHERE "status" = 'PROPOSED';
ALTER TABLE "data_erasures" ADD CONSTRAINT "data_erasures_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION m_data_erasures_fixed() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND OLD."status" = 'PROPOSED' AND NEW."status" = 'DONE' AND NEW."employee_id" = OLD."employee_id" AND NEW."category" = OLD."category" AND NEW."proposed_by_user_id" = OLD."proposed_by_user_id" THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'DATA_ERASURE_FIXED: an erasure record only moves from proposed to done';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "data_erasures_fixed" BEFORE UPDATE OR DELETE ON "data_erasures" FOR EACH ROW EXECUTE FUNCTION m_data_erasures_fixed();
