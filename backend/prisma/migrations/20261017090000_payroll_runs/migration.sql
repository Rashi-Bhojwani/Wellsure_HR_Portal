-- CreateEnum
CREATE TYPE "SalaryRevisionKind" AS ENUM ('CHANGE', 'CANCEL_SCHEDULED');

-- CreateEnum
CREATE TYPE "PayrollRunStatus" AS ENUM ('NEW', 'CALCULATING', 'CALCULATED', 'FAILED', 'VOID', 'FINALISED');

-- CreateEnum
CREATE TYPE "PayrollItemStatus" AS ENUM ('PAYABLE', 'HELD', 'EXCLUDED');

-- CreateEnum
CREATE TYPE "PayrollLineKind" AS ENUM ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION', 'ROUNDING');

-- CreateEnum
CREATE TYPE "PayrollLineSource" AS ENUM ('COMPONENT', 'ADJUSTMENT', 'ARREARS', 'ENCASHMENT', 'PF', 'ESI', 'PT', 'LWF', 'NET_ROUNDING');

-- AlterEnum
ALTER TYPE "AdjustmentSource" ADD VALUE 'YEAR_END_ENCASHMENT';

-- AlterTable
ALTER TABLE "payroll_salary_revisions" ADD COLUMN     "kind" "SalaryRevisionKind" NOT NULL DEFAULT 'CHANGE';

-- CreateTable
CREATE TABLE "payroll_runs" (
    "id" TEXT NOT NULL,
    "cycle_start" DATE NOT NULL,
    "cycle_end" DATE NOT NULL,
    "cycle_label" TEXT NOT NULL,
    "status" "PayrollRunStatus" NOT NULL DEFAULT 'NEW',
    "calc_version" INTEGER NOT NULL DEFAULT 0,
    "lease_owner" TEXT,
    "lease_expires_at" TIMESTAMPTZ(3),
    "progress_done" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER NOT NULL DEFAULT 0,
    "pins" JSONB NOT NULL DEFAULT '[]',
    "rules_fingerprint" TEXT,
    "inputs_fingerprint" TEXT,
    "run_hash" TEXT,
    "total_gross" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total_deductions" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total_net" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total_employer_cost" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "people_count" INTEGER NOT NULL DEFAULT 0,
    "payable_count" INTEGER NOT NULL DEFAULT 0,
    "held_count" INTEGER NOT NULL DEFAULT 0,
    "excluded_count" INTEGER NOT NULL DEFAULT 0,
    "exception_count" INTEGER NOT NULL DEFAULT 0,
    "calculated_at" TIMESTAMPTZ(3),
    "calculated_by_user_id" TEXT,
    "failure_reason" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_user_id" TEXT,
    "void_reason" TEXT,

    CONSTRAINT "payroll_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_items" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "calc_version" INTEGER NOT NULL,
    "status" "PayrollItemStatus" NOT NULL,
    "hold_reason" TEXT,
    "hold_detail" TEXT,
    "employed_from" DATE,
    "employed_to" DATE,
    "basis_days" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "lop_divisor_days" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "lop_days" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "paid_days" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "gross" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "employer_contributions" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "net_before_rounding" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "rounding_adjustment" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "net_pay" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "employment_type" "EmploymentType" NOT NULL,
    "placement" JSONB NOT NULL DEFAULT '{}',
    "structure_key" TEXT,
    "structure_version" INTEGER,
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "notices" JSONB NOT NULL DEFAULT '[]',
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "item_hash" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payroll_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_run_lines" (
    "id" TEXT NOT NULL,
    "run_id" TEXT NOT NULL,
    "run_item_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "kind" "PayrollLineKind" NOT NULL,
    "source" "PayrollLineSource" NOT NULL,
    "source_ref" TEXT,
    "amount" DECIMAL(20,6) NOT NULL,
    "basis" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "payroll_run_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payroll_runs_cycle_start_status_idx" ON "payroll_runs"("cycle_start", "status");

-- CreateIndex
CREATE INDEX "payroll_run_items_run_id_status_idx" ON "payroll_run_items"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_items_run_id_employee_id_key" ON "payroll_run_items"("run_id", "employee_id");

-- CreateIndex
CREATE INDEX "payroll_run_lines_run_id_code_idx" ON "payroll_run_lines"("run_id", "code");

-- CreateIndex
CREATE INDEX "payroll_run_lines_source_source_ref_idx" ON "payroll_run_lines"("source", "source_ref");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_run_lines_run_item_id_sort_order_key" ON "payroll_run_lines"("run_item_id", "sort_order");

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_consumed_by_run_id_fkey" FOREIGN KEY ("consumed_by_run_id") REFERENCES "payroll_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_run_item_id_fkey" FOREIGN KEY ("run_item_id") REFERENCES "payroll_run_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ── payroll_runs: one live run per cycle; FINALISED cannot be reached except by the finaliser (P6-4); a finalised run never changes ─────────
-- The finaliser sets `payroll.finalising` to 'yes' for its own transaction (SET LOCAL). Nothing in P6-3 does, so no run can become real yet.
CREATE UNIQUE INDEX "payroll_runs_one_live_per_cycle" ON "payroll_runs"("cycle_start", "cycle_end") WHERE "status" <> 'VOID';
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_cycle_order" CHECK ("cycle_end" >= "cycle_start");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_progress" CHECK ("progress_done" >= 0 AND "progress_total" >= 0 AND "progress_done" <= "progress_total");
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_void_matches" CHECK (("status" = 'VOID') = ("voided_at" IS NOT NULL));
ALTER TABLE "payroll_runs" ADD CONSTRAINT "payroll_runs_void_reason" CHECK ("voided_at" IS NULL OR length(btrim(coalesce("void_reason", ''))) >= 3);
CREATE OR REPLACE FUNCTION payroll_runs_guard() RETURNS trigger AS $$
DECLARE finalising boolean := coalesce(current_setting('payroll.finalising', true), '') = 'yes';
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'FINALISED' AND NOT finalising THEN
      RAISE EXCEPTION 'RUN_FINALISE_FORBIDDEN: a run becomes final only through the finaliser, after it is approved and has no placeholder rule';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'RUN_NOT_DELETABLE: a payroll run is never deleted; discard a draft (void it)';
  END IF;
  IF OLD.status = 'FINALISED' AND NOT finalising THEN
    RAISE EXCEPTION 'RUN_FINALISED_IMMUTABLE: a finalised run is never changed';
  END IF;
  IF NEW.status = 'FINALISED' AND OLD.status <> 'FINALISED' AND NOT finalising THEN
    RAISE EXCEPTION 'RUN_FINALISE_FORBIDDEN: a run becomes final only through the finaliser, after it is approved and has no placeholder rule';
  END IF;
  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'RUN_VOID_IMMUTABLE: a discarded run is never changed';
  END IF;
  IF NEW.cycle_start <> OLD.cycle_start OR NEW.cycle_end <> OLD.cycle_end OR NEW.created_by_user_id <> OLD.created_by_user_id THEN
    RAISE EXCEPTION 'RUN_IMMUTABLE: the cycle of a run never changes';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_runs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_runs" FOR EACH ROW EXECUTE FUNCTION payroll_runs_guard();

-- ── payroll_run_items / payroll_run_lines: they change only while the run is a draft; a finalised or discarded run's rows never change ───────
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_net_adds_up" CHECK ("net_pay" = "net_before_rounding" + "rounding_adjustment");
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_hold_reason" CHECK ("status" <> 'HELD' OR length(btrim(coalesce("hold_reason", ''))) > 0);
ALTER TABLE "payroll_run_items" ADD CONSTRAINT "payroll_run_items_not_negative" CHECK ("gross" >= 0 AND "deductions" >= 0 AND "employer_contributions" >= 0 AND "lop_days" >= 0);
ALTER TABLE "payroll_run_lines" ADD CONSTRAINT "payroll_run_lines_amount_sign" CHECK ("kind" = 'ROUNDING' OR "amount" >= 0);
CREATE OR REPLACE FUNCTION payroll_run_children_guard() RETURNS trigger AS $$
DECLARE
  rid text;
  st "PayrollRunStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN rid := OLD.run_id; ELSE rid := NEW.run_id; END IF;
  SELECT status INTO st FROM payroll_runs WHERE id = rid;
  IF st IS NULL THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF; -- the run itself is already gone (a cascade)
  IF wellsure_test_purge_allowed() AND TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF coalesce(current_setting('payroll.finalising', true), '') = 'yes' THEN RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END; END IF;
  IF st = 'FINALISED' THEN RAISE EXCEPTION 'RUN_FINALISED_IMMUTABLE: the figures of a finalised run are never changed'; END IF;
  IF st = 'VOID' THEN RAISE EXCEPTION 'RUN_VOID_IMMUTABLE: a discarded run is never changed'; END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_run_items_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_run_items" FOR EACH ROW EXECUTE FUNCTION payroll_run_children_guard();
CREATE TRIGGER "payroll_run_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_run_lines" FOR EACH ROW EXECUTE FUNCTION payroll_run_children_guard();

-- ── payroll_adjustments: only a CONSUMED adjustment names the run that consumed it ─────────────────────────────────────────
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_consumed_has_run" CHECK ("consumed_by_run_id" IS NULL OR "status" = 'CONSUMED');
