-- Phase 6, P6-5 (docs/plans/PHASE_6.md §14H): payslips, the bank file, the statutory outputs.
--   payslips                  immutable; only against a final run, only before that run's payslips were published (one publish per run)
--   payslip_deliveries        bookkeeping (PDF, notice, email); mutable by design, never content
--   bank_transfer_batches     one per final run; only GENERATED -> PAID and the bank's response may change afterwards
--   bank_transfer_rows        append-only; no account number, only its hash, last four and IFSC
--   payroll_outputs           append-only record of a generated statutory file or the register
--   payroll_run_releases      a release now needs the thing it releases to exist

-- CreateEnum
CREATE TYPE "BankBatchStatus" AS ENUM ('GENERATED', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollOutputKind" AS ENUM ('PF_ECR', 'ESI', 'PT', 'LWF', 'SALARY_REGISTER');

-- CreateTable
CREATE TABLE "payslips" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_item_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "cycle_label" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "cycle_end" DATE NOT NULL,
    "content" JSONB NOT NULL,
    "content_hash" TEXT NOT NULL,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_by_user_id" TEXT NOT NULL,

    CONSTRAINT "payslips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payslip_deliveries" (
    "id" TEXT NOT NULL,
    "payslip_id" TEXT NOT NULL,
    "file_key" TEXT,
    "file_sha256" TEXT,
    "rendered_at" TIMESTAMPTZ(3),
    "render_error" TEXT,
    "notified_at" TIMESTAMPTZ(3),
    "email_status" TEXT,
    "email_to" TEXT,
    "email_error" TEXT,
    "email_attempted_at" TIMESTAMPTZ(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payslip_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfer_batches" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_hash" TEXT NOT NULL,
    "status" "BankBatchStatus" NOT NULL DEFAULT 'GENERATED',
    "payment_date" DATE NOT NULL,
    "template_version" INTEGER NOT NULL,
    "template_hash" TEXT NOT NULL,
    "row_count" INTEGER NOT NULL,
    "total" DECIMAL(20,6) NOT NULL,
    "excluded" JSONB NOT NULL DEFAULT '[]',
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "paid_on" DATE,
    "paid_by_user_id" TEXT,
    "bank_reference" TEXT,
    "response_key" TEXT,
    "response_file_name" TEXT,
    "response_sha256" TEXT,
    "response_attached_by_user_id" TEXT,
    "response_attached_at" TIMESTAMPTZ(3),

    CONSTRAINT "bank_transfer_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_transfer_rows" (
    "id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "account_hash" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "narration" TEXT NOT NULL,
    "serial" INTEGER NOT NULL,

    CONSTRAINT "bank_transfer_rows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_outputs" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" "PayrollOutputKind" NOT NULL,
    "run_hash" TEXT NOT NULL,
    "template_version" INTEGER,
    "template_hash" TEXT,
    "row_count" INTEGER NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "generated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_item_id_key" ON "payslips"("run_item_id");

-- CreateIndex
CREATE INDEX "payslips_employee_id_cycle_start_idx" ON "payslips"("employee_id", "cycle_start");

-- CreateIndex
CREATE UNIQUE INDEX "payslips_run_id_employee_id_key" ON "payslips"("run_id", "employee_id");

-- CreateIndex
CREATE UNIQUE INDEX "payslip_deliveries_payslip_id_key" ON "payslip_deliveries"("payslip_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfer_batches_run_id_key" ON "bank_transfer_batches"("run_id");

-- CreateIndex
CREATE UNIQUE INDEX "bank_transfer_rows_batch_id_employee_id_key" ON "bank_transfer_rows"("batch_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_outputs_run_id_kind_idx" ON "payroll_outputs"("run_id", "kind");

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_run_item_id_fkey" FOREIGN KEY ("run_item_id") REFERENCES "payroll_run_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payslip_deliveries" ADD CONSTRAINT "payslip_deliveries_payslip_id_fkey" FOREIGN KEY ("payslip_id") REFERENCES "payslips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_batches" ADD CONSTRAINT "bank_transfer_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_rows" ADD CONSTRAINT "bank_transfer_rows_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "bank_transfer_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transfer_rows" ADD CONSTRAINT "bank_transfer_rows_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_outputs" ADD CONSTRAINT "payroll_outputs_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Payslips: append-only, final run only, once per run ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION payslips_guard() RETURNS trigger AS $$
DECLARE run_state "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'PAYSLIP_APPEND_ONLY: a published payslip is never removed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'PAYSLIP_APPEND_ONLY: a published payslip is never changed; correct it with an adjustment in the next run';
  END IF;
  SELECT status INTO run_state FROM payroll_runs WHERE id = NEW.run_id FOR SHARE;
  IF run_state IS DISTINCT FROM 'FINALISED' THEN RAISE EXCEPTION 'PAYSLIP_NEEDS_FINAL_RUN: payslips come only from a finalised run'; END IF;
  IF EXISTS (SELECT 1 FROM payroll_run_releases WHERE run_id = NEW.run_id AND kind = 'PAYSLIPS_PUBLISHED') THEN
    RAISE EXCEPTION 'PAYSLIPS_ALREADY_PUBLISHED: the payslips of this run were already published; correct with an adjustment in the next run';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payslips_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payslips" FOR EACH ROW EXECUTE FUNCTION payslips_guard();

-- ── Bank batches: one per final run; after generation only the paid mark and the bank's response may be written ──────────────
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
  IF (to_jsonb(NEW) - 'status' - 'paid_at' - 'paid_on' - 'paid_by_user_id' - 'bank_reference' - 'response_key' - 'response_file_name' - 'response_sha256' - 'response_attached_by_user_id' - 'response_attached_at')
     <> (to_jsonb(OLD) - 'status' - 'paid_at' - 'paid_on' - 'paid_by_user_id' - 'bank_reference' - 'response_key' - 'response_file_name' - 'response_sha256' - 'response_attached_by_user_id' - 'response_attached_at') THEN
    RAISE EXCEPTION 'BANK_BATCH_IMMUTABLE: the rows, the file and the figures of a bank batch never change';
  END IF;
  IF OLD.status = 'PAID' AND (NEW.status <> 'PAID' OR NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.bank_reference IS DISTINCT FROM OLD.bank_reference OR NEW.paid_on IS DISTINCT FROM OLD.paid_on) THEN
    RAISE EXCEPTION 'BANK_BATCH_PAID_ONCE: a batch is marked paid once';
  END IF;
  IF OLD.status = 'GENERATED' AND NEW.status = 'PAID' AND (NEW.paid_at IS NULL OR NEW.paid_by_user_id IS NULL OR length(btrim(coalesce(NEW.bank_reference, ''))) < 3 OR NEW.paid_on IS NULL) THEN
    RAISE EXCEPTION 'BANK_BATCH_PAID_NEEDS_REFERENCE: marking a batch paid needs who, when and the bank''s reference';
  END IF;
  IF OLD.response_key IS NOT NULL AND NEW.response_key IS DISTINCT FROM OLD.response_key THEN
    RAISE EXCEPTION 'BANK_BATCH_RESPONSE_ONCE: the bank''s response was already attached';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "bank_transfer_batches_guard" BEFORE INSERT OR UPDATE OR DELETE ON "bank_transfer_batches" FOR EACH ROW EXECUTE FUNCTION bank_transfer_batches_guard();

CREATE OR REPLACE FUNCTION payroll_p65_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'APPEND_ONLY: % is never changed or removed', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "bank_transfer_rows_guard" BEFORE INSERT OR UPDATE OR DELETE ON "bank_transfer_rows" FOR EACH ROW EXECUTE FUNCTION payroll_p65_append_only();
CREATE TRIGGER "payroll_outputs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_outputs" FOR EACH ROW EXECUTE FUNCTION payroll_p65_append_only();

-- ── A release needs the thing it releases ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION payroll_run_releases_guard() RETURNS trigger AS $$
DECLARE run_state "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'RELEASE_APPEND_ONLY: a release is never removed';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'RELEASE_APPEND_ONLY: a release is never changed';
  END IF;
  SELECT status INTO run_state FROM payroll_runs WHERE id = NEW.run_id FOR SHARE;
  IF run_state IS DISTINCT FROM 'FINALISED' THEN RAISE EXCEPTION 'RELEASE_NEEDS_FINAL_RUN: payslips and bank files come only from a finalised run'; END IF;
  IF NEW.kind = 'PAYSLIPS_PUBLISHED' AND NOT EXISTS (SELECT 1 FROM payslips WHERE run_id = NEW.run_id) THEN
    RAISE EXCEPTION 'RELEASE_NEEDS_PAYSLIPS: payslips are published only when they exist';
  END IF;
  IF NEW.kind = 'BANK_FILE_GENERATED' AND NOT EXISTS (SELECT 1 FROM bank_transfer_batches WHERE run_id = NEW.run_id) THEN
    RAISE EXCEPTION 'RELEASE_NEEDS_BATCH: a bank file is released only when its batch exists';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── Never emptied ───────────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE TRIGGER payslips_no_truncate BEFORE TRUNCATE ON "payslips" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
CREATE TRIGGER bank_transfer_batches_no_truncate BEFORE TRUNCATE ON "bank_transfer_batches" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
CREATE TRIGGER bank_transfer_rows_no_truncate BEFORE TRUNCATE ON "bank_transfer_rows" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
CREATE TRIGGER payroll_outputs_no_truncate BEFORE TRUNCATE ON "payroll_outputs" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
