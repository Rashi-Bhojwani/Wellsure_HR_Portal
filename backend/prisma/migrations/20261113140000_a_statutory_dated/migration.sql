-- A1 (docs/plans/A_PART3.md; owner decision 2026-11-13): statutory identifiers effective-dated for payroll. A copy of what payroll reads (PAN last four; UAN and ESI as
-- stored, sealed, with their last fours) and the day it took effect, written by a trigger on every write to employee_statutory so every write path is covered.
-- A change is recorded when the PAN hash or any last four changes, or a UAN/ESI appears or disappears (UAN and ESI have no keyed hash).
-- Rows are never deleted or changed, except that key rotation may re-encrypt the sealed columns (nothing else may change).
CREATE TABLE "employee_statutory_dated" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "pan_hash" TEXT,
    "pan_last4" TEXT,
    "uan_encrypted" BYTEA,
    "uan_last4" TEXT,
    "esi_encrypted" BYTEA,
    "esi_last4" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT "employee_statutory_dated_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_statutory_dated_employee_id_effective_from_idx" ON "employee_statutory_dated"("employee_id", "effective_from");

CREATE FUNCTION employee_statutory_dated_record() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.pan_hash IS NOT DISTINCT FROM OLD.pan_hash AND NEW.pan_last4 IS NOT DISTINCT FROM OLD.pan_last4
     AND NEW.uan_last4 IS NOT DISTINCT FROM OLD.uan_last4 AND NEW.esi_last4 IS NOT DISTINCT FROM OLD.esi_last4
     AND (NEW.uan_encrypted IS NULL) = (OLD.uan_encrypted IS NULL) AND (NEW.esi_encrypted IS NULL) = (OLD.esi_encrypted IS NULL) THEN
    RETURN NEW; -- nothing payroll reads changed (for example a re-encryption under a new key, or an Aadhaar change)
  END IF;
  INSERT INTO employee_statutory_dated (id, employee_id, effective_from, pan_hash, pan_last4, uan_encrypted, uan_last4, esi_encrypted, esi_last4)
  VALUES ('esd_' || md5(random()::text || clock_timestamp()::text), NEW.employee_id, (now() AT TIME ZONE 'Asia/Kolkata')::date, NEW.pan_hash, NEW.pan_last4, NEW.uan_encrypted, NEW.uan_last4, NEW.esi_encrypted, NEW.esi_last4);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employee_statutory_dated_record AFTER INSERT OR UPDATE ON "employee_statutory" FOR EACH ROW EXECUTE FUNCTION employee_statutory_dated_record();

CREATE FUNCTION employee_statutory_dated_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  IF TG_OP = 'UPDATE' AND NEW.id = OLD.id AND NEW.employee_id = OLD.employee_id AND NEW.effective_from = OLD.effective_from
     AND NEW.pan_hash IS NOT DISTINCT FROM OLD.pan_hash AND NEW.pan_last4 IS NOT DISTINCT FROM OLD.pan_last4
     AND NEW.uan_last4 IS NOT DISTINCT FROM OLD.uan_last4 AND NEW.esi_last4 IS NOT DISTINCT FROM OLD.esi_last4 AND NEW.recorded_at = OLD.recorded_at
     AND (NEW.uan_encrypted IS NULL) = (OLD.uan_encrypted IS NULL) AND (NEW.esi_encrypted IS NULL) = (OLD.esi_encrypted IS NULL) THEN
    RETURN NEW; -- key rotation re-encrypting the sealed columns
  END IF;
  RAISE EXCEPTION 'STATUTORY_DATED_IMMUTABLE: a dated statutory record is never changed or deleted (only re-encrypted)';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER employee_statutory_dated_guard BEFORE UPDATE OR DELETE ON "employee_statutory_dated" FOR EACH ROW EXECUTE FUNCTION employee_statutory_dated_guard();

-- Backfill: what each person holds today, in force from the start (the first value known applies backwards).
INSERT INTO employee_statutory_dated (id, employee_id, effective_from, pan_hash, pan_last4, uan_encrypted, uan_last4, esi_encrypted, esi_last4)
SELECT 'esd_' || md5(s.id || 'backfill'), s.employee_id, DATE '1900-01-01', s.pan_hash, s.pan_last4, s.uan_encrypted, s.uan_last4, s.esi_encrypted, s.esi_last4 FROM employee_statutory s;
