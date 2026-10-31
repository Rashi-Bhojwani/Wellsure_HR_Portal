-- Bank payments are manual (decision D-34): there is no bank file coming back. The return-file import and the stored "response file" are removed;
-- rejected payments are entered by hand by a director. A director can note that a downloaded file was sent to the bank.

-- The bank's response columns go; the batch guard no longer mentions them.
CREATE OR REPLACE FUNCTION bank_transfer_batches_guard() RETURNS trigger AS $$
DECLARE run_state "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'BANK_BATCH_APPEND_ONLY: a bank batch is never removed';
  END IF;
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO run_state FROM payroll_runs WHERE id = NEW.run_id FOR SHARE;
    IF run_state IS DISTINCT FROM 'FINALISED' THEN RAISE EXCEPTION 'BANK_BATCH_NEEDS_FINAL_RUN: a bank file comes only from a finalised run'; END IF;
    IF NEW.status <> 'GENERATED' THEN RAISE EXCEPTION 'BANK_BATCH_STATE: a batch starts as generated'; END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'paid_at' - 'paid_on' - 'paid_by_user_id' - 'bank_reference')
     <> (to_jsonb(OLD) - 'status' - 'paid_at' - 'paid_on' - 'paid_by_user_id' - 'bank_reference') THEN
    RAISE EXCEPTION 'BANK_BATCH_IMMUTABLE: the rows, the file and the figures of a bank batch never change';
  END IF;
  IF OLD.status = 'PAID' AND (NEW.status <> 'PAID' OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference OR NEW.paid_on IS DISTINCT FROM OLD.paid_on) THEN
    RAISE EXCEPTION 'BANK_BATCH_PAID_ONCE: a batch is marked paid once';
  END IF;
  IF OLD.status = 'GENERATED' AND NEW.status = 'PAID' AND (NEW.paid_at IS NULL OR NEW.paid_by_user_id IS NULL OR length(btrim(coalesce(NEW.bank_reference, ''))) < 3 OR NEW.paid_on IS NULL) THEN
    RAISE EXCEPTION 'BANK_BATCH_PAID_NEEDS_REFERENCE: marking a batch paid needs who, when and the bank''s reference';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE "bank_transfer_batches"
  DROP COLUMN "response_key", DROP COLUMN "response_file_name", DROP COLUMN "response_sha256",
  DROP COLUMN "response_attached_by_user_id", DROP COLUMN "response_attached_at";

-- The return-file import goes, and the rejection rows no longer say where they came from (they are all entered by hand).
ALTER TABLE "bank_row_rejections" DROP COLUMN "import_id", DROP COLUMN "source";
DROP TABLE "bank_return_imports";

CREATE OR REPLACE FUNCTION bank_rejections_director_only() RETURNS trigger AS $$
DECLARE actor TEXT;
BEGIN
  IF TG_TABLE_NAME = 'bank_row_rejections' THEN actor := NEW."recorded_by_user_id";
  ELSIF TG_TABLE_NAME = 'bank_file_sent_marks' THEN actor := NEW."sent_by_user_id";
  ELSE actor := NEW."created_by_user_id"; END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = actor AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'BANK_REJECTIONS_DIRECTORS_ONLY: only a Super Admin records a bank rejection, plans a repayment or notes a file as sent';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- "Sent to bank": who and when, once per file, by a director only, never changed or removed.
CREATE TABLE "bank_file_sent_marks" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT,
    "repayment_batch_id" TEXT,
    "sent_by_user_id" TEXT NOT NULL,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,
    CONSTRAINT "bank_file_sent_marks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "bank_file_sent_marks_one_file" CHECK (num_nonnulls("batch_id", "repayment_batch_id") = 1)
);
CREATE UNIQUE INDEX "bank_file_sent_marks_batch_id_key" ON "bank_file_sent_marks"("batch_id");
CREATE UNIQUE INDEX "bank_file_sent_marks_repayment_batch_id_key" ON "bank_file_sent_marks"("repayment_batch_id");
ALTER TABLE "bank_file_sent_marks" ADD CONSTRAINT "bank_file_sent_marks_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bank_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_file_sent_marks" ADD CONSTRAINT "bank_file_sent_marks_repayment_batch_id_fkey" FOREIGN KEY ("repayment_batch_id") REFERENCES "bank_repayment_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER bank_file_sent_marks_append_only BEFORE UPDATE OR DELETE ON "bank_file_sent_marks" FOR EACH ROW EXECUTE FUNCTION bank_rejections_append_only();
CREATE TRIGGER bank_file_sent_marks_director_only BEFORE INSERT ON "bank_file_sent_marks" FOR EACH ROW EXECUTE FUNCTION bank_rejections_director_only();
