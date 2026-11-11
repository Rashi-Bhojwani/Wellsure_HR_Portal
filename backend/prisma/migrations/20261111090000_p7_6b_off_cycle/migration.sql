-- P7-6b (docs/plans/P7_6_SETTLEMENTS.md): off-cycle runs, a pipeline of their own; ordinary runs are untouched. Immutable rows; test-only purge.
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'OFF_CYCLE_RUN';
ALTER TYPE "PayrollApprovalSubject" ADD VALUE 'OFF_CYCLE_BANK';
CREATE TYPE "OffCycleKind" AS ENUM ('SETTLEMENT', 'HELD_PAY');

CREATE TABLE "off_cycle_runs" (
    "id" TEXT NOT NULL,
    "kind" "OffCycleKind" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "lines" JSONB NOT NULL,
    "net" DECIMAL(14,2) NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "off_cycle_runs_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "off_cycle_runs_net" CHECK ("net" > 0)
);
CREATE INDEX "off_cycle_runs_employee_id_idx" ON "off_cycle_runs"("employee_id");
ALTER TABLE "off_cycle_runs" ADD CONSTRAINT "off_cycle_runs_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "off_cycle_finalisations" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "kind" "OffCycleKind" NOT NULL,
    "source_ref" TEXT NOT NULL,
    "statement" JSONB NOT NULL,
    "finalised_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "off_cycle_finalisations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "off_cycle_finalisations_run_id_key" ON "off_cycle_finalisations"("run_id");
CREATE UNIQUE INDEX "off_cycle_finalisations_kind_source_ref_key" ON "off_cycle_finalisations"("kind", "source_ref");
ALTER TABLE "off_cycle_finalisations" ADD CONSTRAINT "off_cycle_finalisations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "off_cycle_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "off_cycle_held_releases" (
    "id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "off_cycle_held_releases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "off_cycle_held_releases_item_id_key" ON "off_cycle_held_releases"("item_id");
ALTER TABLE "off_cycle_held_releases" ADD CONSTRAINT "off_cycle_held_releases_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "payroll_run_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "off_cycle_held_releases" ADD CONSTRAINT "off_cycle_held_releases_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "off_cycle_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "off_cycle_loan_recoveries" (
    "id" TEXT NOT NULL,
    "loan_id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "off_cycle_loan_recoveries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "off_cycle_loan_recoveries_amount" CHECK ("amount" > 0)
);
CREATE UNIQUE INDEX "off_cycle_loan_recoveries_loan_id_run_id_key" ON "off_cycle_loan_recoveries"("loan_id", "run_id");
ALTER TABLE "off_cycle_loan_recoveries" ADD CONSTRAINT "off_cycle_loan_recoveries_loan_id_fkey" FOREIGN KEY ("loan_id") REFERENCES "loans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "off_cycle_loan_recoveries" ADD CONSTRAINT "off_cycle_loan_recoveries_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "off_cycle_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "off_cycle_bank_batches" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "payment_date" DATE NOT NULL,
    "template_version" INTEGER NOT NULL,
    "template_hash" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "account_hash" TEXT NOT NULL,
    "account_last4" TEXT NOT NULL,
    "ifsc" TEXT NOT NULL,
    "file_key" TEXT NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_sha256" TEXT NOT NULL,
    "generated_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "off_cycle_bank_batches_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "off_cycle_bank_batches_run_id_key" ON "off_cycle_bank_batches"("run_id");
ALTER TABLE "off_cycle_bank_batches" ADD CONSTRAINT "off_cycle_bank_batches_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "off_cycle_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION off_cycle_immutable() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'OFF_CYCLE_IMMUTABLE: off-cycle records are never changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER off_cycle_runs_guard BEFORE UPDATE OR DELETE ON "off_cycle_runs" FOR EACH ROW EXECUTE FUNCTION off_cycle_immutable();
CREATE TRIGGER off_cycle_finalisations_guard BEFORE UPDATE OR DELETE ON "off_cycle_finalisations" FOR EACH ROW EXECUTE FUNCTION off_cycle_immutable();
CREATE TRIGGER off_cycle_held_releases_guard BEFORE UPDATE OR DELETE ON "off_cycle_held_releases" FOR EACH ROW EXECUTE FUNCTION off_cycle_immutable();
CREATE TRIGGER off_cycle_loan_recoveries_guard BEFORE UPDATE OR DELETE ON "off_cycle_loan_recoveries" FOR EACH ROW EXECUTE FUNCTION off_cycle_immutable();
CREATE TRIGGER off_cycle_bank_batches_guard BEFORE UPDATE OR DELETE ON "off_cycle_bank_batches" FOR EACH ROW EXECUTE FUNCTION off_cycle_immutable();

-- A downloaded off-cycle file can be marked sent to the bank, once, like the other two kinds of file.
ALTER TABLE "bank_file_sent_marks" ADD COLUMN "off_cycle_batch_id" TEXT;
CREATE UNIQUE INDEX "bank_file_sent_marks_off_cycle_batch_id_key" ON "bank_file_sent_marks"("off_cycle_batch_id");
ALTER TABLE "bank_file_sent_marks" ADD CONSTRAINT "bank_file_sent_marks_off_cycle_batch_id_fkey" FOREIGN KEY ("off_cycle_batch_id") REFERENCES "off_cycle_bank_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "bank_file_sent_marks" DROP CONSTRAINT "bank_file_sent_marks_one_file";
ALTER TABLE "bank_file_sent_marks" ADD CONSTRAINT "bank_file_sent_marks_one_file" CHECK (num_nonnulls("batch_id", "repayment_batch_id", "off_cycle_batch_id") = 1);

-- ── Adjustments an off-cycle run pays: consumed by that run (exactly one consumer: a regular run or an off-cycle run) ──────────────
ALTER TABLE "payroll_adjustments" ADD COLUMN "consumed_by_off_cycle_run_id" TEXT;
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_consumed_by_off_cycle_run_id_fkey" FOREIGN KEY ("consumed_by_off_cycle_run_id") REFERENCES "off_cycle_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payroll_adjustments_consumed_by_off_cycle_run_id_idx" ON "payroll_adjustments"("consumed_by_off_cycle_run_id");
ALTER TABLE "payroll_adjustments" DROP CONSTRAINT "payroll_adjustments_status_fields";
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_status_fields" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND (("status" = 'CONSUMED') = (num_nonnulls("consumed_by_run_id", "consumed_by_off_cycle_run_id") = 1))
  AND num_nonnulls("consumed_by_run_id", "consumed_by_off_cycle_run_id") <= 1
  AND ("status" = 'CANCELLED' OR "cancel_reason" IS NULL)
);

CREATE OR REPLACE FUNCTION payroll_adjustments_guard() RETURNS trigger AS $$
DECLARE
  finalising boolean := coalesce(current_setting('payroll.finalising', true), '') = 'yes';
  unlocking boolean := coalesce(current_setting('payroll.unlocking', true), '') = 'yes';
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: an adjustment is never deleted; cancel it';
  END IF;
  -- Unlocking a regular run hands back only what that run paid; what an off-cycle run paid is never handed back.
  IF OLD.status = 'CONSUMED' AND unlocking AND NEW.status = 'PENDING' AND NEW.consumed_by_run_id IS NULL AND OLD.consumed_by_off_cycle_run_id IS NULL
     AND (to_jsonb(NEW) - 'status' - 'consumed_by_run_id') = (to_jsonb(OLD) - 'status' - 'consumed_by_run_id') THEN
    RETURN NEW;
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: this adjustment is already % and cannot change', lower(OLD.status::text);
  END IF;
  IF NEW.status = 'CONSUMED' AND NOT finalising THEN
    RAISE EXCEPTION 'ADJUSTMENT_CONSUMED_BY_FINALISER_ONLY: an adjustment is marked paid only when a payroll run is finalised';
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'consumed_by_run_id' - 'consumed_by_off_cycle_run_id' - 'cancelled_at' - 'cancelled_by_user_id' - 'cancel_reason')
     = (to_jsonb(OLD) - 'status' - 'consumed_by_run_id' - 'consumed_by_off_cycle_run_id' - 'cancelled_at' - 'cancelled_by_user_id' - 'cancel_reason') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: the amount, reason and employee of an adjustment never change; cancel it and add another';
END;
$$ LANGUAGE plpgsql;
