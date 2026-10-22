-- P6-6 (docs/plans/PHASE_6.md §14J): who last wrote a person's statutory row, and the sign-offs behind the "Ready for first real run" screen.

ALTER TABLE "employee_statutory" ADD COLUMN "updated_by_user_id" TEXT;

CREATE TYPE "PayrollSetupArea" AS ENUM ('SALARIES', 'BANK_ACCOUNTS', 'STATUTORY_IDS');

CREATE TABLE "payroll_setup_signoffs" (
    "id" TEXT NOT NULL,
    "area" "PayrollSetupArea" NOT NULL,
    "content_hash" TEXT NOT NULL,
    "covered" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "author_user_ids" JSONB NOT NULL DEFAULT '[]',
    "signed_by_user_id" TEXT NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payroll_setup_signoffs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "payroll_setup_signoffs_area_signed_at_idx" ON "payroll_setup_signoffs"("area", "signed_at");

-- A sign-off is a record of who said what, when: never changed, never removed (the tests' purge exception is the one way out, as for every payroll record).
CREATE TRIGGER "payroll_setup_signoffs_guard" BEFORE INSERT OR UPDATE OR DELETE ON "payroll_setup_signoffs" FOR EACH ROW EXECUTE FUNCTION payroll_p65_append_only();
CREATE TRIGGER payroll_setup_signoffs_no_truncate BEFORE TRUNCATE ON "payroll_setup_signoffs" FOR EACH STATEMENT EXECUTE FUNCTION payroll_logs_no_truncate();
