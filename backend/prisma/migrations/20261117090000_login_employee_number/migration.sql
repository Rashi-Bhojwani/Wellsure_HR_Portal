-- Employee-number login (docs/plans/LOGIN_CHECKLIST.md).

-- The employee number is the login ID and the attendance machine ID. It is matched exactly after trimming spaces and ignoring case, so two numbers
-- that differ only in case or surrounding spaces must never both exist. Prisma cannot express an index on an expression, so it lives here only.
CREATE UNIQUE INDEX "employees_employee_code_ci_unique" ON "employees" (lower(btrim("employee_code")));

-- CreateTable
CREATE TABLE "login_email_missing_notices" (
    "id" TEXT NOT NULL,
    "employee_id" TEXT NOT NULL,
    "request_count" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_email_missing_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "login_email_missing_notices_employee_id_key" ON "login_email_missing_notices"("employee_id");

-- AddForeignKey
ALTER TABLE "login_email_missing_notices" ADD CONSTRAINT "login_email_missing_notices_employee_id_fkey" FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
