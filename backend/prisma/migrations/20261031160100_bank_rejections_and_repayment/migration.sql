-- Stage 5b: rows the bank rejected, and the repayment batches that pay them again. Append-only; only a Super Admin writes a rejection, a plan or a batch.
CREATE TABLE "bank_return_imports" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "rejected_count" INTEGER NOT NULL,
    "imported_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_return_imports_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_return_imports_batch_id_file_sha256_key" ON "bank_return_imports"("batch_id", "file_sha256");
ALTER TABLE "bank_return_imports" ADD CONSTRAINT "bank_return_imports_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bank_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bank_row_rejections" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "row_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "import_id" TEXT,
    "recorded_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_row_rejections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_row_rejections_row_id_key" ON "bank_row_rejections"("row_id");
CREATE INDEX "bank_row_rejections_batch_id_idx" ON "bank_row_rejections"("batch_id");
ALTER TABLE "bank_row_rejections" ADD CONSTRAINT "bank_row_rejections_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bank_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_row_rejections" ADD CONSTRAINT "bank_row_rejections_row_id_fkey" FOREIGN KEY ("row_id") REFERENCES "bank_transfer_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_row_rejections" ADD CONSTRAINT "bank_row_rejections_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "bank_return_imports"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_row_rejections" ADD CONSTRAINT "bank_row_rejections_source_check" CHECK ("source" IN ('ENTERED', 'RETURN_FILE'));
ALTER TABLE "bank_row_rejections" ADD CONSTRAINT "bank_row_rejections_reason_check" CHECK (length(btrim("reason")) >= 3);

-- A plan to pay rejected rows again: the rows, the date, who proposed it. The approval is bound to a hash of what the plan would write.
CREATE TABLE "bank_repayment_plans" (
    "id" TEXT NOT NULL,
    "original_batch_id" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "row_ids" JSONB NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_repayment_plans_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "bank_repayment_plans" ADD CONSTRAINT "bank_repayment_plans_original_batch_id_fkey" FOREIGN KEY ("original_batch_id") REFERENCES "bank_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bank_repayment_batches" (
    "id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "original_batch_id" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "template_version" INTEGER NOT NULL,
    "template_hash" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "total" DECIMAL(20,6) NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "bank_repayment_batches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "bank_repayment_batches_plan_id_key" ON "bank_repayment_batches"("plan_id");
ALTER TABLE "bank_repayment_batches" ADD CONSTRAINT "bank_repayment_batches_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "bank_repayment_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_repayment_batches" ADD CONSTRAINT "bank_repayment_batches_original_batch_id_fkey" FOREIGN KEY ("original_batch_id") REFERENCES "bank_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "bank_repayment_rows" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "source_row_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "account_hash" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "narration" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,
    CONSTRAINT "bank_repayment_rows_pkey" PRIMARY KEY ("id")
);
-- Nothing is paid twice: a rejected row can be in at most one repayment batch, whatever the code does.
CREATE UNIQUE INDEX "bank_repayment_rows_source_row_id_key" ON "bank_repayment_rows"("source_row_id");
CREATE UNIQUE INDEX "bank_repayment_rows_batch_id_serial_key" ON "bank_repayment_rows"("batch_id", "serial");
ALTER TABLE "bank_repayment_rows" ADD CONSTRAINT "bank_repayment_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bank_repayment_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_repayment_rows" ADD CONSTRAINT "bank_repayment_rows_source_row_id_fkey" FOREIGN KEY ("source_row_id") REFERENCES "bank_transfer_rows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_repayment_rows" ADD CONSTRAINT "bank_repayment_rows_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- ...and only a row the bank rejected.
CREATE OR REPLACE FUNCTION bank_repayment_row_rejected() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "bank_row_rejections" WHERE "row_id" = NEW."source_row_id") THEN
    RAISE EXCEPTION 'REPAYMENT_NOT_REJECTED: only a row the bank rejected can be paid again';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bank_repayment_rows_rejected BEFORE INSERT ON "bank_repayment_rows" FOR EACH ROW EXECUTE FUNCTION bank_repayment_row_rejected();

CREATE OR REPLACE FUNCTION bank_rejections_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'BANK_REJECTIONS_APPEND_ONLY: a bank rejection, a repayment plan, batch or row is never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bank_return_imports_append_only BEFORE UPDATE OR DELETE ON "bank_return_imports" FOR EACH ROW EXECUTE FUNCTION bank_rejections_append_only();
CREATE TRIGGER bank_row_rejections_append_only BEFORE UPDATE OR DELETE ON "bank_row_rejections" FOR EACH ROW EXECUTE FUNCTION bank_rejections_append_only();
CREATE TRIGGER bank_repayment_plans_append_only BEFORE UPDATE OR DELETE ON "bank_repayment_plans" FOR EACH ROW EXECUTE FUNCTION bank_rejections_append_only();
CREATE TRIGGER bank_repayment_batches_append_only BEFORE UPDATE OR DELETE ON "bank_repayment_batches" FOR EACH ROW EXECUTE FUNCTION bank_rejections_append_only();
CREATE TRIGGER bank_repayment_rows_append_only BEFORE UPDATE OR DELETE ON "bank_repayment_rows" FOR EACH ROW EXECUTE FUNCTION bank_rejections_append_only();

-- Only a Super Admin records a rejection or makes a plan.
CREATE OR REPLACE FUNCTION bank_rejections_director_only() RETURNS trigger AS $$
DECLARE actor TEXT;
BEGIN
  IF TG_TABLE_NAME = 'bank_row_rejections' THEN actor := NEW."recorded_by_user_id";
  ELSIF TG_TABLE_NAME = 'bank_return_imports' THEN actor := NEW."imported_by_user_id";
  ELSE actor := NEW."created_by_user_id"; END IF;
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = actor AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'BANK_REJECTIONS_DIRECTORS_ONLY: only a Super Admin records a bank rejection or plans a repayment';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER bank_row_rejections_director_only BEFORE INSERT ON "bank_row_rejections" FOR EACH ROW EXECUTE FUNCTION bank_rejections_director_only();
CREATE TRIGGER bank_return_imports_director_only BEFORE INSERT ON "bank_return_imports" FOR EACH ROW EXECUTE FUNCTION bank_rejections_director_only();
CREATE TRIGGER bank_repayment_plans_director_only BEFORE INSERT ON "bank_repayment_plans" FOR EACH ROW EXECUTE FUNCTION bank_rejections_director_only();
