-- CreateEnum
CREATE TYPE "LeaveEligibilityMode" AS ENUM ('DAYS', 'CALENDAR_MONTHS');

-- CreateEnum
CREATE TYPE "LeaveLedgerEntryType" AS ENUM ('OPENING', 'ACCRUAL', 'CONSUMED', 'REVERSAL', 'GRANT', 'DEBIT', 'CARRY_FORWARD', 'ENCASHMENT', 'LAPSE', 'EXPIRY');

-- CreateEnum
CREATE TYPE "LeaveRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LeaveDayPart" AS ENUM ('FULL', 'FIRST_HALF', 'SECOND_HALF');

-- CreateEnum
CREATE TYPE "CompOffCreditStatus" AS ENUM ('AVAILABLE', 'CONSUMED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CompOffCreditSource" AS ENUM ('MANUAL_GRANT', 'ATTENDANCE');

-- CreateEnum
CREATE TYPE "YearEndRunStatus" AS ENUM ('PREVIEW', 'SUPERSEDED', 'COMMITTED');

-- CreateTable
CREATE TABLE "leave_types" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_paid" BOOLEAN NOT NULL DEFAULT true,
    "allow_half_day" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_policies" (
    "id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "accrual_enabled" BOOLEAN NOT NULL DEFAULT false,
    "accrual_days_per_month" DECIMAL(5,2),
    "eligibility_mode" "LeaveEligibilityMode",
    "eligibility_value" INTEGER,
    "carry_forward_cap_days" DECIMAL(5,2),
    "negative_balance_allowed" BOOLEAN NOT NULL DEFAULT false,
    "skip_balance_check" BOOLEAN NOT NULL DEFAULT false,
    "year_end_encashment" BOOLEAN NOT NULL DEFAULT false,
    "comp_off_min_hours_worked" DECIMAL(4,2),
    "comp_off_expiry_days" INTEGER,
    "wfh_monthly_limit" INTEGER,
    "wfh_yearly_limit" INTEGER,
    "rh_yearly_quota" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_ledger" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "leave_year" INTEGER NOT NULL,
    "entry_date" DATE NOT NULL,
    "accrual_month" DATE,
    "entry_type" "LeaveLedgerEntryType" NOT NULL,
    "days" DECIMAL(5,2) NOT NULL,
    "reference_type" TEXT,
    "reference_id" TEXT,
    "comp_off_credit_id" TEXT,
    "remarks" TEXT,
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leave_ledger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leave_requests" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "leave_type_id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "from_day_part" "LeaveDayPart" NOT NULL DEFAULT 'FULL',
    "to_day_part" "LeaveDayPart" NOT NULL DEFAULT 'FULL',
    "total_days" DECIMAL(5,2) NOT NULL,
    "reason" TEXT,
    "attachment_storage_key" TEXT,
    "status" "LeaveRequestStatus" NOT NULL DEFAULT 'PENDING',
    "applied_by_user_id" TEXT NOT NULL,
    "decided_by_user_id" TEXT,
    "decided_at" TIMESTAMP(3),
    "decision_comments" TEXT,
    "cancelled_by_user_id" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "cancellation_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leave_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "holidays" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restricted_holidays" (
    "id" TEXT NOT NULL,
    "location_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restricted_holidays_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comp_off_credits" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "earned_date" DATE NOT NULL,
    "earned_days" DECIMAL(3,2) NOT NULL,
    "remaining_days" DECIMAL(3,2) NOT NULL,
    "expires_on" DATE NOT NULL,
    "status" "CompOffCreditStatus" NOT NULL DEFAULT 'AVAILABLE',
    "source" "CompOffCreditSource" NOT NULL,
    "granted_by_user_id" TEXT,
    "ledger_entry_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "comp_off_credits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_runs" (
    "id" TEXT NOT NULL,
    "leave_year" INTEGER NOT NULL,
    "status" "YearEndRunStatus" NOT NULL DEFAULT 'PREVIEW',
    "previewed_by_user_id" TEXT NOT NULL,
    "previewed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "committed_by_user_id" TEXT,
    "committed_at" TIMESTAMP(3),
    "total_employees" INTEGER NOT NULL,
    "total_encashed_days" DECIMAL(10,2) NOT NULL,
    "total_encashed_amount" DECIMAL(12,2) NOT NULL,
    "report_storage_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "year_end_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "year_end_run_items" (
    "id" TEXT NOT NULL,
    "year_end_run_id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "closing_pl_balance" DECIMAL(5,2) NOT NULL,
    "encashed_days" DECIMAL(5,2) NOT NULL,
    "daily_rate" DECIMAL(10,2) NOT NULL,
    "rate_source" TEXT NOT NULL,
    "encashed_amount" DECIMAL(12,2) NOT NULL,
    "ledger_encashment_entry_id" TEXT,

    CONSTRAINT "year_end_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "leave_types_code_key" ON "leave_types"("code");

-- CreateIndex
CREATE UNIQUE INDEX "leave_policies_leave_type_id_key" ON "leave_policies"("leave_type_id");

-- CreateIndex
CREATE INDEX "leave_ledger_employee_id_leave_type_id_idx" ON "leave_ledger"("employee_id", "leave_type_id");

-- CreateIndex
CREATE INDEX "leave_ledger_employee_id_entry_date_idx" ON "leave_ledger"("employee_id", "entry_date");

-- CreateIndex
CREATE INDEX "leave_ledger_reference_type_reference_id_idx" ON "leave_ledger"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "leave_ledger_comp_off_credit_id_idx" ON "leave_ledger"("comp_off_credit_id");

-- CreateIndex
CREATE INDEX "leave_requests_employee_id_status_idx" ON "leave_requests"("employee_id", "status");

-- CreateIndex
CREATE INDEX "leave_requests_from_date_to_date_idx" ON "leave_requests"("from_date", "to_date");

-- CreateIndex
CREATE INDEX "leave_requests_status_idx" ON "leave_requests"("status");

-- CreateIndex
CREATE INDEX "holidays_date_idx" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "holidays_location_id_date_key" ON "holidays"("location_id", "date");

-- CreateIndex
CREATE INDEX "restricted_holidays_date_idx" ON "restricted_holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "restricted_holidays_location_id_date_key" ON "restricted_holidays"("location_id", "date");

-- CreateIndex
CREATE UNIQUE INDEX "comp_off_credits_ledger_entry_id_key" ON "comp_off_credits"("ledger_entry_id");

-- CreateIndex
CREATE INDEX "comp_off_credits_employee_id_status_idx" ON "comp_off_credits"("employee_id", "status");

-- CreateIndex
CREATE INDEX "comp_off_credits_expires_on_idx" ON "comp_off_credits"("expires_on");

-- CreateIndex
CREATE UNIQUE INDEX "year_end_run_items_ledger_encashment_entry_id_key" ON "year_end_run_items"("ledger_encashment_entry_id");

-- CreateIndex
CREATE INDEX "year_end_run_items_year_end_run_id_idx" ON "year_end_run_items"("year_end_run_id");

-- AddForeignKey
ALTER TABLE "leave_policies" ADD CONSTRAINT "leave_policies_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_ledger" ADD CONSTRAINT "leave_ledger_comp_off_credit_id_fkey" FOREIGN KEY ("comp_off_credit_id") REFERENCES "comp_off_credits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_leave_type_id_fkey" FOREIGN KEY ("leave_type_id") REFERENCES "leave_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "holidays" ADD CONSTRAINT "holidays_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restricted_holidays" ADD CONSTRAINT "restricted_holidays_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comp_off_credits" ADD CONSTRAINT "comp_off_credits_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "year_end_run_items" ADD CONSTRAINT "year_end_run_items_year_end_run_id_fkey" FOREIGN KEY ("year_end_run_id") REFERENCES "year_end_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-added partial unique indexes (Prisma can't express these) --------

-- Monthly PL accrual idempotency (spec §5.5): one ACCRUAL row per
-- (employee, leave type, credited month) — accrual_month is the credited
-- month's 1st, set only on ACCRUAL rows, and is the real key rather than
-- entry_date, which can shift if a job run is retried on a later day.
CREATE UNIQUE INDEX "leave_ledger_accrual_once_per_month_key"
  ON "leave_ledger" ("employee_id", "leave_type_id", "accrual_month")
  WHERE "entry_type" = 'ACCRUAL';

-- Only one COMMITTED Year End Process run per leave year — PREVIEW/
-- SUPERSEDED rows for the same year are unrestricted (harmless history).
CREATE UNIQUE INDEX "year_end_runs_committed_once_per_year_key"
  ON "year_end_runs" ("leave_year")
  WHERE "status" = 'COMMITTED';
