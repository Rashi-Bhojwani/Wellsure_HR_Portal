-- Holidays and restricted holidays become company-wide (HR-confirmed
-- 2026-09-28): every branch previously had its own identical row per
-- date, since the holiday list never actually varied by branch. Before
-- dropping location_id, de-duplicate down to one row per date — keeping
-- an arbitrary survivor is safe here because every branch's row for a
-- given date already carries the same name (there was never a real
-- per-branch difference to lose).
DELETE FROM "holidays" a USING "holidays" b
WHERE a.date = b.date AND a.id > b.id;

DELETE FROM "restricted_holidays" a USING "restricted_holidays" b
WHERE a.date = b.date AND a.id > b.id;

-- DropForeignKey
ALTER TABLE "holidays" DROP CONSTRAINT "holidays_location_id_fkey";

-- DropForeignKey
ALTER TABLE "restricted_holidays" DROP CONSTRAINT "restricted_holidays_location_id_fkey";

-- DropIndex
DROP INDEX "holidays_date_idx";

-- DropIndex
DROP INDEX "holidays_location_id_date_key";

-- DropIndex
DROP INDEX "restricted_holidays_date_idx";

-- DropIndex
DROP INDEX "restricted_holidays_location_id_date_key";

-- AlterTable
ALTER TABLE "holidays" DROP COLUMN "location_id";

-- AlterTable
ALTER TABLE "restricted_holidays" DROP COLUMN "location_id";

-- CreateIndex
CREATE UNIQUE INDEX "holidays_date_key" ON "holidays"("date");

-- CreateIndex
CREATE UNIQUE INDEX "restricted_holidays_date_key" ON "restricted_holidays"("date");
