-- CreateEnum
CREATE TYPE "AttendanceSource" AS ENUM ('DEVICE', 'MANUAL', 'LEAVE', 'HOLIDAY', 'WEEK_OFF');

-- CreateEnum
CREATE TYPE "AttendanceCapture" AS ENUM ('DEVICE', 'MANUAL');

-- CreateEnum
CREATE TYPE "AttendanceProcessStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "daily_attendance" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift_id" TEXT,
    "shift_code" TEXT,
    "shift_start" TEXT,
    "shift_end" TEXT,
    "policy_id" TEXT,
    "first_in" TIMESTAMPTZ(3),
    "last_out" TIMESTAMPTZ(3),
    "total_minutes" INTEGER,
    "break_minutes" INTEGER,
    "actual_minutes" INTEGER,
    "in_shift_minutes" INTEGER,
    "late_in_minutes" INTEGER,
    "early_out_minutes" INTEGER,
    "shortfall_minutes" INTEGER,
    "excess_minutes" INTEGER,
    "status" TEXT NOT NULL,
    "first_half_status" TEXT,
    "second_half_status" TEXT,
    "lop_days" DECIMAL(3,2) NOT NULL DEFAULT 0,
    "exception_flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" "AttendanceSource" NOT NULL,
    "capture" "AttendanceCapture" NOT NULL,
    "leave_type_code" TEXT,
    "holiday_name" TEXT,
    "worked_on_off_day" BOOLEAN NOT NULL DEFAULT false,
    "provisional" BOOLEAN NOT NULL DEFAULT false,
    "punch_count" INTEGER NOT NULL DEFAULT 0,
    "computed_from" JSONB NOT NULL DEFAULT '{}',
    "is_locked" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "engine_version" INTEGER NOT NULL,

    CONSTRAINT "daily_attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_process_runs" (
    "id" TEXT NOT NULL,
    "from_date" DATE NOT NULL,
    "to_date" DATE NOT NULL,
    "employee_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "location_id" TEXT,
    "reason" TEXT NOT NULL,
    "status" "AttendanceProcessStatus" NOT NULL DEFAULT 'QUEUED',
    "requested_by_user_id" TEXT NOT NULL,
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "total_days" INTEGER NOT NULL DEFAULT 0,
    "processed_days" INTEGER NOT NULL DEFAULT 0,
    "changed_days" INTEGER NOT NULL DEFAULT 0,
    "locked_days" INTEGER NOT NULL DEFAULT 0,
    "changes" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,

    CONSTRAINT "attendance_process_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "daily_attendance_date_idx" ON "daily_attendance"("date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_attendance_employee_id_date_key" ON "daily_attendance"("employee_id", "date");

-- CreateIndex
CREATE INDEX "attendance_process_runs_requested_at_idx" ON "attendance_process_runs"("requested_at");

-- AddForeignKey
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A day's LOP is between none and a whole day.
ALTER TABLE daily_attendance ADD CONSTRAINT daily_attendance_lop_range CHECK (lop_days >= 0 AND lop_days <= 1);
