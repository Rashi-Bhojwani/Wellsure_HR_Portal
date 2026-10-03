-- AlterTable
ALTER TABLE "employees" ADD COLUMN     "exit_reason" TEXT;

-- Backfill: anyone already separated through a completed separation gets
-- that separation's reason on their employee record.
UPDATE "employees" e
SET "exit_reason" = s."reason"
FROM "separations" s
WHERE s."employee_id" = e."id" AND s."status" = 'COMPLETED' AND e."exit_reason" IS NULL;
