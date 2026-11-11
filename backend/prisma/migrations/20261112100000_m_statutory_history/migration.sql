-- M session, ER-11: a masked history of statutory numbers (no ciphertext, no hash). Forward-only.
CREATE TABLE "employee_statutory_history" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "changed_fields" TEXT[],
    "pan_last4" TEXT,
    "aadhaar_last4" TEXT,
    "uan_last4" TEXT,
    "esi_last4" TEXT,
    "changed_by_user_id" TEXT,
    "changed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_statutory_history_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employee_statutory_history_kind" CHECK ("kind" IN ('RECORDED_BEFORE', 'CREATED', 'CHANGED'))
);
CREATE INDEX "employee_statutory_history_employee_id_changed_at_idx" ON "employee_statutory_history"("employee_id", "changed_at");
ALTER TABLE "employee_statutory_history" ADD CONSTRAINT "employee_statutory_history_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION employee_statutory_history_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'STATUTORY_HISTORY_APPEND_ONLY: statutory history is never changed or removed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_statutory_history_append_only" BEFORE UPDATE OR DELETE ON "employee_statutory_history" FOR EACH ROW EXECUTE FUNCTION employee_statutory_history_append_only();

-- What changed is judged by the PAN and Aadhaar keyed hashes and by the UAN and ESI last four digits (they have no hash). A key rotation rewrites
-- ciphertext only and so records nothing; a new UAN or ESI number with the same last four digits as the old one is not seen (documented limit).
CREATE OR REPLACE FUNCTION employee_statutory_record_history() RETURNS trigger AS $$
DECLARE
  fields TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."pan_hash" IS NOT NULL THEN fields := array_append(fields, 'PAN'); END IF;
    IF NEW."aadhaar_hash" IS NOT NULL THEN fields := array_append(fields, 'AADHAAR'); END IF;
    IF NEW."uan_last4" IS NOT NULL THEN fields := array_append(fields, 'UAN'); END IF;
    IF NEW."esi_last4" IS NOT NULL THEN fields := array_append(fields, 'ESI'); END IF;
  ELSE
    IF NEW."pan_hash" IS DISTINCT FROM OLD."pan_hash" THEN fields := array_append(fields, 'PAN'); END IF;
    IF NEW."aadhaar_hash" IS DISTINCT FROM OLD."aadhaar_hash" THEN fields := array_append(fields, 'AADHAAR'); END IF;
    IF NEW."uan_last4" IS DISTINCT FROM OLD."uan_last4" THEN fields := array_append(fields, 'UAN'); END IF;
    IF NEW."esi_last4" IS DISTINCT FROM OLD."esi_last4" THEN fields := array_append(fields, 'ESI'); END IF;
    IF cardinality(fields) = 0 THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO "employee_statutory_history" ("id", "employee_id", "kind", "changed_fields", "pan_last4", "aadhaar_last4", "uan_last4", "esi_last4", "changed_by_user_id")
  VALUES (gen_random_uuid()::text, NEW."employee_id", CASE WHEN TG_OP = 'INSERT' THEN 'CREATED' ELSE 'CHANGED' END, fields,
          NEW."pan_last4", NEW."aadhaar_last4", NEW."uan_last4", NEW."esi_last4", NEW."updated_by_user_id");
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_statutory_record_history" AFTER INSERT OR UPDATE ON "employee_statutory" FOR EACH ROW EXECUTE FUNCTION employee_statutory_record_history();

-- What is on file today becomes the first entry, so the history starts from what the company already holds.
INSERT INTO "employee_statutory_history" ("id", "employee_id", "kind", "changed_fields", "pan_last4", "aadhaar_last4", "uan_last4", "esi_last4", "changed_by_user_id", "changed_at")
SELECT gen_random_uuid()::text, s."employee_id", 'RECORDED_BEFORE', ARRAY[]::TEXT[], s."pan_last4", s."aadhaar_last4", s."uan_last4", s."esi_last4", s."updated_by_user_id", s."updated_at"
FROM "employee_statutory" s;
