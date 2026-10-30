-- Stage 4: the Monthly Inputs ledger and the import batches (docs/plans/STAGE_4_PLAN.md). Append-only; only a Super Admin writes the ledger.
CREATE TYPE "MonthlyInputBatchStatus" AS ENUM ('PREVIEW', 'APPLIED', 'DISCARDED');

CREATE TABLE "payroll_monthly_inputs" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "component_code" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "amount" DECIMAL(20,6),
    "cleared" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT NOT NULL,
    "entered_by_user_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_monthly_inputs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_monthly_inputs_cycle_start_component_code_idx" ON "payroll_monthly_inputs"("cycle_start", "component_code");
CREATE INDEX "payroll_monthly_inputs_employee_id_cycle_start_component_co_idx" ON "payroll_monthly_inputs"("employee_id", "cycle_start", "component_code", "created_at");
-- A figure is zero or more, and a cleared cell carries none: exactly one of the two.
ALTER TABLE "payroll_monthly_inputs" ADD CONSTRAINT "payroll_monthly_inputs_amount_check" CHECK ((cleared AND amount IS NULL) OR (NOT cleared AND amount IS NOT NULL AND amount >= 0));
ALTER TABLE "payroll_monthly_inputs" ADD CONSTRAINT "payroll_monthly_inputs_reason_check" CHECK (length(btrim("reason")) >= 3);

CREATE TABLE "payroll_input_batches" (
    "id" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "status" "MonthlyInputBatchStatus" NOT NULL DEFAULT 'PREVIEW',
    "parsed" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "skip_invalid" BOOLEAN NOT NULL DEFAULT false,
    "uploaded_by_user_id" TEXT NOT NULL,
    "applied_by_user_id" TEXT,
    "applied_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payroll_input_batches_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "payroll_input_batches_file_hash_idx" ON "payroll_input_batches"("file_hash");
-- The same file is applied once, whatever the code does.
CREATE UNIQUE INDEX "payroll_input_batches_applied_hash_key" ON "payroll_input_batches"("file_hash") WHERE "status" = 'APPLIED';

CREATE OR REPLACE FUNCTION payroll_monthly_inputs_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'MONTHLY_INPUTS_APPEND_ONLY: a monthly input is never changed or deleted; enter a new figure instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_monthly_inputs_append_only BEFORE UPDATE OR DELETE ON "payroll_monthly_inputs" FOR EACH ROW EXECUTE FUNCTION payroll_monthly_inputs_append_only();
CREATE TRIGGER payroll_monthly_inputs_no_truncate BEFORE TRUNCATE ON "payroll_monthly_inputs" FOR EACH STATEMENT EXECUTE FUNCTION payroll_monthly_inputs_append_only();

CREATE OR REPLACE FUNCTION payroll_monthly_inputs_director_only() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "user_roles" ur JOIN "roles" r ON r."id" = ur."role_id" WHERE ur."user_id" = NEW."entered_by_user_id" AND r."code" = 'SUPER_ADMIN') THEN
    RAISE EXCEPTION 'MONTHLY_INPUTS_DIRECTORS_ONLY: only a Super Admin enters a monthly input';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_monthly_inputs_director_only BEFORE INSERT ON "payroll_monthly_inputs" FOR EACH ROW EXECUTE FUNCTION payroll_monthly_inputs_director_only();

-- A batch can change only while it is a preview (to applied or discarded); an applied or discarded batch is final and none is deleted.
CREATE OR REPLACE FUNCTION payroll_input_batches_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'INPUT_BATCHES_APPEND_ONLY: an import batch is never deleted';
  END IF;
  IF OLD."status" <> 'PREVIEW' THEN RAISE EXCEPTION 'INPUT_BATCHES_FINAL: an applied or discarded import batch is not changed'; END IF;
  IF NEW."file_hash" <> OLD."file_hash" OR NEW."parsed"::text <> OLD."parsed"::text THEN RAISE EXCEPTION 'INPUT_BATCHES_FINAL: the file and what was read from it are not changed'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER payroll_input_batches_guard BEFORE UPDATE OR DELETE ON "payroll_input_batches" FOR EACH ROW EXECUTE FUNCTION payroll_input_batches_guard();
