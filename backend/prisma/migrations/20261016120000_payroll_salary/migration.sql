-- Phase 6 commit P6-2 (docs/plans/PHASE_6.md §4, §14B): salary.
--   employee_salaries           a person's salary, effective-dated like job, name and bank history; written only by a salary revision
--   employee_salary_lines       its frozen monthly breakup, one row per component, exact decimals
--   payroll_salary_revisions    a salary change as a unit (who, what, from when); the thing a checker approves
--   payroll_adjustments         one-off earnings and deductions, and the arrears a back-dated revision creates
-- Values are immutable and history is append-only at the end of the timeline; the triggers below are the database's own backstop to the writer.
-- No TRUNCATE trigger on these tables on purpose: the app role needs UPDATE (effective_to) and DELETE (cancelling a scheduled revision) on the salary
-- rows, which the Phase 1.5 role step would take away from any table with a truncate-blocking trigger. The app role is never granted TRUNCATE.

-- CreateEnum
CREATE TYPE "SalaryChangeReason" AS ENUM ('JOINING', 'REVISION', 'CORRECTION');

-- CreateEnum
CREATE TYPE "AdjustmentSource" AS ENUM ('MANUAL', 'SALARY_ARREARS', 'IMPORT');

-- CreateEnum
CREATE TYPE "AdjustmentStatus" AS ENUM ('PENDING', 'CONSUMED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdjustmentDirection" AS ENUM ('EARNING', 'DEDUCTION');

-- CreateTable
CREATE TABLE "employee_salaries" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "effective_to" DATE,
    "reason" "SalaryChangeReason" NOT NULL,
    "annual_ctc" DECIMAL(18,2) NOT NULL,
    "monthly_ctc" DECIMAL(20,6) NOT NULL,
    "structure_key" TEXT NOT NULL,
    "structure_version" INTEGER NOT NULL,
    "structure_hash" TEXT NOT NULL,
    "rounding_pin" JSONB NOT NULL,
    "revision_id" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_salaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_salary_lines" (
    "id" TEXT NOT NULL,
    "salary_id" TEXT NOT NULL,
    "component_code" TEXT NOT NULL,
    "component_version" INTEGER NOT NULL,
    "component_type" TEXT NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "sort_order" INTEGER NOT NULL,

    CONSTRAINT "employee_salary_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_salary_revisions" (
    "id" TEXT NOT NULL,
    "effective_from" DATE NOT NULL,
    "reason" "SalaryChangeReason" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "selection" JSONB NOT NULL,
    "employee_ids" JSONB NOT NULL,
    "change" JSONB NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMPTZ(3),
    "applied_by_user_id" TEXT,
    "withdrawn_at" TIMESTAMPTZ(3),
    "withdrawn_reason" TEXT,

    CONSTRAINT "payroll_salary_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "component_code" TEXT NOT NULL,
    "direction" "AdjustmentDirection" NOT NULL,
    "amount" DECIMAL(20,6) NOT NULL,
    "reason" TEXT NOT NULL,
    "source" "AdjustmentSource" NOT NULL,
    "source_ref" TEXT,
    "period_start" DATE,
    "period_end" DATE,
    "breakdown" JSONB,
    "status" "AdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "consumed_by_run_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_user_id" TEXT,
    "cancel_reason" TEXT,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "employee_salaries_employee_id_effective_to_idx" ON "employee_salaries"("employee_id", "effective_to");

-- CreateIndex
CREATE INDEX "employee_salaries_revision_id_idx" ON "employee_salaries"("revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_salary_lines_salary_id_component_code_key" ON "employee_salary_lines"("salary_id", "component_code");

-- CreateIndex
CREATE INDEX "payroll_salary_revisions_created_at_idx" ON "payroll_salary_revisions"("created_at");

-- CreateIndex
CREATE INDEX "payroll_adjustments_employee_id_status_idx" ON "payroll_adjustments"("employee_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_adjustments_source_source_ref_key" ON "payroll_adjustments"("source", "source_ref");

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_revision_id_fkey" FOREIGN KEY ("revision_id") REFERENCES "payroll_salary_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "employee_salary_lines" ADD CONSTRAINT "employee_salary_lines_salary_id_fkey" FOREIGN KEY ("salary_id") REFERENCES "employee_salaries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ── employee_salaries: the same guarantees as the other history tables, plus immutability of the money ─────────────────────────
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_dates_ordered" CHECK ("effective_to" IS NULL OR "effective_to" > "effective_from");
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_no_overlap"
  EXCLUDE USING gist ("employee_id" WITH =, daterange("effective_from", "effective_to", '[)') WITH &&);
CREATE UNIQUE INDEX "employee_salaries_one_open" ON "employee_salaries" ("employee_id") WHERE "effective_to" IS NULL;
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_ctc_positive" CHECK ("annual_ctc" > 0 AND "monthly_ctc" > 0);
ALTER TABLE "employee_salaries" ADD CONSTRAINT "employee_salaries_structure_version_positive" CHECK ("structure_version" >= 1);

-- An UPDATE may set effective_to and nothing else (closing a row when a later one starts, or when somebody leaves). A row may be deleted only
-- while it is still in the future (cancelling a scheduled revision), or by the test-purge exception that exists only in a development-seeded database.
CREATE OR REPLACE FUNCTION employee_salaries_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() OR OLD.effective_from > (now() AT TIME ZONE 'Asia/Kolkata')::date THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'SALARY_ROW_IMMUTABLE: a salary row that has started is never deleted; make a revision dated after it';
  END IF;
  IF (to_jsonb(NEW) - 'effective_to') = (to_jsonb(OLD) - 'effective_to') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'SALARY_ROW_IMMUTABLE: the values of a salary row are never changed; make a revision instead';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_salaries_guard" BEFORE UPDATE OR DELETE ON "employee_salaries" FOR EACH ROW EXECUTE FUNCTION employee_salaries_guard();

-- ── employee_salary_lines: the frozen breakup never changes; it goes only with a salary row that is itself deletable ─────────────
ALTER TABLE "employee_salary_lines" ADD CONSTRAINT "employee_salary_lines_amount_not_negative" CHECK ("amount" >= 0);
ALTER TABLE "employee_salary_lines" ADD CONSTRAINT "employee_salary_lines_type" CHECK ("component_type" IN ('EARNING', 'DEDUCTION', 'EMPLOYER_CONTRIBUTION'));
CREATE OR REPLACE FUNCTION employee_salary_lines_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'SALARY_ROW_IMMUTABLE: the breakup of a salary row is never changed; make a revision instead';
  END IF;
  -- DELETE: when the parent is already gone (a cascade from a deletable parent), or is still in the future, or in the development test purge.
  IF wellsure_test_purge_allowed()
     OR NOT EXISTS (SELECT 1 FROM employee_salaries s WHERE s.id = OLD.salary_id)
     OR EXISTS (SELECT 1 FROM employee_salaries s WHERE s.id = OLD.salary_id AND s.effective_from > (now() AT TIME ZONE 'Asia/Kolkata')::date) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'SALARY_ROW_IMMUTABLE: the breakup of a salary row that has started is never deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "employee_salary_lines_guard" BEFORE UPDATE OR DELETE ON "employee_salary_lines" FOR EACH ROW EXECUTE FUNCTION employee_salary_lines_guard();

-- ── payroll_salary_revisions: inputs are fixed at creation; only "applied" or "withdrawn" may be set, once ──────────────────────
ALTER TABLE "payroll_salary_revisions" ADD CONSTRAINT "payroll_salary_revisions_one_outcome" CHECK ("applied_at" IS NULL OR "withdrawn_at" IS NULL);
ALTER TABLE "payroll_salary_revisions" ADD CONSTRAINT "payroll_salary_revisions_withdraw_reason" CHECK ("withdrawn_at" IS NULL OR length(btrim(coalesce("withdrawn_reason", ''))) >= 3);
CREATE OR REPLACE FUNCTION payroll_salary_revisions_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'SALARY_REVISION_IMMUTABLE: a salary revision is never deleted';
  END IF;
  IF OLD.applied_at IS NOT NULL OR OLD.withdrawn_at IS NOT NULL THEN
    RAISE EXCEPTION 'SALARY_REVISION_IMMUTABLE: this revision is already applied or withdrawn and cannot change';
  END IF;
  IF (to_jsonb(NEW) - 'applied_at' - 'applied_by_user_id' - 'withdrawn_at' - 'withdrawn_reason') = (to_jsonb(OLD) - 'applied_at' - 'applied_by_user_id' - 'withdrawn_at' - 'withdrawn_reason') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'SALARY_REVISION_IMMUTABLE: the people, the change and the date of a revision are fixed when it is created';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_salary_revisions_guard" BEFORE UPDATE OR DELETE ON "payroll_salary_revisions" FOR EACH ROW EXECUTE FUNCTION payroll_salary_revisions_guard();

-- ── payroll_adjustments: pending -> consumed by a run, or pending -> cancelled; nothing else about it changes ────────────────────
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_reason_given" CHECK (length(btrim("reason")) >= 3);
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_arrears_shape" CHECK ("source" <> 'SALARY_ARREARS' OR ("source_ref" IS NOT NULL AND "period_start" IS NOT NULL AND "period_end" IS NOT NULL AND "breakdown" IS NOT NULL));
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_status_fields" CHECK (
  ("status" = 'CANCELLED') = ("cancelled_at" IS NOT NULL)
  AND ("status" <> 'CONSUMED' OR "consumed_by_run_id" IS NOT NULL)
  AND ("status" = 'CANCELLED' OR "cancel_reason" IS NULL)
);
CREATE OR REPLACE FUNCTION payroll_adjustments_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF wellsure_test_purge_allowed() THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: an adjustment is never deleted; cancel it';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: this adjustment is already % and cannot change', lower(OLD.status::text);
  END IF;
  IF (to_jsonb(NEW) - 'status' - 'consumed_by_run_id' - 'cancelled_at' - 'cancelled_by_user_id' - 'cancel_reason')
     = (to_jsonb(OLD) - 'status' - 'consumed_by_run_id' - 'cancelled_at' - 'cancelled_by_user_id' - 'cancel_reason') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'ADJUSTMENT_IMMUTABLE: the amount, reason and employee of an adjustment never change; cancel it and add another';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "payroll_adjustments_guard" BEFORE UPDATE OR DELETE ON "payroll_adjustments" FOR EACH ROW EXECUTE FUNCTION payroll_adjustments_guard();
